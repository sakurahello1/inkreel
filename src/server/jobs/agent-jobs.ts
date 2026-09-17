import { db } from "../db";
import { Job, errText } from "../core/job";
import { runShotRewrite, runStoryboardAgent } from "../agent/storyboard";
import type { ChatProviderName } from "../providers/chat";

/** gpt-5.6-sol 粗估：$2.5/M 输入、$10/M 输出；deepseek 几乎为零 */
function chatCost(provider: unknown, usage: { prompt: number; completion: number }) {
  return provider === "deepseek" ? 0.001 : usage.prompt * 0.0000025 + usage.completion * 0.00001;
}

type StoryboardPayload = { chapterId: string; provider?: string; instruction?: string; targetSeconds?: number };

/**
 * 拆镜：把整章原文交给模型，拆成分镜组与镜头，整章覆盖式重建。
 * 写入放在一个事务里，避免拆到一半失败留下半张分镜表。
 */
export class ChapterStoryboardJob extends Job<StoryboardPayload> {
  readonly type = "chapter.storyboard";

  async run(p: StoryboardPayload) {
    const id = String(p.chapterId);
    const gen = await db.generation.create({
      data: { kind: "storyboard", chapterId: id, provider: String(p.provider ?? "chat"), model: "", prompt: String(p.instruction ?? ""), status: "running" },
    });
    try {
      const { output, usage, model } = await runStoryboardAgent(id, {
        provider: p.provider as ChatProviderName | undefined,
        instruction: p.instruction ? String(p.instruction) : undefined,
        targetSeconds: Number(p.targetSeconds) || undefined,
      });
      await db.$transaction(async (tx) => {
        await tx.shot.deleteMany({ where: { chapterId: id } });
        await tx.unit.deleteMany({ where: { chapterId: id } });

        const unitIds = new Map<number, string>();
        for (const u of output.units) {
          const row = await tx.unit.create({ data: { chapterId: id, index: u.index, summary: u.summary, paraStart: u.paraStart, paraEnd: u.paraEnd } });
          unitIds.set(u.index, row.id);
        }
        let i = 0;
        for (const s of output.shots) {
          i += 1;
          await tx.shot.create({
            data: {
              chapterId: id,
              unitId: unitIds.get(s.unitIndex) ?? null,
              index: i,
              scene: s.scene,
              shotSize: s.shotSize,
              camera: s.camera,
              duration: s.duration,
              characters: JSON.stringify(s.characters),
              props: JSON.stringify(s.propIds),
              dialogue: JSON.stringify(s.dialogue),
              emotion: s.emotion,
              action: s.action,
              sound: s.sound,
              frameMode: s.frameMode,
              framePrompt: s.framePrompt,
              videoPrompt: s.videoPrompt,
              bgmTrackId: s.bgmTrackId,
              // 模型被要求只输出人声与环境音，配乐一律后期配，所以默认不给模型送 BGM
              bgmToModel: false,
              needsReview: s.needsReview,
              reviewNote: s.reviewNote,
              status: "draft",
            },
          });
        }
        await tx.chapter.update({ where: { id }, data: { agentStatus: "idle", agentError: "" } });
        await tx.generation.update({
          where: { id: gen.id },
          data: { status: "success", model, cost: chatCost(p.provider, usage), params: JSON.stringify(usage), finishedAt: new Date() },
        });
      });
    } catch (err) {
      const { long, raw } = errText(err);
      await db.$transaction([
        db.chapter.update({ where: { id }, data: { agentStatus: "failed", agentError: raw.slice(0, 800) } }),
        db.generation.update({ where: { id: gen.id }, data: { status: "failed", error: long, finishedAt: new Date() } }),
      ]);
      throw err;
    }
  }
}

type RewritePayload = { shotId: string; provider?: string; instruction?: string };

/** 逐镜改写：带一句话意见让模型重写单个镜头的全部字段 */
export class ShotRewriteJob extends Job<RewritePayload> {
  readonly type = "shot.rewrite";

  async run(p: RewritePayload) {
    const id = String(p.shotId);
    const gen = await db.generation.create({
      data: { kind: "rewrite", shotId: id, provider: String(p.provider ?? "chat"), model: "", prompt: String(p.instruction ?? ""), status: "running" },
    });
    try {
      const { shot: s, usage, model } = await runShotRewrite(id, {
        provider: p.provider as ChatProviderName | undefined,
        instruction: String(p.instruction ?? ""),
      });
      const cost = chatCost(p.provider, usage);
      await db.$transaction([
        db.shot.update({
          where: { id },
          data: {
            scene: s.scene,
            shotSize: s.shotSize,
            camera: s.camera,
            duration: s.duration,
            characters: JSON.stringify(s.characters),
            props: JSON.stringify(s.propIds),
            dialogue: JSON.stringify(s.dialogue),
            emotion: s.emotion,
            action: s.action,
            sound: s.sound,
            frameMode: s.frameMode,
            framePrompt: s.framePrompt,
            videoPrompt: s.videoPrompt,
            bgmTrackId: s.bgmTrackId,
            bgmToModel: false,
            needsReview: s.needsReview,
            reviewNote: s.reviewNote,
            rewriting: false,
            status: "draft",
            cost: { increment: cost },
          },
        }),
        db.generation.update({ where: { id: gen.id }, data: { status: "success", model, cost, params: JSON.stringify(usage), finishedAt: new Date() } }),
      ]);
    } catch (err) {
      const { short, long } = errText(err);
      await db.$transaction([
        db.shot.update({ where: { id }, data: { rewriting: false, reviewNote: `Agent 改写失败：${short.slice(0, 300)}` } }),
        db.generation.update({ where: { id: gen.id }, data: { status: "failed", error: long, finishedAt: new Date() } }),
      ]);
      throw err;
    }
  }
}
