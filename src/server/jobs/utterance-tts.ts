import { db } from "../db";
import { Job, errText } from "../core/job";
import { saveAsset } from "../storage";
import { synthesize } from "../providers/minimax";
import { TTS_MODEL, maybeRenderPage, ttsCost, utteranceHash } from "../services/narrated-service";
import { enqueue } from "./runner";

/** rest：同一批还没配的条，本条配完依次触发（MiniMax 有并发限制，串行最稳） */
type Payload = { utteranceId: string; rest?: string[] };

/**
 * 一条配音：文本 → MiniMax TTS（带句级时间戳）→ 音频资产。
 * 音色来自人物 / 旁白的选角结果（服务层已校验都确认过），本条可以单独覆盖语速与情绪。
 * 配完顺手看所属页是否齐了：齐了就渲染页视频，不用人再点一次。
 */
export class UtteranceTtsJob extends Job<Payload> {
  readonly type = "utterance.tts";

  async run(p: Payload) {
    const u = await db.utterance.findUniqueOrThrow({ where: { id: String(p.utteranceId) }, include: { shot: { include: { chapter: { include: { project: { include: { characters: true } } } } } } } });
    const project = u.shot.chapter.project;
    const ch = u.characterId ? project.characters.find((c) => c.id === u.characterId) : null;
    const voiceId = u.voiceId || (u.kind === "narration" ? project.narratorVoiceId ?? "" : ch?.voiceId ?? "");
    const speed = u.speed !== 1 ? u.speed : ch?.voiceSpeed ?? 1;
    const emotion = u.emotion || ch?.voiceEmotion || "";
    const gen = await db.generation.create({
      data: { kind: "voice", shotId: u.shotId, utteranceId: u.id, characterId: u.characterId, provider: "minimax", model: TTS_MODEL, prompt: u.text, params: JSON.stringify({ voiceId, speed, emotion }), status: "running" },
    });
    try {
      if (!voiceId) throw new Error(u.kind === "narration" ? "旁白还没确认音色" : `${ch?.name ?? "人物"}还没确认音色`);
      let out;
      try {
        out = await synthesize({ voiceId, text: u.text, speed, emotion: emotion || undefined, model: TTS_MODEL, subtitle: true });
      } catch (e) {
        // 账号没开 2.8 就退回 02-hd；情绪参数不支持也去掉再试
        const msg = e instanceof Error ? e.message : String(e);
        if (!/model|emotion|param/i.test(msg)) throw e;
        out = await synthesize({ voiceId, text: u.text, speed, model: "speech-02-hd", subtitle: true });
      }
      const duration = out.durationMs ? out.durationMs / 1000 : null;
      const asset = await saveAsset({ buffer: out.buffer, mime: out.mime, kind: "audio", projectId: project.id, folder: "voices", duration });
      const cost = ttsCost(u.text.length);
      const h = utteranceHash({ text: u.text, voiceId, speed, emotion });
      await db.$transaction([
        db.utterance.update({ where: { id: u.id }, data: { assetId: asset.id, duration: asset.duration ?? duration, timestamps: JSON.stringify(out.timestamps), status: "ready", error: "", inputHash: h, cost: { increment: cost } } }),
        db.shot.update({ where: { id: u.shotId }, data: { cost: { increment: cost } } }),
        db.generation.update({ where: { id: gen.id }, data: { status: "success", resultId: asset.id, cost, finishedAt: new Date() } }),
      ]);
      await maybeRenderPage(u.shotId);
    } catch (err) {
      const { short, long } = errText(err);
      await db.$transaction([
        db.utterance.update({ where: { id: u.id }, data: { status: "failed", error: short.slice(0, 300) } }),
        db.generation.update({ where: { id: gen.id }, data: { status: "failed", error: long, finishedAt: new Date() } }),
      ]);
      await this.passBaton(p);
      throw err;
    }
    await this.passBaton(p);
  }

  private async passBaton(p: Payload) {
    const [next, ...rest] = p.rest ?? [];
    if (next) await enqueue("utterance.tts", { utteranceId: next, rest });
  }

  /** 这一页的条都齐了、且有页图 → 渲染页视频 */
}
