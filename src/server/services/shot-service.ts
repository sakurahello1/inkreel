import { enqueue } from "../jobs";
import { minSegmentSeconds } from "../providers/video";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { absPath, assetUrl, saveAsset } from "../storage";
import { frameLineage, keyframeLineage, orderKeyframes } from "../lineage";
import { extractLastFrame } from "../ffmpeg";
import { parseJson } from "../db";
import type { ChatProviderName } from "../providers/chat";
import type { FrameMode, ShotStatus } from "@/lib/types";
import { Service } from "./base";
import { syncUtterances } from "./narrated-service";

type ShotEdit = {
  scene?: string;
  shotSize?: string;
  camera?: string;
  duration?: number;
  emotion?: string;
  action?: string;
  sound?: string;
  framePrompt?: string;
  videoPrompt?: string;
  characters?: Array<{ characterId: string; personaTag: string }>;
  dialogue?: Array<{ characterId: string; line: string; tone: string }>;
};

/** 章节层面的操作：新建、改原文、跑拆镜、时间线设置、导出 */
export class ChapterService extends Service {
  async create(projectId: string, title: string) {
    const last = await this.db.chapter.findFirst({ where: { projectId }, orderBy: { index: "desc" } });
    const index = (last?.index ?? 0) + 1;
    return this.db.chapter.create({ data: { projectId, index, title: title.trim() || `第 ${index} 章` } });
  }

  update(chapterId: string, data: { title?: string; sourceText?: string }) {
    return this.db.chapter.update({ where: { id: chapterId }, data });
  }

  async runStoryboard(chapterId: string, opts: { provider?: ChatProviderName; instruction?: string; sourceText?: string }) {
    if (opts.sourceText !== undefined) await this.db.chapter.update({ where: { id: chapterId }, data: { sourceText: opts.sourceText } });
    await this.db.chapter.update({ where: { id: chapterId }, data: { agentStatus: "running", agentError: "" } });
    await enqueue("chapter.storyboard", { chapterId, provider: opts.provider ?? "chat", instruction: opts.instruction ?? "" });
  }

  updateTimeline(chapterId: string, data: { bgmVolume?: number; subtitles?: boolean }) {
    return this.db.chapter.update({ where: { id: chapterId }, data });
  }

  async export(chapterId: string) {
    await this.db.chapter.update({ where: { id: chapterId }, data: { exportStatus: "running", exportError: "" } });
    await enqueue("chapter.export", { chapterId });
  }

}

/**
 * 镜头：编辑、审核闸门、增删拆分、触发生成。
 *
 * 闸门规则集中在这里，不再散落在各个 action 里。原则是：
 * 改内容会把镜头退回草稿，但**不会删除任何已有产物**——产物是否还新鲜由输入指纹判断。
 */
export class ShotService extends Service {
  /** 编辑内容。改动会把状态退回相应闸门之前，让人重新过一遍眼。 */
  async update(shotId: string, data: ShotEdit) {
    const shot = await this.db.shot.findUniqueOrThrow({ where: { id: shotId } });
    const { characters, dialogue, ...rest } = data;
    const status = shot.status as ShotStatus;

    let next = status;
    // 只改了首帧提示词：退到首帧之前就够了
    if (data.framePrompt !== undefined && data.framePrompt !== shot.framePrompt && ["frame_ready", "frame_approved"].includes(status)) {
      next = "storyboard_approved";
    }
    // 改了分镜内容本身：整个退回草稿。只看真改了值的字段——编辑器每次保存都把整张表单送过来，
    // 按「有没有这个键」判会让只改一句提示词的保存也把已出片的镜头打回草稿
    const changed = (Object.keys(rest) as Array<keyof typeof rest>).filter((k) => rest[k] !== undefined && rest[k] !== (shot as Record<string, unknown>)[k]);
    const changedJson = (characters && JSON.stringify(characters) !== shot.characters) || (dialogue && JSON.stringify(dialogue) !== shot.dialogue);
    if ((changed.some((k) => k !== "framePrompt" && k !== "videoPrompt") || changedJson) && status !== "draft" && status !== "done") {
      next = "draft";
    }

    return this.db.shot.update({
      where: { id: shotId },
      data: {
        ...rest,
        ...(characters ? { characters: JSON.stringify(characters) } : {}),
        ...(dialogue ? { dialogue: JSON.stringify(dialogue) } : {}),
        status: next,
        needsReview: false,
      },
    });
  }

  /** 承接上一镜：出首帧时把上一镜成片末帧当参考图。首帧指纹会随之变化，界面上会标过期 */
  setUsePrevLastFrame(shotId: string, on: boolean) {
    return this.db.shot.update({ where: { id: shotId }, data: { usePrevLastFrame: on } });
  }

  /**
   * 直接上传一张图当首帧。走版本库：记一条 provider=upload 的 Generation，
   * 这样它和生成的版本并列，能切换、能回退。指纹按当前输入算定，界面上显示为新鲜。
   */
  async uploadFrame(projectId: string, shotId: string, form: FormData) {
    const { asset } = await this.saveUpload(form, { projectId, folder: "frames", kind: "image" });
    const shot = await this.db.shot.findUniqueOrThrow({ where: { id: shotId } });
    const lin = await frameLineage(shotId);
    await this.db.$transaction([
      this.db.generation.create({
        data: { kind: "frame", shotId, unitId: shot.unitId, provider: "upload", model: "手动上传", prompt: "", status: "success", resultId: asset.id, inputs: JSON.stringify(lin.inputs), params: JSON.stringify({ inputHash: lin.hash, upload: true }), finishedAt: new Date() },
      }),
      // 直出镜头传了首帧，就是要用首帧：顺手切回首帧模式，否则视频任务会当它不存在
      this.db.shot.update({ where: { id: shotId }, data: { frameId: asset.id, frameMode: "image", status: "frame_ready", frameInputHash: lin.hash, reviewNote: "" } }),
    ]);
  }

  /**
   * 直接拿上一镜成片的最后一帧当本镜首帧。不经过生图模型，视频从上一镜结束的画面接着拍。
   * 和「承接上一镜」开关不同：那个是把末帧当参考图再生成一张，这个是原样用。
   */
  async usePrevLastFrameAsFrame(projectId: string, shotId: string) {
    const shot = await this.db.shot.findUniqueOrThrow({ where: { id: shotId } });
    const prev = await this.db.shot.findFirst({
      where: { chapterId: shot.chapterId, index: { lt: shot.index }, videoId: { not: null } },
      orderBy: { index: "desc" },
      include: { video: true },
    });
    if (!prev?.video) throw new Error("前面没有已出视频的镜头");
    const tmp = path.join(os.tmpdir(), `last-${prev.video.id}-${Date.now()}.png`);
    try {
      await extractLastFrame(absPath(prev.video.path), tmp);
      const asset = await saveAsset({ buffer: await fs.readFile(tmp), mime: "image/png", kind: "image", projectId, folder: "frames" });
      const lin = await frameLineage(shotId);
      await this.db.$transaction([
        this.db.generation.create({
          data: {
            kind: "frame", shotId, unitId: shot.unitId, provider: "prev_video", model: `上一镜末帧 #${String(prev.index).padStart(2, "0")}`, prompt: "",
            status: "success", resultId: asset.id, inputs: JSON.stringify([{ assetId: prev.video.id, role: "prev_video", label: `上一镜成片 #${String(prev.index).padStart(2, "0")}` }]),
            params: JSON.stringify({ inputHash: lin.hash, fromShotId: prev.id, fromVideoId: prev.video.id }), finishedAt: new Date(),
          },
        }),
        this.db.shot.update({ where: { id: shotId }, data: { frameId: asset.id, frameMode: "image", status: "frame_ready", frameInputHash: lin.hash, reviewNote: "" } }),
      ]);
      return { fromIndex: prev.index };
    } finally {
      await fs.rm(tmp, { force: true }).catch(() => {});
    }
  }

  /* --- 关键帧 --- */

  /** 加一个关键帧。at 为整数秒，-1 = 镜头结束。同一时刻只留一个 */
  async addKeyframe(shotId: string, at: number) {
    const shot = await this.db.shot.findUniqueOrThrow({ where: { id: shotId } });
    this.checkAt(at, shot.duration);
    const dup = await this.db.keyframe.findFirst({ where: { shotId, at } });
    if (dup) return dup.id;
    const k = await this.db.keyframe.create({ data: { shotId, at } });
    return k.id;
  }

  /** 改时间点、画面描述或段提示词。描述进这一帧的指纹；时间点与段提示词进视频指纹 */
  async updateKeyframe(keyframeId: string, data: { at?: number; prompt?: string; segmentPrompt?: string }) {
    if (data.at !== undefined) {
      const k = await this.db.keyframe.findUniqueOrThrow({ where: { id: keyframeId }, include: { shot: true } });
      this.checkAt(data.at, k.shot.duration);
    }
    return this.db.keyframe.update({ where: { id: keyframeId }, data });
  }

  /** 中间帧的时间点：整数秒，且首尾两段都不能短于模型下限（分段路线每段都是独立的一次生成） */
  private checkAt(at: number, duration: number) {
    if (at < 0) return;
    const min = minSegmentSeconds();
    if (!Number.isInteger(at)) throw new Error("时间点要是整数秒");
    if (at < min || duration - at < min) throw new Error(`中间帧要落在第 ${min}–${duration - min} 秒之间（每段至少 ${min} 秒）${duration < 2 * min ? `；这一镜只有 ${duration} 秒，放不下中间帧，可以「拆成两镜」` : ""}`);
  }

  /** 删关键帧。它的历史版本随 Generation 级联删除，产物文件另外清 */
  async removeKeyframe(keyframeId: string) {
    const gens = await this.db.generation.findMany({ where: { keyframeId }, include: { result: true } });
    await this.db.keyframe.delete({ where: { id: keyframeId } });
    for (const g of gens) {
      if (!g.result) continue;
      const stillUsed = await this.db.generation.count({ where: { resultId: g.result.id } });
      const pinned = await this.db.shot.count({ where: { OR: [{ frameId: g.result.id }] } });
      if (!stillUsed && !pinned && g.provider !== "next_frame") {
        await this.db.asset.delete({ where: { id: g.result.id } }).catch(() => {});
        await fs.rm(absPath(g.result.path), { force: true }).catch(() => {});
      }
    }
  }

  /** 出一张关键帧。不动镜头状态，进度看 Generation */
  async generateKeyframe(keyframeId: string) {
    const k = await this.db.keyframe.findUniqueOrThrow({ where: { id: keyframeId }, include: { shot: true } });
    if (!k.shot.frameId) throw new Error("先出首帧，关键帧要以它为基准");
    if (!k.prompt.trim()) throw new Error("先写这一帧的描述");
    await this.db.shot.update({ where: { id: k.shotId }, data: { reviewNote: "" } });
    await enqueue("shot.keyframe", { keyframeId });
  }

  /** 本镜所有写了描述的关键帧串行重画 */
  async generateKeyframes(shotId: string) {
    const s = await this.db.shot.findUniqueOrThrow({ where: { id: shotId }, include: { keyframes: true } });
    if (!s.frameId) throw new Error("先出首帧，关键帧要以它为基准");
    const ids = orderKeyframes(s.keyframes.filter((k) => k.prompt.trim())).map((k) => k.id);
    if (!ids.length) throw new Error("没有写了描述的关键帧");
    const [head, ...rest] = ids;
    await this.db.shot.update({ where: { id: shotId }, data: { reviewNote: "" } });
    await enqueue("shot.keyframe", { keyframeId: head, rest });
    return ids.length;
  }

  /** 直接上传一张图当关键帧，同样走版本库 */
  async uploadKeyframe(projectId: string, keyframeId: string, form: FormData) {
    const { asset } = await this.saveUpload(form, { projectId, folder: "frames", kind: "image" });
    await this.adoptKeyframe(keyframeId, asset.id, { provider: "upload", model: "手动上传", inputs: null });
  }

  /**
   * 拿下一镜的首帧当本镜尾帧：本镜结束在下一镜开始的画面上，剪辑点天然无缝。
   * 和「用上一镜末帧当首帧」是一对，一个向前接、一个向后接。没有结尾关键帧就建一个。
   */
  async useNextFirstFrameAsEnd(shotId: string) {
    const shot = await this.db.shot.findUniqueOrThrow({ where: { id: shotId } });
    const next = await this.db.shot.findFirst({
      where: { chapterId: shot.chapterId, index: { gt: shot.index }, frameId: { not: null } },
      orderBy: { index: "asc" },
    });
    if (!next?.frameId) throw new Error("后面没有已出首帧的镜头");
    const keyframeId = await this.addKeyframe(shotId, -1);
    const tag = `#${String(next.index).padStart(2, "0")}`;
    await this.adoptKeyframe(keyframeId, next.frameId, {
      provider: "next_frame",
      model: `下一镜首帧 ${tag}`,
      inputs: [{ assetId: next.frameId, role: "frame", label: `下一镜首帧 ${tag}` }],
    });
    return { toIndex: next.index };
  }

  private async adoptKeyframe(keyframeId: string, assetId: string, src: { provider: string; model: string; inputs: Array<{ assetId: string; role: string; label: string }> | null }) {
    const k = await this.db.keyframe.findUniqueOrThrow({ where: { id: keyframeId }, include: { shot: true } });
    const lin = await keyframeLineage(keyframeId);
    await this.db.$transaction([
      this.db.generation.create({
        data: {
          kind: "keyframe", shotId: k.shotId, unitId: k.shot.unitId, keyframeId, provider: src.provider, model: src.model, prompt: "", status: "success", resultId: assetId,
          inputs: JSON.stringify(src.inputs ?? lin.inputs), params: JSON.stringify({ inputHash: lin.hash, at: k.at }), finishedAt: new Date(),
        },
      }),
      this.db.keyframe.update({ where: { id: keyframeId }, data: { assetId, inputHash: lin.hash } }),
    ]);
  }

  /** 补充一张首帧参考图。标签是给模型看的用途说明 */
  async addExtraRef(projectId: string, shotId: string, form: FormData, label: string) {
    const { asset, file } = await this.saveUpload(form, { projectId, folder: "refs", kind: "image" });
    const order = await this.db.shotRef.count({ where: { shotId } });
    await this.db.shotRef.create({ data: { shotId, assetId: asset.id, order, label: (label.trim() || file.name.replace(/[.][a-z0-9]+$/i, "")).slice(0, 40) } });
  }

  labelExtraRef(refId: string, label: string) {
    return this.db.shotRef.update({ where: { id: refId }, data: { label: label.trim().slice(0, 40) } });
  }

  /** 移除补充参考图。文件是专门为这一镜传的，一并删掉 */
  async removeExtraRef(refId: string) {
    const r = await this.db.shotRef.findUniqueOrThrow({ where: { id: refId }, include: { asset: true } });
    await this.db.shotRef.delete({ where: { id: refId } });
    await this.db.asset.delete({ where: { id: r.assetId } }).catch(() => {});
    await fs.rm(absPath(r.asset.path), { force: true }).catch(() => {});
  }

  /** 本镜首帧的推理等级；空串 = 跟随项目默认。进首帧指纹，改了会标过期 */
  setFrameQuality(shotId: string, quality: string) {
    return this.db.shot.update({ where: { id: shotId }, data: { frameQuality: quality } });
  }

  setScene(shotId: string, sceneId: string | null) {
    return this.db.shot.update({ where: { id: shotId }, data: { sceneId } });
  }

  setProps(shotId: string, propIds: string[]) {
    return this.db.shot.update({ where: { id: shotId }, data: { props: JSON.stringify(propIds) } });
  }

  async setFrameMode(shotIds: string[], mode: FrameMode) {
    for (const id of shotIds) {
      const shot = await this.db.shot.findUniqueOrThrow({ where: { id } });
      const inFrameStage = ["frame_generating", "frame_ready", "frame_approved"].includes(shot.status);
      await this.db.shot.update({ where: { id }, data: { frameMode: mode, ...(inFrameStage ? { status: "storyboard_approved" } : {}) } });
    }
  }

  /* --- 审核闸门 --- */

  approveStoryboard(shotIds: string[]) {
    return this.db.shot.updateMany({ where: { id: { in: shotIds }, status: "draft" }, data: { status: "storyboard_approved", needsReview: false } });
  }

  approveFrames(shotIds: string[]) {
    return this.db.shot.updateMany({ where: { id: { in: shotIds }, status: "frame_ready" }, data: { status: "frame_approved" } });
  }

  acceptVideos(shotIds: string[]) {
    return this.db.shot.updateMany({ where: { id: { in: shotIds }, status: "video_ready" }, data: { status: "done" } });
  }

  /** 退回上一道闸门 */
  async revert(shotId: string) {
    const shot = await this.db.shot.findUniqueOrThrow({ where: { id: shotId } });
    const back: Partial<Record<ShotStatus, ShotStatus>> = {
      storyboard_approved: "draft",
      frame_ready: "storyboard_approved",
      frame_approved: "frame_ready",
      video_ready: shot.frameMode === "image" ? "frame_approved" : "storyboard_approved",
      done: "video_ready",
    };
    const next = back[shot.status as ShotStatus];
    if (next) await this.db.shot.update({ where: { id: shotId }, data: { status: next } });
  }

  /* --- 触发生成 --- */

  /**
   * 重画首帧。不限制状态：已经出过视频的镜头也能直接回头重画，
   * 视频不会被删除，只是输入指纹对不上，界面上标成「已过期」。
   */
  async generateFrames(shotIds: string[]) {
    // 只选了一镜、而它是直出：用户明确要给这一镜画首帧，切到首帧模式。批量选中时直出镜头照旧跳过
    if (shotIds.length === 1) await this.db.shot.updateMany({ where: { id: shotIds[0], frameMode: "text_only" }, data: { frameMode: "image" } });
    const shots = await this.db.shot.findMany({ where: { id: { in: shotIds }, frameMode: "image" }, orderBy: { index: "asc" } });
    await this.db.shot.updateMany({ where: { id: { in: shots.map((s) => s.id) } }, data: { status: "frame_generating", reviewNote: "" } });

    // 同一分镜组必须串行：组内第二镜要拿第一镜的成品当场景锚点，并行就谁也锚不到谁。
    // 不同组之间互不相干，各自的头一镜同时入队。
    const groups = new Map<string, string[]>();
    for (const s of shots) {
      const key = s.unitId ?? `solo:${s.id}`;
      groups.set(key, [...(groups.get(key) ?? []), s.id]);
    }
    for (const [, ids] of groups) {
      const [head, ...rest] = ids;
      await enqueue("shot.frame", { shotId: head, rest });
    }
    return shots.length;
  }

  /** 生成视频。首帧模式下只要求首帧存在，不要求走完闸门。 */
  async generateVideos(shotIds: string[]) {
    const shots = await this.db.shot.findMany({ where: { id: { in: shotIds } } });
    let n = 0;
    for (const s of shots) {
      if (s.frameMode === "image" && !s.frameId) continue;
      await this.db.shot.update({ where: { id: s.id }, data: { status: "video_queued", reviewNote: "" } });
      await enqueue("shot.video.submit", { shotId: s.id });
      n += 1;
    }
    return n;
  }

  /**
   * 再出一版视频。keepCurrent 为真时只入版本库、不顶掉当前采用的那条——
   * 已经选定了一版、想再试一版比比看时用。
   */
  async generateVideoVersion(shotId: string, keepCurrent: boolean) {
    const s = await this.db.shot.findUniqueOrThrow({ where: { id: shotId } });
    if (s.frameMode === "image" && !s.frameId) throw new Error("先出首帧");
    if (!(keepCurrent && s.videoId)) await this.db.shot.update({ where: { id: shotId }, data: { status: "video_queued", reviewNote: "" } });
    await enqueue("shot.video.submit", { shotId, keepCurrent });
  }

  /** 带一句话意见重生成；配了 PUBLIC_BASE_URL 时会把上一版视频作为参考 */
  async regenerateVideo(shotId: string, instruction: string) {
    const s = await this.db.shot.findUniqueOrThrow({ where: { id: shotId } });
    if (!["video_ready", "done"].includes(s.status)) throw new Error("只有已生成视频的镜头才能按意见重生成");
    await this.db.shot.update({ where: { id: shotId }, data: { status: "video_queued", reviewNote: "" } });
    await enqueue("shot.video.submit", { shotId, instruction: instruction.trim() });
  }

  async rewrite(shotId: string, instruction: string, provider: ChatProviderName = "chat") {
    if (!instruction.trim()) throw new Error("请写改写要求");
    await this.db.shot.update({ where: { id: shotId }, data: { rewriting: true, reviewNote: "" } });
    await enqueue("shot.rewrite", { shotId, provider, instruction: instruction.trim() });
  }

  /* --- 增删与拆分 --- */

  async remove(chapterId: string, shotId: string) {
    await this.db.shot.delete({ where: { id: shotId } });
    await this.renumber(chapterId);
  }

  async addAfter(chapterId: string, afterShotId: string | null) {
    const all = await this.db.shot.findMany({ where: { chapterId }, orderBy: { index: "asc" } });
    const after = all.find((s) => s.id === afterShotId);
    const pos = after ? after.index : all.length;
    for (const s of all) if (s.index > pos) await this.db.shot.update({ where: { id: s.id }, data: { index: s.index + 1 } });
    const created = await this.db.shot.create({
      data: { chapterId, unitId: after?.unitId ?? all[all.length - 1]?.unitId ?? null, index: pos + 1, scene: after?.scene ?? "", status: "draft" },
    });
    return created.id;
  }

  /**
   * 在本镜与下一镜之间插一个过渡镜头：首帧 = 本镜成片的最后一帧，尾帧 = 下一镜的首帧，
   * 让模型把两个画面之间的运动补出来，剪辑点就不再是硬切。
   * 就是「加一镜 + 用上一镜末帧 + 用下一镜首帧作尾帧 + 一段过渡提示词」的组合拳，建好直接出片。
   * 时长取模型下限（fal 5 秒），觉得长了在时间线里裁。
   */
  async createTransition(chapterId: string, afterShotId: string) {
    const prev = await this.db.shot.findUniqueOrThrow({ where: { id: afterShotId }, include: { video: true, chapter: true } });
    if (!prev.video) throw new Error("本镜还没有成片，过渡要从它的最后一帧起");
    const next = await this.db.shot.findFirst({ where: { chapterId, index: { gt: prev.index } }, orderBy: { index: "asc" } });
    if (!next) throw new Error("本镜已是最后一镜");
    if (!next.frameId) throw new Error(`下一镜 #${String(next.index).padStart(2, "0")} 还没有首帧，过渡要落到它上面`);

    const id = await this.addAfter(chapterId, afterShotId);
    const duration = minSegmentSeconds();
    await this.db.shot.update({
      where: { id },
      data: {
        duration,
        shotSize: prev.shotSize,
        camera: "过渡运镜",
        action: `从 #${String(prev.index).padStart(2, "0")} 的结束画面自然过渡到 #${String(next.index + 1).padStart(2, "0")} 的开始画面`,
        characters: prev.characters,
        sceneId: prev.sceneId,
        frameMode: "image",
        videoPrompt:
          "这是两个镜头之间的过渡：以首帧图为起始画面、尾帧图为结束画面，用一段连贯的镜头运动（推、拉、摇、移或跟拍均可，按两个画面的机位差自然选择）把两者平滑地接起来，" +
          "人物的位置与姿态从首帧连续地变化到尾帧，不要跳切、不要闪黑、不要转场特效。没有台词。只保留环境音。",
        status: "draft",
      },
    });
    await this.usePrevLastFrameAsFrame(prev.chapter.projectId, id);
    await this.useNextFirstFrameAsEnd(id);
    await this.db.shot.update({ where: { id }, data: { status: "video_queued", reviewNote: "" } });
    await enqueue("shot.video.submit", { shotId: id });
    return id;
  }

  /**
   * 把下一镜并进本镜。时长相加（不能超过 15 秒）；动作、声音、视频提示词接起来；出场人物、道具、台词取并集。
   * 首帧留本镜的；下一镜的首帧变成本镜第 A 秒的关键帧（前后两段各自都够模型下限时才留，否则丢掉），
   * 下一镜自己的关键帧时间点整体后移 A 秒。两镜原来的成片都作废——内容变了。
   */
  async mergeWithNext(chapterId: string, shotId: string) {
    const a = await this.db.shot.findUniqueOrThrow({ where: { id: shotId }, include: { keyframes: true, extraRefs: true, chapter: { include: { project: { select: { kind: true } } } } } });
    const b = await this.db.shot.findFirst({ where: { chapterId, index: { gt: a.index } }, orderBy: { index: "asc" }, include: { keyframes: true, extraRefs: true } });
    if (!b) throw new Error("本镜已是最后一镜");
    const narrated = a.chapter.project.kind === "narrated";
    // 说书的页时长由配音决定，合并没有 15 秒上限
    const total = narrated ? a.duration : a.duration + b.duration;
    if (total > 15) throw new Error(`合并后 ${total} 秒，超过模型 15 秒上限`);
    const min = minSegmentSeconds();
    const keepBFrame = Boolean(b.frameId) && a.frameMode === "image" && a.duration >= min && b.duration >= min;

    const chars = [...parseJson<Array<{ characterId: string; personaTag: string }>>(a.characters, [])];
    for (const c of parseJson<Array<{ characterId: string; personaTag: string }>>(b.characters, [])) if (!chars.some((x) => x.characterId === c.characterId)) chars.push(c);
    const props = [...new Set([...parseJson<string[]>(a.props, []), ...parseJson<string[]>(b.props, [])])];
    const dialogue = [...parseJson<unknown[]>(a.dialogue, []), ...parseJson<unknown[]>(b.dialogue, [])];
    const join = (x: string, y: string) => [x.trim(), y.trim()].filter(Boolean).join("\n");

    await this.db.$transaction(async (tx) => {
      await tx.shot.update({
        where: { id: a.id },
        data: {
          duration: total,
          action: join(a.action, b.action),
          sound: join(a.sound, b.sound),
          emotion: join(a.emotion, b.emotion),
          videoPrompt: join(a.videoPrompt, b.videoPrompt),
          narration: join(a.narration, b.narration),
          characters: JSON.stringify(chars),
          props: JSON.stringify(props),
          dialogue: JSON.stringify(dialogue),
          status: a.frameId && a.frameMode === "image" ? "frame_ready" : "draft",
          videoId: null,
          videoInputHash: "",
          clipIn: 0,
          clipOut: null,
          clipSubtitle: "",
          reviewNote: "",
        },
      });
      // 本镜原来的尾帧没意义了（它是 A 结束时的画面，现在结束在 B）
      await tx.keyframe.deleteMany({ where: { shotId: a.id, at: -1 } });
      if (keepBFrame) {
        // B 的首帧 → 第 A 秒的关键帧，到它的那一段就是 A 的内容
        await tx.keyframe.create({ data: { shotId: a.id, at: a.duration, prompt: b.framePrompt, segmentPrompt: a.videoPrompt, assetId: b.frameId } });
        for (const k of b.keyframes) {
          if (k.at >= 0 && (k.at < min || b.duration - k.at < min)) continue;
          await tx.keyframe.create({ data: { shotId: a.id, at: k.at < 0 ? -1 : k.at + a.duration, prompt: k.prompt, segmentPrompt: k.segmentPrompt || b.videoPrompt, assetId: k.assetId } });
        }
      }
      // B 的补充参考图跟过来
      for (const r of b.extraRefs) await tx.shotRef.create({ data: { shotId: a.id, assetId: r.assetId, label: r.label, order: a.extraRefs.length + r.order } });
      await tx.shot.delete({ where: { id: b.id } });
    });
    await this.renumber(chapterId);
    // 说书：合并后旁白与台词变了，重排这一页要念的条
    if (a.narration || b.narration || dialogue.length) await syncUtterances(a.id);
    return { merged: b.index, duration: total, keptFrame: keepBFrame };
  }

  /** 一镜拆两镜，时长对半分，下半段继承构图与提示词但清空台词 */
  async split(chapterId: string, shotId: string) {
    const s = await this.db.shot.findUniqueOrThrow({ where: { id: shotId } });
    const half = Math.max(4, Math.floor(s.duration / 2));
    await this.db.shot.update({ where: { id: shotId }, data: { duration: half, status: "draft" } });
    const later = await this.db.shot.findMany({ where: { chapterId, index: { gt: s.index } } });
    for (const x of later) await this.db.shot.update({ where: { id: x.id }, data: { index: x.index + 1 } });
    await this.db.shot.create({
      data: {
        chapterId,
        unitId: s.unitId,
        index: s.index + 1,
        scene: s.scene,
        shotSize: s.shotSize,
        camera: s.camera,
        duration: Math.max(4, s.duration - half),
        emotion: s.emotion,
        action: s.action,
        sound: s.sound,
        characters: s.characters,
        dialogue: "[]",
        framePrompt: s.framePrompt,
        videoPrompt: s.videoPrompt,
        frameMode: s.frameMode,
        status: "draft",
      },
    });
  }

  private async renumber(chapterId: string) {
    const rest = await this.db.shot.findMany({ where: { chapterId }, orderBy: { index: "asc" } });
    await Promise.all(rest.map((s, i) => this.db.shot.update({ where: { id: s.id }, data: { index: i + 1 } })));
  }

  async summaryForAgent(shotId: string) {
    const s = await this.db.shot.findUniqueOrThrow({ where: { id: shotId } });
    return { index: s.index, characters: parseJson(s.characters, []) };
  }
}

/** 时间线：片段裁切、排序 */
export class TimelineService extends Service {
  updateClip(
    shotId: string,
    data: { clipIn?: number; clipOut?: number | null; clipEnabled?: boolean; clipSubtitle?: string; fadeIn?: number; fadeOut?: number },
  ) {
    return this.db.shot.update({ where: { id: shotId }, data });
  }

  async moveClip(chapterId: string, shotId: string, dir: -1 | 1) {
    const shots = await this.db.shot.findMany({ where: { chapterId, videoId: { not: null } }, orderBy: { index: "asc" } });
    const ordered = shots.sort((a, b) => (a.clipOrder ?? a.index) - (b.clipOrder ?? b.index));
    const i = ordered.findIndex((s) => s.id === shotId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    await Promise.all(ordered.map((s, k) => this.db.shot.update({ where: { id: s.id }, data: { clipOrder: k + 1 } })));
  }
}

/**
 * 版本与血缘。
 *
 * 每一次生成都在 Generation 表里留了一整条记录（提示词、参数、产物、花费），
 * 这里把它当成版本历史来用：可以回看、可以把旧版设回当前、可以从任意一级往下重跑。
 */
export class VersionService extends Service {
  /** 把某一次历史生成的产物设为当前版本。不花钱，只改指针。 */
  async use(generationId: string) {
    const g = await this.db.generation.findUniqueOrThrow({ where: { id: generationId } });
    if (!g.resultId) throw new Error("这次生成没有产物");
    // 指纹沿用那一版当初记下的值：取不到就留空，界面会显示为已过期
    const hash = parseJson<{ inputHash?: string }>(g.params, {}).inputHash ?? "";

    if (g.kind === "frame" && g.shotId) {
      await this.db.shot.update({ where: { id: g.shotId }, data: { frameId: g.resultId, frameMode: "image", status: "frame_ready", frameInputHash: hash, reviewNote: "" } });
    } else if (g.kind === "keyframe" && g.keyframeId) {
      await this.db.keyframe.update({ where: { id: g.keyframeId }, data: { assetId: g.resultId, inputHash: hash } });
    } else if (g.kind === "video" && g.shotId) {
      await this.db.shot.update({ where: { id: g.shotId }, data: { videoId: g.resultId, status: "video_ready", videoInputHash: hash, reviewNote: "" } });
    } else {
      throw new Error(`不支持切换这种产物：${g.kind}`);
    }
  }

  /** 某个关键帧的历史版本 */
  async listForKeyframe(keyframeId: string) {
    const k = await this.db.keyframe.findUniqueOrThrow({ where: { id: keyframeId } });
    const rows = await this.db.generation.findMany({
      where: { keyframeId, status: { in: ["success", "running", "queued"] } },
      include: { result: true },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    return rows.map((g) => this.view(g, Boolean(g.resultId) && g.resultId === k.assetId));
  }

  async listForShot(shotId: string, kind: "frame" | "video") {
    // 成功的和还在跑的都列出来；失败的不列，界面上没意义
    const rows = await this.db.generation.findMany({
      where: { shotId, kind, status: { in: ["success", "running", "queued"] } },
      include: { result: true },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    const shot = await this.db.shot.findUniqueOrThrow({ where: { id: shotId } });
    const currentId = kind === "frame" ? shot.frameId : shot.videoId;
    return rows.map((g) => this.view(g, Boolean(g.resultId) && g.resultId === currentId));
  }

  /** 给某一版起备注，比如「台词对」「表情好」 */
  label(generationId: string, label: string) {
    return this.db.generation.update({ where: { id: generationId }, data: { label: label.trim().slice(0, 60) } });
  }

  /** 弃掉一版：删记录，产物文件没被别处引用就一起删。当前采用的那版不许弃 */
  async discard(generationId: string) {
    const g = await this.db.generation.findUniqueOrThrow({ where: { id: generationId }, include: { result: true } });
    if (g.shotId && g.resultId) {
      const shot = await this.db.shot.findUniqueOrThrow({ where: { id: g.shotId } });
      if (shot.videoId === g.resultId || shot.frameId === g.resultId) throw new Error("这一版正在采用，先切到别的版本再弃");
    }
    if (g.keyframeId && g.resultId) {
      const k = await this.db.keyframe.findUnique({ where: { id: g.keyframeId } });
      if (k?.assetId === g.resultId) throw new Error("这一版正在采用，先切到别的版本再弃");
    }
    await this.db.generation.delete({ where: { id: generationId } });
    if (g.result) {
      const stillUsed = await this.db.generation.count({ where: { resultId: g.result.id } });
      if (!stillUsed) {
        await this.db.asset.delete({ where: { id: g.result.id } });
        await fs.rm(absPath(g.result.path), { force: true }).catch(() => {});
      }
    }
  }

  private view(
    g: { id: string; result: { path: string; duration: number | null } | null; cost: number; model: string; createdAt: Date; prompt: string; inputs: string; status: string; progress: string; label: string; params: string },
    isCurrent: boolean,
  ) {
    const p = parseJson<{ resolution?: string; keepCurrent?: boolean }>(g.params, {});
    return {
      id: g.id,
      url: assetUrl(g.result?.path),
      duration: g.result?.duration ?? null,
      cost: g.cost,
      model: g.model,
      resolution: p.resolution ?? "",
      status: g.status,
      progress: g.progress,
      label: g.label,
      createdAt: g.createdAt.toISOString(),
      prompt: g.prompt,
      inputs: parseJson<Array<{ role: string; label: string }>>(g.inputs, []),
      isCurrent,
    };
  }

  /** 从某一级往下按依赖顺序重跑 */
  async rerunFrom(shotId: string, from: "frame" | "video") {
    if (from === "frame") {
      await this.db.shot.update({ where: { id: shotId }, data: { status: "frame_generating", reviewNote: "" } });
      await enqueue("shot.frame", { shotId, thenVideo: true });
    } else {
      await this.db.shot.update({ where: { id: shotId }, data: { status: "video_queued", reviewNote: "" } });
      await enqueue("shot.video.submit", { shotId });
    }
  }

}
