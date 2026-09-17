export type ShotStatus =
  | "draft"
  | "storyboard_approved"
  | "frame_generating"
  | "frame_ready"
  | "frame_approved"
  | "video_queued"
  | "video_generating"
  | "video_ready"
  | "done";

export type FrameMode = "image" | "text_only";

export type ShotSize = "大远景" | "远景" | "全景" | "中景" | "近景" | "特写" | "大特写";

export type GenStatus = "none" | "generating" | "ready" | "failed";

export interface Persona {
  id: string;
  tag: string;
  description: string;
  prompt: string;
  sheetReady: boolean;
  sheetUrl?: string | null;
  status?: GenStatus;
  error?: string;
}

export interface Voice {
  source: "none" | "upload" | "minimax_system";
  label: string;
  sampleReady: boolean;
  voiceId?: string | null;
  sampleUrl?: string | null;
  status?: GenStatus;
  error?: string;
}

export interface Character {
  id: string;
  name: string;
  age: string;
  role: string;
  personality: string;
  catchphrase: string;
  relations: string;
  personas: Persona[];
  voice: Voice;
}

export interface ShotCharacter {
  characterId: string;
  personaTag: string;
}

export interface DialogueLine {
  characterId: string;
  line: string;
  tone: string;
}

export interface GenerationView {
  id: string;
  kind: string;
  /** 关键帧产物挂在哪个关键帧上 */
  keyframeId?: string | null;
  model: string;
  status: string;
  progress: string;
  error: string;
  cost: number;
  createdAt: string;
}

/** 镜头时间线上的一个画面锚点。at 为秒，-1 = 镜头结束 */
export interface Keyframe {
  id: string;
  at: number;
  prompt: string;
  /** 到达这一帧的那一段视频的提示词；空 = 用镜头的视频提示词 */
  segmentPrompt?: string;
  url: string | null;
  freshness?: "none" | "fresh" | "stale";
}

export const VIDEO_ROUTE_LABEL = {
  i2v: "首帧模式",
  flf: "首尾帧 · 起止钉死",
  segments: "分段首尾帧 · 每段起止钉死后拼接",
} as const;

export interface Shot {
  id: string;
  index: number;
  unitId: string;
  /** 拆镜写下来的场景文字（地点·时间·天气） */
  scene: string;
  /** 挂在场景库上的场景资产 id */
  sceneId?: string | null;
  /** 承接上一镜：出首帧时把上一镜成片末帧当参考图 */
  usePrevLastFrame?: boolean;
  /** 本镜首帧推理等级覆盖；空 = 跟随项目 */
  frameQuality?: string;
  /** 创作者手动补充的首帧参考图 */
  extraRefs?: Array<{ id: string; label: string; url: string | null }>;
  shotSize: ShotSize;
  camera: string;
  duration: number;
  characters: ShotCharacter[];
  dialogue: DialogueLine[];
  emotion: string;
  action: string;
  sound: string;
  framePrompt: string;
  videoPrompt: string;
  frameMode: FrameMode;
  status: ShotStatus;
  needsReview?: boolean;
  reviewNote?: string;
  rewriting?: boolean;
  cost: number;
  frameUrl?: string | null;
  /** 首帧之外的关键帧，按时间排（结尾 at=-1 在最后） */
  keyframes?: Keyframe[];
  /** 上次从哪条预演、第几秒截的首帧；打开镜头时进度条跳回去 */
  previzGenerationId?: string | null;
  previzTime?: number;
  /** 首帧模式下视频走哪条路：i2v 只有首帧 | flf 首尾帧钉死 | segments 分段首尾帧拼接 */
  videoRoute?: "i2v" | "flf" | "segments";
  videoUrl?: string | null;
  videoDuration?: number | null;
  bgmTrackId?: string | null;
  bgmTrackName?: string | null;
  bgmToModel?: boolean;
  propIds?: string[];
  /** 三级产物的新鲜度：none 无产物 | fresh 与当前输入一致 | stale 输入已变 */
  freshness?: { frame: "none" | "fresh" | "stale"; video: "none" | "fresh" | "stale"; keyframes: Record<string, "none" | "fresh" | "stale"> };
  /** 各级实际喂进模型的输入，画布用它连线 */
  lineage?: {
    frame: Array<{ assetId?: string; role: string; label: string }>;
    video: Array<{ assetId?: string; role: string; label: string }>;
  };
  generations?: GenerationView[];
  clip?: {
    order: number | null;
    in: number;
    out: number | null;
    enabled: boolean;
    subtitle: string;
    fadeIn: number;
    fadeOut: number;
    /** 对齐后的字幕（相对原始成片的秒） */
    cues?: Array<{ text: string; start: number; end: number }>;
    /** 对齐时识别出的话；asrFresh 为假表示成片换过、需要重对 */
    asrText?: string;
    asrFresh?: boolean;
  };
}

/** 分镜组：一段连续的小情节。只用于叙事划分与配乐的连续段落，不再有自己的产物。 */
export interface Unit {
  id: string;
  index: number;
  summary: string;
  sourceRange: [number, number];
}

export interface Chapter {
  id: string;
  index: number;
  title: string;
  sourceText: string[];
  units: Unit[];
  shots: Shot[];
  updatedAt: string;
  agentStatus?: "idle" | "running" | "failed";
  agentError?: string;
  timeline?: {
    bgmVolume: number;
    subtitles: boolean;
    exportUrl: string | null;
    exportStatus: "none" | "running" | "ready" | "failed";
    exportError: string;
    exportDuration: number | null;
  };
}

/** 一条分镜预演：一章（或其中一批）镜头快速闪过的视频，人从里面截首帧 */
export interface PrevizRun {
  id: string;
  status: string;
  progress: string;
  error: string;
  label: string;
  url: string | null;
  duration: number;
  width: number | null;
  height: number | null;
  slots: Array<{ shotId: string; index: number; start: number; end: number; text: string }>;
  slotSeconds: number;
  resolution: string;
  batch: number;
  batches: number;
  refs: string[];
  cost: number;
  model: string;
  prompt: string;
  createdAt: string;
}

export interface StyleRef {
  id: string;
  url: string;
}

/** 场景 / 拍摄地点。与道具同构，产物是一张空间基准图 */
export interface Scene {
  id: string;
  name: string;
  description: string;
  prompt: string;
  sheetUrl: string | null;
  status: GenStatus;
  error: string;
}

/** fal gpt-image-2.5 flare 官方价目（美元/张）。前端展示用；服务端计价在 providers/image-fal.ts */
export const IMAGE_QUALITY_OPTIONS = ["low", "medium", "high", "xhigh", "max"] as const;
export type ImageQualityOption = (typeof IMAGE_QUALITY_OPTIONS)[number];
const IMAGE_PRICE: Array<{ px: number } & Record<ImageQualityOption, number>> = [
  { px: 1024 * 768, low: 0.00402, medium: 0.00903, high: 0.03612, xhigh: 0.0642, max: 0.14445 },
  { px: 1024 * 1024, low: 0.00588, medium: 0.01317, high: 0.05268, xhigh: 0.09366, max: 0.21072 },
  { px: 1024 * 1536, low: 0.00474, medium: 0.01029, high: 0.04116, xhigh: 0.07377, max: 0.16464 },
  { px: 1920 * 1080, low: 0.00441, medium: 0.01029, high: 0.0396, xhigh: 0.07041, max: 0.1584 },
  { px: 2560 * 1440, low: 0.00615, medium: 0.01434, high: 0.05529, xhigh: 0.09828, max: 0.2211 },
  { px: 3840 * 2160, low: 0.01113, medium: 0.02595, high: 0.10008, xhigh: 0.1779, max: 0.40026 },
];
export function imagePrice(quality: string, orientation?: string) {
  const px = 2560 * 1440; // 首帧尺寸，横竖屏像素数一样
  void orientation;
  const row = IMAGE_PRICE.reduce((b, r) => (Math.abs(r.px - px) < Math.abs(b.px - px) ? r : b), IMAGE_PRICE[0]);
  const q = (IMAGE_QUALITY_OPTIONS as readonly string[]).includes(quality) ? (quality as ImageQualityOption) : "low";
  return row[q];
}

export interface Prop {
  id: string;
  name: string;
  description: string;
  prompt: string;
  sheetUrl: string | null;
  status: GenStatus;
  error: string;
}

export interface BgmTrack {
  id: string;
  name: string;
  mood: string;
  description: string;
  volume: number;
  url: string;
  duration: number | null;
}

export interface Project {
  id: string;
  title: string;
  genre: string[];
  orientation: "9:16" | "16:9";
  targetEpisodes: number;
  world: string;
  style: string;
  styleRefs: number;
  videoEngine?: string;
  videoResolution?: string;
  /** 直出镜头是否把场景 / 人设图当参考送进模型（fal 上走 H3 Max，两倍价） */
  textOnlyRefs?: boolean;
  /** 分段路线每段的最短秒数（fal 5 / 中转站 4），中间帧的时间点受它约束 */
  minSegmentSeconds?: number;
  /** 出图推理等级默认档：low | medium | high | xhigh | max */
  imageQuality?: string;
  styleRefItems?: StyleRef[];
  bgmTracks?: BgmTrack[];
  props?: Prop[];
  scenes?: Scene[];
  characters: Character[];
  chapters: Chapter[];
  updatedAt: string;
}

export interface VoiceOption {
  voiceId: string;
  name: string;
}
