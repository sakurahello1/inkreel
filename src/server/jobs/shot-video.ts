import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { db, parseJson } from "../db";
import { Job, errText, type Writes } from "../core/job";
import { absPath, saveAsset, saveAssetFromUrl, toDataUrl } from "../storage";
import { concatVideos, cutAudioSegment, probe } from "../ffmpeg";
import { computeBgmPlacements } from "../bgm";
import { ENGINES, clampDuration, createVideoTask, estimateVideoCost, minSegmentSeconds, queryVideoTask, videoBackend, videoModelFor, type VideoEngine, type VideoVariant } from "../providers/video";
import { segmentVideoPrompt, videoPrompt } from "../prompts";
import { videoLineage, videoRouteOf } from "../lineage";
import { FIRST_FRAME_REF, keyframeRef, orderKeyframes, segmentsOf, subjectRef, type RefImage } from "@/lib/keyframes";
import { FAL_MIN_DURATION } from "../providers/video-fal";
import { loadShotContext, type ShotContext } from "./shot-context";
import { enqueue } from "./runner";
import { VIDEO_MAX_WAIT_MS, VIDEO_POLL_MS } from "./sizes";

/**
 * keepCurrent：出候选。成片存进版本库，但不顶掉镜头当前采用的那条。
 * 用户已经选定第 2 条、想再出两条比一比时用；镜头状态也不动，
 * 进度由版本面板按 Generation 自己的状态显示。
 */
type SubmitPayload = { shotId: string; instruction?: string; keepCurrent?: boolean };

interface BgmPlan {
  name: string;
  trackStart: number;
  len: number;
  isRunStart: boolean;
}

/** 分段路线里一段的记录，存在 Generation.params.segments 里，轮询按它推进 */
interface SegmentRec {
  index: number;
  start: number;
  end: number;
  duration: number;
  hasEnd: boolean;
  taskId: string | null;
  status: "pending" | "success" | "failed";
  /** 这一段自己的成片资产（保留，便于回看哪段出了问题） */
  assetId: string | null;
  cost: number;
}

/** H3 参考音频的硬约束：单段 2–15 秒，最多 3 段，合计不超过 15 秒 */
const AUDIO_TOTAL_BUDGET = 15;
const AUDIO_MIN_SEG = 2;
const AUDIO_MAX_SLOTS = 3;

/**
 * 视频提交。
 *
 * 难点全在「选哪个变体」：H3 有文生视频、首尾帧、全能参考三个入口，
 * 能力互斥——首尾帧不收参考音频，全能参考收音频但首帧会退化成普通参考图。
 * 所以下面按优先级依次判断，每个分支只做一件事，别再挤成一坨 if/else。
 */
class VideoRequest {
  /** 图片与它们在提示词里的说法严格同序：只能通过 pushImage 一起进，不许分别 push */
  readonly images: string[] = [];
  readonly imageRefs: RefImage[] = [];
  readonly audios: string[] = [];
  readonly videos: string[] = [];
  private readonly tmpFiles: string[] = [];
  bgm: BgmPlan | null = null;

  constructor(private readonly ctx: ShotContext) {}

  /** 本镜对应的那一段 BGM。相邻同曲接着上一镜的位置继续，换曲从头开始。 */
  async addBgm() {
    const { shot } = this.ctx;
    if (!shot.bgmTrackId || !shot.bgmToModel) return null;
    const siblings = await db.shot.findMany({
      where: { chapterId: shot.chapterId },
      orderBy: { index: "asc" },
      select: { id: true, bgmTrackId: true, duration: true },
    });
    const placement = computeBgmPlacements(siblings.map((x) => ({ id: x.id, bgmTrackId: x.bgmTrackId, len: x.duration }))).get(shot.id);
    const track = await db.bgmTrack.findUnique({ where: { id: shot.bgmTrackId }, include: { asset: true } });
    if (!placement || !track) return null;

    const len = Math.min(AUDIO_TOTAL_BUDGET, Math.max(AUDIO_MIN_SEG, placement.len));
    const file = this.tmp(`bgm-${shot.id}`);
    await cutAudioSegment({ file: absPath(track.asset.path), trackStart: placement.trackStart, len, outFile: file });
    this.audios.push(await this.dataUrl(file));
    this.bgm = { name: track.name, trackStart: placement.trackStart, len, isRunStart: placement.isRunStart };
    return this.bgm;
  }

  /** 声音样本，裁进 BGM 用剩的预算里 */
  async addVoices(maxSlots: number) {
    let budget = AUDIO_TOTAL_BUDGET - (this.bgm?.len ?? 0);
    let slots = Math.min(maxSlots, AUDIO_MAX_SLOTS - this.audios.length);
    for (const v of this.ctx.voices) {
      if (slots <= 0 || budget < AUDIO_MIN_SEG) break;
      const src = absPath(v.asset.path);
      const dur = v.asset.duration ?? (await probe(src)).duration;
      const len = Math.min(dur, AUDIO_TOTAL_BUDGET, budget);
      if (len < AUDIO_MIN_SEG) break;
      if (len >= dur - 0.05) {
        this.audios.push(await toDataUrl(v.asset.path, v.asset.mime));
      } else {
        const file = this.tmp(`voice-${this.ctx.shot.id}-${slots}`);
        await cutAudioSegment({ file: src, trackStart: 0, len, outFile: file });
        this.audios.push(await this.dataUrl(file));
      }
      budget -= len;
      slots -= 1;
    }
  }

  private async pushImage(asset: { path: string; mime: string }, ref: RefImage) {
    this.images.push(await toDataUrl(asset.path, asset.mime));
    this.imageRefs.push(ref);
  }

  async addFrame() {
    const f = this.ctx.shot.frame;
    if (!f) return false;
    await this.pushImage(f, FIRST_FRAME_REF);
    return true;
  }

  /**
   * 首帧之外的关键帧，按时间排，紧跟在首帧后面。
   * 首尾帧入口只认第 2 张（尾帧）；全能参考入口按顺序全收，提示词里按 Image N 讲清各自的时间点。
   */
  async addKeyframes() {
    if (this.images.length !== 1) return;
    for (const k of orderKeyframes(this.ctx.shot.keyframes.filter((k) => k.asset))) {
      await this.pushImage(k.asset!, keyframeRef(k, this.ctx.shot.duration));
    }
  }

  /** 时间线上的图片数（首帧 + 关键帧），记进参数便于回看 */
  get timelineCount() {
    return this.imageRefs.filter((r) => r.timeline).length;
  }

  /** 人设与道具参考图，最多补到 limit 张 */
  async addRefs(limit: number) {
    for (const r of this.ctx.refs.slice(0, Math.max(0, limit))) await this.pushImage(r.asset, subjectRef(r.label));
  }

  private tmp(tag: string) {
    const f = path.join(os.tmpdir(), `slate-${tag}-${Date.now()}.mp3`);
    this.tmpFiles.push(f);
    return f;
  }

  private async dataUrl(file: string) {
    return `data:audio/mpeg;base64,${(await fs.readFile(file)).toString("base64")}`;
  }

  async cleanup() {
    await Promise.all(this.tmpFiles.map((f) => fs.rm(f, { force: true }).catch(() => undefined)));
  }
}

export class VideoSubmitJob extends Job<SubmitPayload> {
  readonly type = "shot.video.submit";

  async run(payload: SubmitPayload) {
    const ctx = await loadShotContext(String(payload.shotId));
    const { shot, project } = ctx;
    const frameMode = shot.frameMode as "image" | "text_only";
    const engine = (project.videoEngine as VideoEngine) || "h3";
    const resolution = project.videoResolution || process.env.VIDEO_RESOLUTION || "768P";
    const duration = clampDuration(shot.duration, engine);
    const note = typeof payload.instruction === "string" ? payload.instruction.trim() : "";

    // 有中间关键帧：拆成若干段首尾帧短片，出完拼接。带意见重做 / 送 BGM 这两种仍走单条全能参考
    if (engine === "h3" && frameMode === "image" && !note && !(shot.bgmToModel && shot.bgmTrackId) && videoRouteOf(ctx.shot) === "segments") {
      await this.submitSegments(ctx, { resolution, keepCurrent: Boolean(payload.keepCurrent) });
      return;
    }

    const req = new VideoRequest(ctx);
    let variant: VideoVariant;
    try {
      variant = engine === "omni" ? await this.planOmni(req) : await this.planH3(req, ctx, { note, frameMode });
    } finally {
      await req.cleanup();
    }

    const prompt = this.buildPrompt({ ctx, req, note, frameMode, variant });
    const lineage = await videoLineage(shot.id);
    const gen = await db.generation.create({
      data: {
        kind: "video",
        shotId: shot.id,
        unitId: shot.unitId,
        inputs: JSON.stringify(lineage.inputs),
        provider: videoBackend(),
        model: videoModelFor(variant, engine),
        prompt,
        params: JSON.stringify({
          engine,
          variant,
          duration,
          resolution,
          inputHash: lineage.hash,
          images: req.images.length,
          imageRefs: req.imageRefs.map((r) => r.name),
          timeline: req.timelineCount,
          audios: req.audios.length,
          videos: req.videos.length,
          instruction: note,
          keepCurrent: Boolean(payload.keepCurrent),
          bgm: req.bgm ? { name: req.bgm.name, trackStart: req.bgm.trackStart, len: req.bgm.len } : null,
        }),
        status: "running",
      },
    });

    try {
      const { taskId } = await createVideoTask({
        engine,
        variant,
        prompt,
        duration,
        resolution,
        aspectRatio: project.orientation,
        images: req.images,
        audios: req.audios,
        videos: req.videos,
      });
      // 候选模式且已有当前视频：镜头状态不动，只推进这一版自己的状态
      const holdShot = Boolean(payload.keepCurrent) && Boolean(shot.videoId);
      await db.$transaction([
        db.generation.update({ where: { id: gen.id }, data: { externalTaskId: taskId, progress: "submitted" } }),
        ...(holdShot ? [] : [db.shot.update({ where: { id: shot.id }, data: { status: "video_generating", reviewNote: "" } })]),
      ]);
      await enqueue("shot.video.poll", { generationId: gen.id, startedAt: Date.now() }, { delayMs: VIDEO_POLL_MS });
    } catch (err) {
      const { short, long } = errText(err);
      await db.$transaction([
        db.shot.update({
          where: { id: shot.id },
          data: { status: frameMode === "image" ? "frame_approved" : "storyboard_approved", reviewNote: `视频提交失败：${short.slice(0, 300)}` },
        }),
        db.generation.update({ where: { id: gen.id }, data: { status: "failed", error: long, finishedAt: new Date() } }),
      ]);
      throw err;
    }
  }

  /**
   * 分段路线：按已出图的关键帧把镜头切成 N 段，每段一次首尾帧生成（Turbo），
   * 前一段的尾帧就是后一段的首帧，所以接缝处画面连续。N 个任务一起提交，轮询任务等齐了再拼。
   *
   * 每段的提示词各自独立：模型看不到别的段，这段的动作过程和台词得在关键帧的「段提示词」里写全；
   * 没写就退回镜头的视频提示词（那样每段都会试着念一遍全部台词，一般不是想要的）。
   */
  private async submitSegments(ctx: ShotContext, opts: { resolution: string; keepCurrent: boolean }) {
    const { shot, project } = ctx;
    const segs = segmentsOf(shot.keyframes, shot.duration);
    const minSec = minSegmentSeconds();
    for (const sg of segs) {
      const d = sg.end - sg.start;
      if (d < minSec) throw new Error(`第 ${sg.index + 1} 段（${sg.start}–${sg.end}s）只有 ${d}s，低于模型下限 ${minSec}s，请挪关键帧或加长镜头`);
      if (d > ENGINES.h3.maxDuration) throw new Error(`第 ${sg.index + 1} 段（${sg.start}–${sg.end}s）超过 ${ENGINES.h3.maxDuration}s 上限`);
      if (!Number.isInteger(d)) throw new Error(`第 ${sg.index + 1} 段时长 ${d}s 不是整数秒`);
    }

    const plans: Array<{ rec: SegmentRec; prompt: string; images: string[] }> = [];
    for (const sg of segs) {
      const first = sg.from ? sg.from.asset! : shot.frame!;
      const images = [await toDataUrl(first.path, first.mime)];
      if (sg.to) images.push(await toDataUrl(sg.to.asset!.path, sg.to.asset!.mime));
      const text = (sg.to?.segmentPrompt ?? "").trim() || shot.videoPrompt;
      const prompt = segmentVideoPrompt({ text, index: sg.index, total: segs.length, start: sg.start, end: sg.end, hasEnd: Boolean(sg.to), source: ctx.source });
      plans.push({ rec: { index: sg.index, start: sg.start, end: sg.end, duration: sg.end - sg.start, hasEnd: Boolean(sg.to), taskId: null, status: "pending", assetId: null, cost: 0 }, prompt, images });
    }

    const lineage = await videoLineage(shot.id);
    const gen = await db.generation.create({
      data: {
        kind: "video",
        shotId: shot.id,
        unitId: shot.unitId,
        inputs: JSON.stringify(lineage.inputs),
        provider: videoBackend(),
        model: videoModelFor("i2v", "h3"),
        // 各段提示词按段拼起来存，回看时一眼能对上
        prompt: plans.map((p) => `【第 ${p.rec.index + 1}/${plans.length} 段 · ${p.rec.start}–${p.rec.end}s】\n${p.prompt}`).join("\n\n"),
        params: JSON.stringify({
          engine: "h3",
          variant: "i2v",
          route: "segments",
          duration: shot.duration,
          resolution: opts.resolution,
          inputHash: lineage.hash,
          images: plans.reduce((n, p) => n + p.images.length, 0),
          keepCurrent: opts.keepCurrent,
          segments: plans.map((p) => p.rec),
        }),
        status: "running",
      },
    });

    const holdShot = opts.keepCurrent && Boolean(shot.videoId);
    try {
      for (const p of plans) {
        const { taskId } = await createVideoTask({
          engine: "h3",
          variant: "i2v",
          prompt: p.prompt,
          duration: p.rec.duration,
          resolution: opts.resolution,
          aspectRatio: project.orientation,
          images: p.images,
        });
        p.rec.taskId = taskId;
      }
      await db.$transaction([
        // externalTaskId 记第一段的任务号：轮询任务靠它判断「已提交」，各段自己的任务号在 params.segments 里
        db.generation.update({ where: { id: gen.id }, data: { externalTaskId: plans[0].rec.taskId, progress: `0/${plans.length} 段`, params: JSON.stringify({ ...parseJson<Record<string, unknown>>(gen.params, {}), segments: plans.map((p) => p.rec) }) } }),
        ...(holdShot ? [] : [db.shot.update({ where: { id: shot.id }, data: { status: "video_generating", reviewNote: "" } })]),
      ]);
      await enqueue("shot.video.poll", { generationId: gen.id, startedAt: Date.now() }, { delayMs: VIDEO_POLL_MS });
    } catch (err) {
      const { short, long } = errText(err);
      await db.$transaction([
        db.shot.update({ where: { id: shot.id }, data: { status: "frame_approved", reviewNote: `视频提交失败：${short.slice(0, 300)}` } }),
        db.generation.update({ where: { id: gen.id }, data: { status: "failed", error: long, finishedAt: new Date() } }),
      ]);
      throw err;
    }
  }

  /** Omni 1.1 只收 1 张首帧，没有参考图与参考音频通道 */
  private async planOmni(req: VideoRequest): Promise<VideoVariant> {
    return (await req.addFrame()) ? "i2v" : "t2v";
  }

  private async planH3(
    req: VideoRequest,
    ctx: ShotContext,
    opts: { note: string; frameMode: "image" | "text_only" },
  ): Promise<VideoVariant> {
    await req.addBgm();
    const publicBase = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
    const prevVideo = ctx.shot.videoId ? await db.asset.findUnique({ where: { id: ctx.shot.videoId } }) : null;

    // 1. 带修改意见重生成：把上一版视频作为参考（中转站要求视频必须是公网 URL）
    if (opts.note && prevVideo && publicBase) {
      req.videos.push(`${publicBase}/api/files/${prevVideo.path}`);
      await req.addFrame();
      await req.addKeyframes();
      await req.addRefs(Math.max(0, 5 - req.images.length));
      await req.addVoices(3);
      return "ref";
    }

    // 2. 要把 BGM 或人声送进模型，只能走全能参考；首帧在这条路上退化成第 1 张参考图
    if (req.audios.length > 0) {
      await req.addFrame();
      await req.addKeyframes();
      await req.addRefs(Math.max(0, 5 - req.images.length));
      if (req.images.length === 0) throw new Error("要把 BGM 送给模型至少需要一张图（先生成首帧，或给出场人物生成三视图）");
      await req.addVoices(2);
      return "ref";
    }

    // 3. 首帧模式。只有尾帧时把它当第 2 张（首尾帧钉死）；有中间帧的在 run() 里已经分流去分段了
    if (opts.frameMode === "image") {
      if (!(await req.addFrame())) throw new Error("首帧模式但没有首帧图");
      if (videoRouteOf(ctx.shot) === "flf") await req.addKeyframes();
      return "i2v";
    }

    // 4. 直出。默认纯文生（fal 上是 Turbo，便宜、画幅跟 aspect_ratio 走）；
    //    项目开了「直出带参考图」才把场景 / 人设图送进全能参考——fal 上那是 H3 Max，两倍价。
    //    以前 fal 这条路会把场景图误当首帧送进 image-to-video，画幅跟着场景图变成 2:1，还会从场景图起手乱漂。
    if (ctx.refs.length > 0 && (videoBackend() !== "fal" || ctx.project.textOnlyRefs)) {
      await req.addRefs(5);
      await req.addVoices(3);
      return "ref";
    }
    return "t2v";
  }

  private buildPrompt({
    ctx,
    req,
    note,
    frameMode,
    variant,
  }: {
    ctx: ShotContext;
    req: VideoRequest;
    note: string;
    frameMode: "image" | "text_only";
    variant: VideoVariant;
  }) {
    let prompt = videoPrompt({ videoPrompt: ctx.shot.videoPrompt, frameMode, style: ctx.project.style, variant, imageRefs: req.imageRefs, source: ctx.source });
    if (req.bgm) {
      prompt += `\n参考音频 1 是本镜后期要配的背景音乐「${req.bgm.name}」${
        req.bgm.isRunStart ? "（本段开头）" : "（承接上一镜）"
      }，仅供参考画面节奏，不要把它或任何音乐放进输出音轨。`;
    }
    if (note) prompt += req.videos.length ? `\n以参考视频 1 为基础重做，修改要求：${note}` : `\n修改要求：${note}`;
    return prompt;
  }
}

type PollPayload = { generationId: string; startedAt?: number };

/** 视频轮询：中转站是异步任务制，提交拿到 task_id 后每 10 秒查一次，最长等 90 分钟。 */
export class VideoPollJob extends Job<PollPayload> {
  readonly type = "shot.video.poll";

  async run(payload: PollPayload) {
    const gen = await db.generation.findUniqueOrThrow({
      where: { id: String(payload.generationId) },
      include: { shot: { include: { chapter: true } } },
    });
    if (!gen.externalTaskId || !gen.shot) return;

    const shot = gen.shot;
    const fallback = shot.frameMode === "image" ? "frame_approved" : "storyboard_approved";
    const started = Number(payload.startedAt) || Date.now();

    const params = parseJson<{ segments?: SegmentRec[] }>(gen.params, {});
    if (params.segments?.length) {
      await this.pollSegments(gen.id, shot, fallback, started, params.segments);
      return;
    }

    let st;
    try {
      st = await queryVideoTask(gen.externalTaskId);
    } catch (err) {
      // 查询接口临时故障不算任务失败，放慢一倍再试
      await enqueue("shot.video.poll", { generationId: gen.id, startedAt: started }, { delayMs: VIDEO_POLL_MS * 2 });
      await db.generation.update({ where: { id: gen.id }, data: { progress: `查询失败，重试中：${errText(err).raw.slice(0, 100)}` } });
      return;
    }

    if (!st.isFinal) {
      if (Date.now() - started > VIDEO_MAX_WAIT_MS) {
        await this.fail(gen.id, shot.id, fallback, "超过 90 分钟仍未完成，停止轮询", "视频任务超时，请重新提交");
        return;
      }
      await db.generation.update({ where: { id: gen.id }, data: { progress: st.progress || st.state } });
      await enqueue("shot.video.poll", { generationId: gen.id, startedAt: started }, { delayMs: VIDEO_POLL_MS });
      return;
    }

    if (st.state === "success" && st.resultUrl) {
      const asset = await saveAssetFromUrl(st.resultUrl, { kind: "video", projectId: shot.chapter.projectId, folder: "videos" });
      // 中转站在状态里回实扣金额；fal 不回，按价目表估一个记进去，否则成本统计全是 0
      const p = parseJson<{ engine?: VideoEngine; variant?: VideoVariant; duration?: number; resolution?: string; inputHash?: string; keepCurrent?: boolean }>(gen.params, {});
      const cost = st.cost > 0 ? st.cost : estimateVideoCost(p.duration ?? shot.duration, p.engine ?? "h3", p.resolution ?? "768P", p.variant);
      // 候选模式且镜头已有采用的视频：只入版本库，不动当前指针；用户在版本面板里自己挑
      const hold = Boolean(p.keepCurrent) && Boolean(shot.videoId);
      await db.$transaction([
        db.generation.update({ where: { id: gen.id }, data: { status: "success", resultId: asset.id, cost, progress: "100%", finishedAt: new Date() } }),
        db.shot.update({
          where: { id: shot.id },
          data: hold
            ? { cost: { increment: cost } }
            : {
                videoId: asset.id,
                status: "video_ready",
                // 指纹在提交那一刻算定，此刻写回；之后任何上游改动都会让它对不上
                videoInputHash: p.inputHash ?? "",
                cost: { increment: cost },
              },
        }),
      ]);
    } else {
      await this.fail(gen.id, shot.id, fallback, st.error || "任务失败", `视频生成失败：${(st.error || "未知错误").slice(0, 300)}`);
    }
  }

  /**
   * 分段轮询：每次把所有还没完成的段各查一遍，成功的段先落成资产（保留，便于回看），
   * 全部齐了再拼成一条、按普通视频的方式落库。任一段失败整条算失败。
   */
  private async pollSegments(genId: string, shot: { id: string; duration: number; videoId: string | null; chapter: { projectId: string } }, fallback: string, started: number, segments: SegmentRec[]) {
    let changed = false;
    for (const sg of segments) {
      if (sg.status !== "pending" || !sg.taskId) continue;
      let st;
      try {
        st = await queryVideoTask(sg.taskId);
      } catch {
        continue; // 查询接口临时故障，下一轮再查
      }
      if (!st.isFinal) continue;
      if (st.state === "success" && st.resultUrl) {
        const asset = await saveAssetFromUrl(st.resultUrl, { kind: "video", projectId: shot.chapter.projectId, folder: "videos" });
        sg.assetId = asset.id;
        sg.status = "success";
        sg.cost = st.cost > 0 ? st.cost : estimateVideoCost(sg.duration, "h3", "768P", "i2v");
      } else {
        sg.status = "failed";
        const gen = await db.generation.findUniqueOrThrow({ where: { id: genId } });
        await db.generation.update({ where: { id: genId }, data: { params: JSON.stringify({ ...parseJson<Record<string, unknown>>(gen.params, {}), segments }) } });
        await this.fail(genId, shot.id, fallback, `第 ${sg.index + 1} 段失败：${st.error || "任务失败"}`, `视频第 ${sg.index + 1} 段生成失败：${(st.error || "未知错误").slice(0, 200)}`);
        return;
      }
      changed = true;
    }

    const gen = await db.generation.findUniqueOrThrow({ where: { id: genId } });
    const p = parseJson<{ resolution?: string; inputHash?: string; keepCurrent?: boolean }>(gen.params, {});
    const done = segments.filter((x) => x.status === "success").length;
    if (changed) await db.generation.update({ where: { id: genId }, data: { progress: `${done}/${segments.length} 段`, params: JSON.stringify({ ...parseJson<Record<string, unknown>>(gen.params, {}), segments }) } });

    if (done < segments.length) {
      if (Date.now() - started > VIDEO_MAX_WAIT_MS) {
        await this.fail(genId, shot.id, fallback, "超过 90 分钟仍未完成，停止轮询", "视频任务超时，请重新提交");
        return;
      }
      await enqueue("shot.video.poll", { generationId: genId, startedAt: started }, { delayMs: VIDEO_POLL_MS });
      return;
    }

    // 全部齐了：按段序拼接
    const assets = await db.asset.findMany({ where: { id: { in: segments.map((x) => x.assetId!) } } });
    const files = segments.map((x) => absPath(assets.find((a) => a.id === x.assetId)!.path));
    const out = path.join(os.tmpdir(), `slate-concat-${genId}.mp4`);
    try {
      await concatVideos(files, out);
      const asset = await saveAsset({ buffer: await fs.readFile(out), mime: "video/mp4", kind: "video", projectId: shot.chapter.projectId, folder: "videos" });
      const cost = segments.reduce((n, x) => n + x.cost, 0);
      const hold = Boolean(p.keepCurrent) && Boolean(shot.videoId);
      await db.$transaction([
        db.generation.update({ where: { id: genId }, data: { status: "success", resultId: asset.id, cost, progress: `${segments.length}/${segments.length} 段 · 已拼接`, finishedAt: new Date() } }),
        db.shot.update({
          where: { id: shot.id },
          data: hold ? { cost: { increment: cost } } : { videoId: asset.id, status: "video_ready", videoInputHash: p.inputHash ?? "", cost: { increment: cost } },
        }),
      ]);
    } catch (err) {
      const { short, long } = errText(err);
      await this.fail(genId, shot.id, fallback, `拼接失败：${long}`, `视频拼接失败：${short.slice(0, 200)}`);
    } finally {
      await fs.rm(out, { force: true }).catch(() => {});
    }
  }

  private async fail(genId: string, shotId: string, status: string, genError: string, note: string) {
    const writes: Writes = [
      db.generation.update({ where: { id: genId }, data: { status: "failed", error: genError, finishedAt: new Date() } }),
      db.shot.update({ where: { id: shotId }, data: { status, reviewNote: note } }),
    ];
    await db.$transaction(writes);
  }
}
