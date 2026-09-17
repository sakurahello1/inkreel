/**
 * MiniMax 国内平台（api.minimaxi.com）：系统音色列表 + T2A 合成参考样本。
 */

export interface MiniMaxVoice {
  voiceId: string;
  name: string;
  description: string[];
}

function cfg() {
  const baseUrl = (process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com").replace(/\/$/, "");
  const apiKey = process.env.MINIMAX_API_KEY || "";
  if (!apiKey) throw new Error("缺少 MINIMAX_API_KEY");
  return { baseUrl, apiKey, ttsModel: process.env.MINIMAX_TTS_MODEL || "speech-02-hd" };
}

let voiceCache: { at: number; voices: MiniMaxVoice[] } | null = null;

export async function listSystemVoices(): Promise<MiniMaxVoice[]> {
  if (voiceCache && Date.now() - voiceCache.at < 10 * 60 * 1000) return voiceCache.voices;
  const c = cfg();
  const res = await fetch(`${c.baseUrl}/v1/get_voice`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ voice_type: "system" }),
    signal: AbortSignal.timeout(60 * 1000),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`minimax get_voice ${res.status}: ${raw.slice(0, 300)}`);
  const d = JSON.parse(raw);
  if (d.base_resp && d.base_resp.status_code !== 0) throw new Error(`minimax get_voice: ${d.base_resp.status_msg}`);
  const voices: MiniMaxVoice[] = (d.system_voice ?? []).map((v: { voice_id: string; voice_name: string; description?: string[] }) => ({
    voiceId: v.voice_id,
    name: v.voice_name,
    description: v.description ?? [],
  }));
  voiceCache = { at: Date.now(), voices };
  return voices;
}

/** 用系统音色合成一段 mp3，返回二进制。 */
export async function synthesize(opts: { voiceId: string; text: string; speed?: number; model?: string }): Promise<{ buffer: Buffer; mime: string; durationMs?: number }> {
  const c = cfg();
  const body = {
    model: opts.model ?? c.ttsModel,
    text: opts.text,
    stream: false,
    voice_setting: { voice_id: opts.voiceId, speed: opts.speed ?? 1.0, vol: 1.0, pitch: 0 },
    audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
  };
  const res = await fetch(`${c.baseUrl}/v1/t2a_v2`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(3 * 60 * 1000),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`minimax t2a ${res.status}: ${raw.slice(0, 300)}`);
  const d = JSON.parse(raw);
  if (d.base_resp && d.base_resp.status_code !== 0) throw new Error(`minimax t2a: ${d.base_resp.status_msg}`);
  const hex: string | undefined = d.data?.audio;
  if (!hex) throw new Error(`minimax t2a: 响应无 audio: ${raw.slice(0, 200)}`);
  return { buffer: Buffer.from(hex, "hex"), mime: "audio/mpeg", durationMs: d.extra_info?.audio_length };
}

/** 参考样本统一用这段中性台词，约 12 秒。 */
/**
 * 语音识别。中转站没有这个接口，只能走 MiniMax 国内平台。
 * 用途：视频出完之后自动把人声转成文字，版本对比时一眼看出哪条念错了。
 */
export async function transcribe(audio: Buffer, fileName = "a.mp3"): Promise<string> {
  const base = (process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com").replace(/\/$/, "");
  const key = process.env.MINIMAX_API_KEY;
  if (!key) throw new Error("缺少 MINIMAX_API_KEY");
  const fd = new FormData();
  fd.set("model", "asr-1.0");
  fd.set("file", new Blob([new Uint8Array(audio)]), fileName);
  const res = await fetch(`${base}/v1/speech_to_text`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: fd, signal: AbortSignal.timeout(2 * 60 * 1000) });
  const raw = await res.text();
  if (!res.ok) throw new Error(`asr ${res.status}: ${raw.slice(0, 200)}`);
  return String(JSON.parse(raw).text ?? "").trim();
}

export const VOICE_SAMPLE_TEXT =
  "你听，雪已经停了。我从山门走到这里，用了整整一夜。有些话我只说一遍，你若不信，便当我没有来过。";
