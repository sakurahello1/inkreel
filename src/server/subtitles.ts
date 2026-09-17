import type { AsrWord } from "./providers/fal-asr";
import { splitSentences } from "./ffmpeg";

/** 一条字幕：文本 + 在原始成片里的起止秒 */
export interface SubtitleCue {
  text: string;
  start: number;
  end: number;
}

const PUNCT = /[\s，。！？、；：,.!?;:'"“”‘’（）()「」『』【】《》—…·\-]/g;
const strip = (s: string) => s.replace(PUNCT, "");

/**
 * 把台词句子对到 Whisper 的字级时间戳上。
 *
 * 思路：期望文本与识别文本都去掉标点，按字做一次最长公共子序列；每个句子的起止时间
 * 取它对上的第一个字与最后一个字。识别错几个字没关系，对上的字够定位就行；
 * 整句一个字都没对上（模型没念、或念得面目全非）就按邻句插值，别让它凭空消失。
 */
export function alignCues(lines: string[], words: AsrWord[], opts: { pad?: { before: number; after: number }; minLen?: number } = {}): SubtitleCue[] {
  const sentences = lines.map((l) => l.trim()).filter(Boolean).flatMap((l) => splitSentences(l));
  if (!sentences.length) return [];
  const pad = opts.pad ?? { before: 0.18, after: 0.28 };
  const minLen = opts.minLen ?? 0.7;

  // 识别文本展开成逐字 + 每个字的时间（一个 chunk 里多个字就线性均分）
  const asr: Array<{ ch: string; start: number; end: number }> = [];
  for (const w of words) {
    const chars = [...strip(w.text)];
    if (!chars.length) continue;
    const step = (w.end - w.start) / chars.length;
    chars.forEach((ch, i) => asr.push({ ch, start: w.start + step * i, end: w.start + step * (i + 1) }));
  }

  // 期望文本逐字，记住每个字属于第几句
  const exp: Array<{ ch: string; sent: number }> = [];
  sentences.forEach((s, si) => [...strip(s)].forEach((ch) => exp.push({ ch, sent: si })));

  // LCS 回溯，得到 exp[i] ↔ asr[j] 的匹配
  const n = exp.length;
  const m = asr.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = exp[i].ch === asr[j].ch ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const match = new Array<number>(n).fill(-1);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (exp[i].ch === asr[j].ch) {
      match[i] = j;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }

  // 每句的起止：对上的第一个 / 最后一个字
  const raw = sentences.map((text, si) => {
    const idx = exp.map((e, k) => (e.sent === si ? match[k] : -1)).filter((x) => x >= 0);
    if (!idx.length) return { text, start: NaN, end: NaN, hit: 0 };
    return { text, start: asr[idx[0]].start, end: asr[idx[idx.length - 1]].end, hit: idx.length };
  });

  // 没对上的句子：按邻句之间的空档插值；两头没邻居就贴着音频开头 / 结尾
  const audioStart = asr[0]?.start ?? 0;
  const audioEnd = asr[asr.length - 1]?.end ?? 0;
  for (let k = 0; k < raw.length; k++) {
    if (!Number.isNaN(raw[k].start)) continue;
    const prev = [...raw.slice(0, k)].reverse().find((r) => !Number.isNaN(r.start));
    const next = raw.slice(k + 1).find((r) => !Number.isNaN(r.start));
    const a = prev ? prev.end : audioStart;
    const b = next ? next.start : audioEnd;
    const gapLen = Math.max(minLen, b - a);
    raw[k].start = a;
    raw[k].end = a + gapLen;
  }

  // 加一点提前量与延后量，保证不重叠、不倒序、不短于 minLen
  const out: SubtitleCue[] = [];
  for (let k = 0; k < raw.length; k++) {
    let start = Math.max(0, raw[k].start - pad.before);
    let end = raw[k].end + pad.after;
    if (out.length && start < out[out.length - 1].end + 0.05) start = out[out.length - 1].end + 0.05;
    if (end < start + minLen) end = start + minLen;
    out.push({ text: raw[k].text, start: round(start), end: round(end) });
  }
  return out;
}

const round = (x: number) => Math.round(x * 100) / 100;

/** 期望文本与识别文本的相似度（0–1），用来提醒「这条念错了 / 没念」 */
export function textSimilarity(expected: string, heard: string) {
  const a = [...strip(expected)];
  const b = [...strip(heard)];
  if (!a.length || !b.length) return 0;
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  return dp[0][0] / Math.max(a.length, b.length);
}
