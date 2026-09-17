import type { ShotStatus } from "./types";

export const STATUS_LABEL: Record<ShotStatus, string> = {
  draft: "待审分镜",
  storyboard_approved: "分镜已审",
  frame_generating: "首帧生成中",
  frame_ready: "待审首帧",
  frame_approved: "首帧已审",
  video_queued: "排队中",
  video_generating: "视频生成中",
  video_ready: "待验收",
  done: "完成",
};

export const STATUS_CODE: Record<ShotStatus, string> = {
  draft: "SB·00",
  storyboard_approved: "SB·OK",
  frame_generating: "FR···",
  frame_ready: "FR·RV",
  frame_approved: "FR·OK",
  video_queued: "VD·Q",
  video_generating: "VD···",
  video_ready: "VD·RV",
  done: "DONE",
};

export type Tone = "neutral" | "amber" | "indigo" | "moss" | "cinnabar";

export const STATUS_TONE: Record<ShotStatus, Tone> = {
  draft: "amber",
  storyboard_approved: "neutral",
  frame_generating: "indigo",
  frame_ready: "amber",
  frame_approved: "neutral",
  video_queued: "indigo",
  video_generating: "indigo",
  video_ready: "amber",
  done: "moss",
};

export const STATUS_ORDER: ShotStatus[] = [
  "draft",
  "storyboard_approved",
  "frame_generating",
  "frame_ready",
  "frame_approved",
  "video_queued",
  "video_generating",
  "video_ready",
  "done",
];

export function isGenerating(s: ShotStatus): boolean {
  return s === "frame_generating" || s === "video_generating" || s === "video_queued";
}

export function formatTimecode(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
