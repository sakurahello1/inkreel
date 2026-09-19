/**
 * 字幕条的切分：纯函数，页渲染与测试共用。
 * MiniMax 的「句级」时间戳有时把整段旁白当一句返回，屏幕上会一次糊三行；
 * 超长的按句号再按逗号切成不超过 MAX_CUE_CHARS 的小段，时间按字数比例摊。
 */

export interface Cue {
  text: string;
  start: number;
  end: number;
}

/** 一条字幕最多这么多字，再长就切开 */
export const MAX_CUE_CHARS = 24;

/** 按句号问号感叹号拆句；没有标点就整段返回 */
export function splitSentences(text: string) {
  const parts = text
    .split(/(?<=[。！？!?])/)
    .map((x) => x.trim())
    .filter(Boolean);
  return parts.length ? parts : [text.trim()];
}

/** 一句还是太长：按逗号顿号分号冒号贪心拼成不超过上限的小段 */
export function chunkByComma(sentence: string, max = MAX_CUE_CHARS) {
  const parts = sentence.split(/(?<=[，、；,;：:])/).map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const part of parts) {
    if (cur && cur.length + part.length > max) {
      out.push(cur);
      cur = part;
    } else cur += part;
  }
  if (cur) out.push(cur);
  return out.length ? out : [sentence];
}

/** 把一条（可能很长的）字幕切成若干条，时间按字数比例分摊在 [start, end] 上 */
export function splitCue(text: string, start: number, end: number, max = MAX_CUE_CHARS): Cue[] {
  const clean = text.trim();
  if (clean.length <= max) return [{ text: clean, start, end }];
  const sents = splitSentences(clean).flatMap((x) => (x.length <= max ? [x] : chunkByComma(x, max)));
  if (sents.length <= 1) return [{ text: clean, start, end }];
  const total = sents.reduce((a, x) => a + Math.max(2, x.length), 0);
  const out: Cue[] = [];
  let st = start;
  for (const x of sents) {
    const d = (Math.max(2, x.length) / total) * (end - start);
    out.push({ text: x, start: st, end: st + d });
    st += d;
  }
  return out;
}
