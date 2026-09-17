import { db } from "../db";
import { Job, errText } from "../core/job";
import { saveAsset } from "../storage";
import { synthesize, VOICE_SAMPLE_TEXT } from "../providers/minimax";

type Payload = { characterId: string };

/** 人物声音样本：用 MiniMax 现成音色合成一句固定台词，作为该人物的参考音频。 */
export class CharacterVoiceJob extends Job<Payload> {
  readonly type = "character.voice";

  async run(p: Payload) {
    const ch = await db.character.findUniqueOrThrow({ where: { id: String(p.characterId) } });
    if (ch.voiceSource !== "minimax_system" || !ch.voiceId) throw new Error("该人物未选择 MiniMax 音色");

    const gen = await db.generation.create({
      data: {
        kind: "voice",
        characterId: ch.id,
        provider: "minimax",
        model: process.env.MINIMAX_TTS_MODEL || "speech-02-hd",
        prompt: VOICE_SAMPLE_TEXT,
        params: JSON.stringify({ voiceId: ch.voiceId }),
        status: "running",
      },
    });
    try {
      const out = await synthesize({ voiceId: ch.voiceId, text: VOICE_SAMPLE_TEXT });
      const asset = await saveAsset({
        buffer: out.buffer,
        mime: out.mime,
        kind: "audio",
        projectId: ch.projectId,
        folder: "voices",
        duration: out.durationMs ? out.durationMs / 1000 : null,
      });
      await db.$transaction([
        db.character.update({ where: { id: ch.id }, data: { voiceSampleId: asset.id, voiceStatus: "ready", voiceError: "" } }),
        db.generation.update({ where: { id: gen.id }, data: { status: "success", resultId: asset.id, cost: 0.01, finishedAt: new Date() } }),
      ]);
    } catch (err) {
      const { short, long } = errText(err);
      await db.$transaction([
        db.character.update({ where: { id: ch.id }, data: { voiceStatus: "failed", voiceError: short } }),
        db.generation.update({ where: { id: gen.id }, data: { status: "failed", error: long, finishedAt: new Date() } }),
      ]);
      throw err;
    }
  }
}
