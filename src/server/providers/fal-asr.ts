/**
 * fal 上的 Whisper：带词级时间戳的转写。
 *
 * MiniMax 自家的 asr-1.0 只回整段文本没有时间，对齐字幕用不了；
 * Whisper large 的中文识别够用，主要要的是每个字落在哪一秒。
 */
const QUEUE = "https://queue.fal.run";
const MODEL = process.env.FAL_ASR_MODEL || "fal-ai/whisper";

export interface AsrWord {
  start: number;
  end: number;
  text: string;
}

function key() {
  const k = process.env.FAL_KEY;
  if (!k) throw new Error("缺少 FAL_KEY");
  return k;
}

export async function falTranscribeWords(audio: Buffer, mime = "audio/mpeg"): Promise<{ text: string; words: AsrWord[] }> {
  const body = {
    audio_url: `data:${mime};base64,${audio.toString("base64")}`,
    task: "transcribe",
    language: "zh",
    chunk_level: "word",
  };
  const res = await fetch(`${QUEUE}/${MODEL}`, {
    method: "POST",
    headers: { Authorization: `Key ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60 * 1000),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`fal asr ${res.status}: ${raw.slice(0, 300)}`);
  const { request_id: rid } = JSON.parse(raw);
  const base = `${QUEUE}/${MODEL}/requests/${rid}`;
  const started = Date.now();
  for (;;) {
    const st = await fetch(`${base}/status`, { headers: { Authorization: `Key ${key()}` }, signal: AbortSignal.timeout(30 * 1000) }).then((r) => r.json());
    if (st.status === "COMPLETED") break;
    if (st.status !== "IN_QUEUE" && st.status !== "IN_PROGRESS") throw new Error(`fal asr 状态 ${st.status}`);
    if (Date.now() - started > 3 * 60 * 1000) throw new Error("fal asr 超时");
    await new Promise((r) => setTimeout(r, 1000));
  }
  const out = await fetch(base, { headers: { Authorization: `Key ${key()}` }, signal: AbortSignal.timeout(30 * 1000) }).then((r) => r.json());
  const words: AsrWord[] = (out.chunks ?? [])
    .map((c: { timestamp: [number, number]; text: string }) => ({ start: Number(c.timestamp?.[0] ?? 0), end: Number(c.timestamp?.[1] ?? 0), text: String(c.text ?? "") }))
    .filter((w: AsrWord) => w.text.trim());
  return { text: String(out.text ?? "").trim(), words };
}
