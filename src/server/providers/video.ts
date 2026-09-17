/**
 * 中转站（api.lk888.ai）上的 MiniMax H3 三个变体：
 *  - hailuo-h3               文生视频：prompt + aspect_ratio
 *  - hailuo-h3-shouweizhen   首尾帧：images[1-2]，比例跟随图片
 *  - hailuo-h3-quannengcankao 全能参考：image_url[≤9] + audio_url[≤3] + video_url[≤3]
 * 统一：POST /v1/media/generate → task_id；GET /v1/media/status?task_id= 轮询 is_final。
 */

import { FAL_MIN_DURATION, falCreateVideoTask, falEstimateVideoCost, falQueryVideoTask, falVideoModel } from "./video-fal";

/**
 * 视频后端：relay（中转站）| fal（fal.ai 的 H3 Max Turbo）。
 * 任务代码只认这个文件导出的 createVideoTask / queryVideoTask / videoModelFor / estimateVideoCost，
 * 切后端只改 VIDEO_PROVIDER 这一个环境变量。
 */
export type VideoBackend = "relay" | "fal";
export function videoBackend(): VideoBackend {
  return (process.env.VIDEO_PROVIDER || "relay") === "fal" ? "fal" : "relay";
}

export type VideoVariant = "t2v" | "i2v" | "ref";
/** 视频引擎：h3 = MiniMax 海螺 H3 三变体；omni = Omni 1.1（3–10s，720P/1080P/4K，仅 1 张首帧） */
export type VideoEngine = "h3" | "omni";

export const ENGINES: Record<VideoEngine, { label: string; model: string; minDuration: number; maxDuration: number; resolutions: string[]; note: string }> = {
  h3: {
    label: "MiniMax H3",
    model: "hailuo-h3",
    minDuration: 4,
    maxDuration: 15,
    resolutions: ["768P", "1080P", "2K"],
    note: "4–15 秒，可带人物参考图与参考音频；有时段折扣，0–9 点约三分之一价",
  },
  omni: {
    label: "Omni 1.1",
    model: "omni-1.1",
    minDuration: 3,
    maxDuration: 10,
    resolutions: ["720P", "1080P", "4K"],
    note: "3–10 秒，只收 1 张首帧，出片更快；无时段折扣",
  },
};

export interface VideoCreateInput {
  engine?: VideoEngine;
  variant: VideoVariant;
  prompt: string;
  duration: number; // 4-15
  resolution?: string; // 768P | 1080P | 2K
  aspectRatio?: string; // 9:16 ...
  /** data: URL 或公网 URL */
  images?: string[];
  audios?: string[];
  videos?: string[];
}

export interface VideoStatus {
  taskId: string;
  state: "pending" | "running" | "success" | "failed";
  isFinal: boolean;
  progress: string;
  resultUrl: string;
  error: string;
  cost: number;
  raw: unknown;
}

function cfg() {
  const baseUrl = (process.env.VIDEO_BASE_URL || "").replace(/\/$/, "");
  const apiKey = process.env.VIDEO_API_KEY || "";
  if (!baseUrl || !apiKey) throw new Error("缺少 VIDEO_BASE_URL / VIDEO_API_KEY");
  return {
    baseUrl,
    apiKey,
    models: {
      t2v: process.env.VIDEO_MODEL_T2V || "hailuo-h3",
      i2v: process.env.VIDEO_MODEL_I2V || "hailuo-h3-shouweizhen",
      ref: process.env.VIDEO_MODEL_REF || "hailuo-h3-quannengcankao",
    },
    resolution: process.env.VIDEO_RESOLUTION || "768P",
    omniModel: process.env.VIDEO_MODEL_OMNI || "omni-1.1",
  };
}

export function videoModelFor(variant: VideoVariant, engine: VideoEngine = "h3") {
  if (videoBackend() === "fal" && engine !== "omni") return falVideoModel(variant);
  return engine === "omni" ? cfg().omniModel : cfg().models[variant];
}

/** 分段路线每段的最短时长：fal 的 H3 是 5 秒，中转站 4 秒。中间关键帧的时间点必须让每一段都不短于它 */
export function minSegmentSeconds() {
  return videoBackend() === "fal" ? FAL_MIN_DURATION : ENGINES.h3.minDuration;
}

/** 各引擎的时长上下限 */
export function clampDuration(seconds: number, engine: VideoEngine = "h3") {
  const e = ENGINES[engine];
  return Math.min(e.maxDuration, Math.max(e.minDuration, Math.round(seconds)));
}

export function buildVideoRequest(input: VideoCreateInput) {
  const c = cfg();
  const engine: VideoEngine = input.engine ?? "h3";
  const resolution = input.resolution ?? c.resolution;

  if (engine === "omni") {
    // Omni 1.1：三个必填参数 + 最多 1 张首帧，不收参考图/参考音频/参考视频
    const params: Record<string, unknown> = {
      duration: String(clampDuration(input.duration, "omni")),
      resolution,
      aspect_ratio: input.aspectRatio && input.aspectRatio !== "adaptive" ? input.aspectRatio : "9:16",
    };
    if (input.images?.length) params.images = input.images.slice(0, 1);
    return { model: c.omniModel, prompt: input.prompt, params };
  }

  const duration = String(clampDuration(input.duration, "h3"));
  const params: Record<string, unknown> = { duration, resolution };
  if (input.variant === "t2v") {
    params.aspect_ratio = input.aspectRatio ?? "9:16";
  } else if (input.variant === "i2v") {
    if (!input.images?.length) throw new Error("首尾帧模式至少需要 1 张图");
    params.images = input.images.slice(0, 2);
  } else {
    params.aspect_ratio = input.aspectRatio ?? "adaptive";
    if (input.images?.length) params.image_url = input.images.slice(0, 9);
    if (input.audios?.length) params.audio_url = input.audios.slice(0, 3);
    if (input.videos?.length) params.video_url = input.videos.slice(0, 3);
    if (!params.image_url && !params.video_url) throw new Error("全能参考模式至少需要 1 张图或 1 段参考视频");
  }
  return { model: c.models[input.variant], prompt: input.prompt, params };
}

/** 下单前按引擎与档位估算费用，用于界面提示 */
export function estimateVideoCost(seconds: number, engine: VideoEngine, resolution: string, variant?: VideoVariant) {
  if (videoBackend() === "fal" && engine !== "omni") return falEstimateVideoCost(seconds, resolution, variant);
  const d = clampDuration(seconds, engine);
  if (engine === "omni") {
    const mult = resolution === "4K" ? 2.5 : resolution === "1080P" ? 1.6667 : 1;
    return Math.round(0.0987 * d * mult * 100) / 100;
  }
  const mult = resolution === "4K" ? 2.6667 : resolution === "768P" ? 1 : 2;
  const h = new Date().getHours();
  const disc = h < 9 ? 0.3 : h >= 22 ? 0.5 : h >= 18 ? 0.8 : 1;
  return Math.round(0.0986 * d * mult * disc * 100) / 100;
}

export async function createVideoTask(input: VideoCreateInput): Promise<{ taskId: string; raw: unknown }> {
  if (videoBackend() === "fal" && input.engine !== "omni") return falCreateVideoTask(input);
  const c = cfg();
  const body = buildVideoRequest(input);
  const res = await fetch(`${c.baseUrl}/v1/media/generate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(2 * 60 * 1000),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`video create ${res.status}: ${raw.slice(0, 400)}`);
  const data = JSON.parse(raw);
  const taskId = data.task_id ?? data.data?.task_id ?? data.id;
  if (taskId === undefined || taskId === null) throw new Error(`video create: 响应无 task_id: ${raw.slice(0, 300)}`);
  return { taskId: String(taskId), raw: data };
}

export async function queryVideoTask(taskId: string): Promise<VideoStatus> {
  // fal 的 taskId 带 "endpoint::request_id" 前缀，靠这个分流，不依赖当前环境变量——
  // 中途切后端时，已经在跑的任务仍然能按它当初提交的那家去查
  if (taskId.includes("::")) return falQueryVideoTask(taskId);
  const c = cfg();
  const res = await fetch(`${c.baseUrl}/v1/media/status?task_id=${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${c.apiKey}` },
    signal: AbortSignal.timeout(60 * 1000),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`video status ${res.status}: ${raw.slice(0, 300)}`);
  const d = JSON.parse(raw);
  const body = d.data && typeof d.data === "object" && "state" in d.data ? d.data : d;
  return {
    taskId,
    state: (body.state as VideoStatus["state"]) ?? "pending",
    isFinal: Boolean(body.is_final),
    progress: String(body.progress ?? ""),
    resultUrl: String(body.result_url ?? ""),
    error: String(body.error ?? ""),
    cost: Number(body.cost ?? 0),
    raw: d,
  };
}
