/**
 * 关键帧与参考图顺序的纯函数。服务端（任务拼提示词）和客户端（时间线面板预览）都只用这里的函数，
 * 保证送给模型的图片顺序与提示词里 Image N 对应的文字**永远由同一份数据、同一段代码**生成。
 * 这文件不许 import 任何服务端模块。
 */

/** 关键帧按时间排：结尾（at < 0）永远排最后 */
export function orderKeyframes<T extends { at: number }>(kfs: T[]) {
  return [...kfs].sort((a, b) => (a.at < 0 ? Number.MAX_SAFE_INTEGER : a.at) - (b.at < 0 ? Number.MAX_SAFE_INTEGER : b.at));
}

/** 关键帧的时间点文字 */
export function keyframeWhen(k: { at: number }, duration: number) {
  return k.at < 0 ? `第 ${duration} 秒结束时` : `第 ${k.at} 秒时`;
}

/**
 * 首帧模式下的视频路线，由已出图的关键帧决定：
 *  i2v       没有关键帧：首帧模式
 *  flf       只有结尾一张：首尾帧，起止都钉死
 *  segments  有中间关键帧：拆成若干段，每段都是首尾帧钉死的短片，出完拼接
 *
 * 全能参考那条路（H3 Max）试过：把关键帧当参考图按时间点排，模型认得出顺序，但起止不硬钉、
 * 整体质量也不如 Turbo 的首尾帧。分段拼接每一段都钉死，简单、便宜、可控。
 */
export type VideoRoute = "i2v" | "flf" | "segments";
export function videoRouteOf(shot: { frameMode: string; frameId: string | null; keyframes: Array<{ at: number; assetId: string | null }> }): VideoRoute {
  if (shot.frameMode !== "image" || !shot.frameId) return "i2v";
  const kfs = orderKeyframes(shot.keyframes.filter((k) => k.assetId));
  if (!kfs.length) return "i2v";
  if (kfs.length === 1 && kfs[0].at < 0) return "flf";
  return "segments";
}

/** 一段：从 from（null = 首帧）到 to（null = 镜头结束、没有尾帧），起止秒数 */
export interface Segment<K extends { at: number }> {
  index: number;
  from: K | null;
  to: K | null;
  start: number;
  end: number;
}

/** 按已出图的关键帧把镜头切段。没有尾帧时最后一段开放结尾（只有首帧、不钉终点） */
export function segmentsOf<K extends { at: number; assetId?: string | null; url?: string | null }>(keyframes: K[], duration: number): Array<Segment<K>> {
  const kfs = orderKeyframes(keyframes.filter((k) => ("assetId" in k ? k.assetId : k.url)));
  const out: Array<Segment<K>> = [];
  let from: K | null = null;
  let start = 0;
  for (const k of kfs) {
    const end = k.at < 0 ? duration : k.at;
    out.push({ index: out.length, from, to: k, start, end });
    from = k;
    start = end;
  }
  if (!kfs.length || kfs[kfs.length - 1].at >= 0) out.push({ index: out.length, from, to: null, start, end: duration });
  return out;
}

/** 血缘 / 界面上的短标签 */
export const keyframeLabel = (k: { at: number }, duration?: number) => (k.at < 0 ? `尾帧${duration ? `（第 ${duration} 秒）` : ""}` : `关键帧 @${k.at}s`);

/**
 * 一张送给视频模型的参考图。timeline 为真表示它是镜头时间线上的画面（首帧 / 关键帧 / 尾帧），
 * 为假表示只是人物 / 道具的外貌参考——两类在提示词里的说法不同。
 */
export interface RefImage {
  name: string;
  timeline: boolean;
}

export const FIRST_FRAME_REF: RefImage = { name: "本镜开场第 0 秒的画面", timeline: true };
export const keyframeRef = (k: { at: number }, duration: number): RefImage => ({ name: `${keyframeWhen(k, duration)}的画面`, timeline: true });
export const subjectRef = (label: string): RefImage => ({ name: `${label}的参考图`, timeline: false });

/**
 * 全能参考模式下参考图那一段。refs 必须与实际送出的图片严格同序，Image N 的编号就是数组下标 + 1。
 * fal 的提示词改写器认「Image N」这种叫法，会把带时间点的多图识别成 keyframe completion。
 */
export function referenceImagesLine(refs: RefImage[]) {
  if (!refs.length) return "";
  const items = refs.map((r, i) => `Image ${i + 1} 是${r.name}`);
  const timeline = refs.map((r, i) => (r.timeline ? i + 1 : 0)).filter(Boolean);
  const subjects = refs.map((r, i) => (r.timeline ? 0 : i + 1)).filter(Boolean);
  let s = `参考图：${items.join("；")}。`;
  if (timeline.length >= 2) {
    s += `视频必须严格按 ${timeline.map((n) => `Image ${n}`).join(" → ")} 的先后顺序依次经过这些画面，各画面出现的时刻以上面标注的秒数为准，机位、景别以它们为准，人物外貌、服装、场景与之保持一致。`;
  } else if (timeline.length === 1) {
    s += `视频以 Image ${timeline[0]} 为起始画面，保持人物外貌、服装、场景与之一致。`;
  }
  if (subjects.length) {
    s += `${subjects.map((n) => `Image ${n}`).join("、")} 只作外貌与物件的参考，不是时间线上的画面。`;
  }
  return s;
}
