import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { enqueue } from "../jobs";
import { parseJson } from "../db";
import { absPath, assetUrl, saveAsset } from "../storage";
import { extractFrameAt } from "../ffmpeg";
import { frameLineage } from "../lineage";
import { ENGINES, estimateVideoCost } from "../providers/video";
import type { PrevizParams, PrevizSlot } from "../jobs/chapter-previz";
import { Service } from "./base";

type ShotChar = { characterId: string; personaTag: string };

/** 每镜秒数的可选档：0.5 一批 30 镜但更容易糊，1.0 更稳但一批只装 15 镜 */
export const PREVIZ_SLOT_OPTIONS = [0.5, 0.75, 1] as const;

/**
 * 分镜预演。一章的镜头按顺序在一条视频里快速闪一遍（每镜不到一秒），
 * 人从里面挑帧当首帧。截帧一律人工——自动截的帧对不上切点，还不如让人拖进度条。
 */
export class PrevizService extends Service {
  /**
   * 建预演任务。一条视频最长 15 秒，装不下就切成多批，每批一条 Generation。
   * 镜头的短描述只要景别 + 对焦的人物 + 一句动作，它是「人在哪、什么景别」的预演，不是表演。
   */
  async create(chapterId: string, opts: { shotIds?: string[]; slotSeconds?: number; resolution?: string }) {
    const chapter = await this.db.chapter.findUniqueOrThrow({
      where: { id: chapterId },
      include: { project: { include: { characters: true } }, shots: { orderBy: { index: "asc" } } },
    });
    const slotSeconds = PREVIZ_SLOT_OPTIONS.includes((opts.slotSeconds ?? 0.75) as 0.5) ? (opts.slotSeconds ?? 0.75) : 0.75;
    const resolution = opts.resolution || chapter.project.videoResolution || "768P";
    const pick = opts.shotIds?.length ? chapter.shots.filter((s) => opts.shotIds!.includes(s.id)) : chapter.shots;
    if (!pick.length) throw new Error("没有可预演的镜头");

    const perBatch = Math.max(1, Math.floor(ENGINES.h3.maxDuration / slotSeconds));
    const batches: (typeof pick)[] = [];
    for (let i = 0; i < pick.length; i += perBatch) batches.push(pick.slice(i, i + perBatch));

    const ids: string[] = [];
    for (let b = 0; b < batches.length; b++) {
      const shots = batches[b];
      // 时长取整秒：模型只收整数；再把每镜的格子按实际时长均分，格子边界才和总长对得上
      const duration = Math.min(ENGINES.h3.maxDuration, Math.max(ENGINES.h3.minDuration, Math.round(shots.length * slotSeconds)));
      const slot = duration / shots.length;
      const slots: PrevizSlot[] = shots.map((s, i) => ({
        shotId: s.id,
        index: s.index,
        start: Math.round(i * slot * 100) / 100,
        end: Math.round((i + 1) * slot * 100) / 100,
        text: this.slotText(s, chapter.project.characters),
      }));
      const params: PrevizParams = { slots, slotSeconds: Math.round(slot * 100) / 100, duration, resolution, batch: b + 1, batches: batches.length };
      const gen = await this.db.generation.create({
        data: { kind: "previz", chapterId, provider: "", model: "", prompt: "", status: "queued", params: JSON.stringify(params), label: batches.length > 1 ? `第 ${b + 1}/${batches.length} 批` : "" },
      });
      await enqueue("chapter.previz.submit", { generationId: gen.id });
      ids.push(gen.id);
    }
    return { ids, batches: batches.length };
  }

  /** 镜头在预演里的一句话：景别 · 对焦谁 · 干什么。不要长提示词，一批十几镜加起来要能塞进一条提示词 */
  private slotText(s: { shotSize: string; scene: string; characters: string; action: string; framePrompt: string; emotion: string }, chars: Array<{ id: string; name: string }>) {
    const names = parseJson<ShotChar[]>(s.characters, [])
      .map((c) => chars.find((x) => x.id === c.characterId)?.name)
      .filter(Boolean)
      .join("、");
    const who = names ? `固定机位对焦 ${names}` : "空镜，无人物";
    const where = s.scene.trim() ? `，${s.scene.trim().slice(0, 30)}` : "";
    const what = (s.action.trim() || s.framePrompt.trim().slice(0, 60)).slice(0, 70);
    return `${s.shotSize}${where}；${who}${what ? `；${what}` : ""}`;
  }

  /** 估价：按批数 × 时长，H3 Max 全能参考的价 */
  estimate(shotCount: number, slotSeconds: number, resolution: string) {
    const perBatch = Math.max(1, Math.floor(ENGINES.h3.maxDuration / slotSeconds));
    let total = 0;
    for (let i = 0; i < shotCount; i += perBatch) {
      const n = Math.min(perBatch, shotCount - i);
      total += estimateVideoCost(Math.max(ENGINES.h3.minDuration, Math.round(n * slotSeconds)), "h3", resolution, "ref");
    }
    return { batches: Math.ceil(shotCount / perBatch), cost: Math.round(total * 100) / 100 };
  }

  /** 本章所有预演，新的在前 */
  async list(chapterId: string) {
    const rows = await this.db.generation.findMany({ where: { chapterId, kind: "previz" }, include: { result: true }, orderBy: { createdAt: "desc" } });
    return rows.map((g) => {
      const p = parseJson<PrevizParams>(g.params, { slots: [], slotSeconds: 0.75, duration: 0, resolution: "", batch: 1, batches: 1 });
      return {
        id: g.id,
        status: g.status,
        progress: g.progress,
        error: g.error,
        label: g.label,
        url: assetUrl(g.result?.path),
        duration: g.result?.duration ?? p.duration,
        width: g.result?.width ?? null,
        height: g.result?.height ?? null,
        slots: p.slots,
        slotSeconds: p.slotSeconds,
        resolution: p.resolution,
        batch: p.batch,
        batches: p.batches,
        refs: p.refs ?? [],
        cost: g.cost,
        model: g.model,
        prompt: g.prompt,
        createdAt: g.createdAt.toISOString(),
      };
    });
  }

  /**
   * 把预演视频第 t 秒那一帧截下来当某镜的首帧。走版本库（provider=previz），和 gpt-image 画的、上传的并列；
   * 同时记下这条预演与时间点，下次打开镜头进度条自动跳回来。
   */
  async adoptFrame(generationId: string, shotId: string, t: number) {
    const gen = await this.db.generation.findUniqueOrThrow({ where: { id: generationId }, include: { result: true } });
    if (gen.kind !== "previz" || !gen.result || !gen.chapterId) throw new Error("这条预演还没有视频");
    const chapter = await this.db.chapter.findUniqueOrThrow({ where: { id: gen.chapterId }, select: { projectId: true } });
    const shot = await this.db.shot.findUniqueOrThrow({ where: { id: shotId } });
    const time = Math.max(0, Math.min(gen.result.duration ?? t, t));
    const tmp = path.join(os.tmpdir(), `previz-${shotId}-${Date.now()}.png`);
    try {
      await extractFrameAt(absPath(gen.result.path), time, tmp);
      const asset = await saveAsset({ buffer: await fs.readFile(tmp), mime: "image/png", kind: "image", projectId: chapter.projectId, folder: "frames" });
      const lin = await frameLineage(shotId);
      const label = `预演${gen.label ? `·${gen.label}` : ""} @${time.toFixed(2)}s`;
      await this.db.$transaction([
        this.db.generation.create({
          data: {
            kind: "frame", shotId, unitId: shot.unitId, provider: "previz", model: label, prompt: "", status: "success", resultId: asset.id,
            inputs: JSON.stringify([{ assetId: gen.result.id, role: "previz", label: "预演视频" }]),
            params: JSON.stringify({ inputHash: lin.hash, previzGenerationId: gen.id, t: time }), finishedAt: new Date(),
          },
        }),
        this.db.shot.update({
          where: { id: shotId },
          data: { frameId: asset.id, frameMode: "image", status: "frame_ready", frameInputHash: lin.hash, reviewNote: "", previzGenerationId: gen.id, previzTime: time },
        }),
      ]);
      return { time };
    } finally {
      await fs.rm(tmp, { force: true }).catch(() => {});
    }
  }

  /** 弃一条预演：视频文件一起删。已经从里面截出来的首帧是独立资产，不受影响 */
  async discard(generationId: string) {
    const g = await this.db.generation.findUniqueOrThrow({ where: { id: generationId }, include: { result: true } });
    if (g.kind !== "previz") throw new Error("不是预演记录");
    await this.db.shot.updateMany({ where: { previzGenerationId: generationId }, data: { previzGenerationId: null } });
    await this.db.generation.delete({ where: { id: generationId } });
    if (g.result) {
      await this.db.asset.delete({ where: { id: g.result.id } }).catch(() => {});
      await fs.rm(absPath(g.result.path), { force: true }).catch(() => {});
    }
  }
}
