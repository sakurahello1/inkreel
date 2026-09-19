import { z } from "zod";
import { db } from "../db";
import { Job, errText } from "../core/job";
import { saveAsset } from "../storage";
import { chat, extractJson, type ChatProviderName } from "../providers/chat";
import { listSystemVoices, synthesize } from "../providers/minimax";
import { castingSystemPrompt, castingUserPrompt } from "../prompts";
import { NarratedService, TTS_MODEL, ttsCost } from "../services/narrated-service";

type Payload = { projectId: string; provider?: string };

const CastSchema = z.object({
  casts: z.array(z.object({ role: z.string(), candidates: z.array(z.object({ voice_id: z.string(), reason: z.string().default("") })).min(1) })),
});

/**
 * 选角：Agent 从 MiniMax 音色库里给每个角色（含旁白）挑 3 个候选，再用角色自己的一句话合成试听。
 * 结果存在人物 / 项目的 candidates 字段里，人到选角页听完点确认——确认之前配音按钮是灰的。
 */
export class ProjectCastJob extends Job<Payload> {
  readonly type = "project.cast";

  async run(p: Payload) {
    const projectId = String(p.projectId);
    const provider = (p.provider ? String(p.provider) : "chat") as ChatProviderName;
    const svc = new NarratedService();
    const { roles } = await svc.castingStatus(projectId);
    const gen = await db.generation.create({ data: { kind: "cast", projectId, provider, model: "", prompt: "", status: "running", params: JSON.stringify({ roles: roles.map((r) => r.key) }) } });
    try {
      const voices = await listSystemVoices();
      if (!voices.length) throw new Error("MiniMax 音色库为空");
      // 只给 Agent 看中文音色，列表短一点选得准
      const zh = voices.filter((v) => /[一-鿿]/.test(v.name) || v.description.some((d) => /[一-鿿]/.test(d)));
      const pool = zh.length >= 20 ? zh : voices;
      const msgs = [
        { role: "system" as const, content: castingSystemPrompt() },
        { role: "user" as const, content: castingUserPrompt({ roles: roles.map((r) => ({ key: r.key, name: r.name, description: r.description, sampleLine: r.sampleLine })), voices: pool.slice(0, 400) }) },
      ];
      const res = await chat(msgs, { provider, json: true, maxTokens: 4000, timeoutMs: 5 * 60 * 1000 });
      const parsed = CastSchema.parse(extractJson(res.text, (v) => typeof v === "object" && v !== null && Array.isArray((v as { casts?: unknown }).casts)));
      const byId = new Map(voices.map((v) => [v.voiceId, v]));
      let cost = 0;

      for (const role of roles) {
        const picks = (parsed.casts.find((c) => c.role === role.key || c.role === role.name)?.candidates ?? []).filter((c) => byId.has(c.voice_id)).slice(0, 3);
        // Agent 没给或给错了：退回按名字关键词随便挑三个，好歹能听
        const cands = picks.length ? picks : pool.slice(0, 3).map((v) => ({ voice_id: v.voiceId, reason: "备选" }));
        const out: Array<{ voiceId: string; name: string; reason: string; sampleAssetId: string | null }> = [];
        for (const c of cands) {
          const v = byId.get(c.voice_id)!;
          let sampleAssetId: string | null = null;
          try {
            const text = role.sampleLine || "你好，我是这个故事的讲述者。";
            let tts;
            try {
              tts = await synthesize({ voiceId: v.voiceId, text, model: TTS_MODEL });
            } catch (e) {
              if (!/model|param/i.test(e instanceof Error ? e.message : String(e))) throw e;
              tts = await synthesize({ voiceId: v.voiceId, text, model: "speech-02-hd" });
            }
            const asset = await saveAsset({ buffer: tts.buffer, mime: tts.mime, kind: "audio", projectId, folder: "voices", duration: tts.durationMs ? tts.durationMs / 1000 : null });
            sampleAssetId = asset.id;
            cost += ttsCost(text.length);
            await db.generation.create({
              data: { kind: "voice", characterId: role.key === "narrator" ? null : role.key, projectId, provider: "minimax", model: TTS_MODEL, prompt: text, params: JSON.stringify({ candidate: true, role: role.key, voiceId: v.voiceId }), status: "success", resultId: asset.id, cost: ttsCost(text.length), finishedAt: new Date() },
            });
          } catch (e) {
            console.warn("[cast] sample failed", v.voiceId, e instanceof Error ? e.message : e);
          }
          out.push({ voiceId: v.voiceId, name: v.name, reason: c.reason, sampleAssetId });
        }
        const json = JSON.stringify(out);
        if (role.key === "narrator") await db.project.update({ where: { id: projectId }, data: { narratorCandidates: json } });
        else await db.character.update({ where: { id: role.key }, data: { voiceCandidates: json } });
      }
      await db.generation.update({ where: { id: gen.id }, data: { status: "success", model: res.model, cost: cost + res.usage.prompt * 0.0000025 + res.usage.completion * 0.00001, finishedAt: new Date() } });
    } catch (err) {
      const { long } = errText(err);
      await db.generation.update({ where: { id: gen.id }, data: { status: "failed", error: long, finishedAt: new Date() } });
      throw err;
    }
  }
}
