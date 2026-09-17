"use client";

import type { Chapter, Project, Shot, ShotStatus } from "@/lib/types";
import type { ChatProviderName } from "@/server/providers/chat";
import { Mono, Stamp } from "@/components/ui";

export const SHOT_SIZES = ["大远景", "远景", "全景", "中景", "近景", "特写", "大特写"];

export const PROVIDERS: Array<{ id: ChatProviderName; label: string; hint: string }> = [
  { id: "chat", label: "gpt-5.6-sol", hint: "约 $0.4 / 5000 字" },
  { id: "deepseek", label: "deepseek-v4-flash", hint: "几乎免费" },
];

/** 生产流程的三个阶段。阶段与镜头状态解绑：状态只决定默认停在哪一页。 */
/** 预览框的宽高比跟着项目画幅走。Tailwind 的 aspect 类要写死，所以用内联 style */
export function frameAspect(orientation?: string) {
  return orientation === "16:9" ? "16 / 9" : "9 / 16";
}
/** 横屏预览可以铺满面板宽度；竖屏太高，限一下宽 */
export function previewMaxW(orientation?: string) {
  return orientation === "16:9" ? "max-w-full" : "max-w-[260px]";
}

export type Stage = "reference" | "frame" | "video";
export const STAGES: Array<{ id: Stage; label: string }> = [
  { id: "reference", label: "参考" },
  { id: "frame", label: "首帧" },
  { id: "video", label: "视频" },
];

export function bgmPlacements(shots: Shot[]) {
  const map = new Map<string, { trackStart: number; len: number; isRunStart: boolean }>();
  let runTrack: string | null = null;
  let runOffset = 0;
  for (const s of shots) {
    if (s.bgmTrackId) {
      const isRunStart = s.bgmTrackId !== runTrack;
      if (isRunStart) {
        runTrack = s.bgmTrackId;
        runOffset = 0;
      }
      map.set(s.id, { trackStart: runOffset, len: s.duration, isRunStart });
      runOffset += s.duration;
    } else {
      runTrack = null;
      runOffset = 0;
    }
  }
  return map;
}

export function charName(project: Project, id: string) {
  return project.characters.find((c) => c.id === id)?.name ?? "?";
}

/* ================================================================== */


export function defaultStage(status: ShotStatus): Stage {
  if (status === "draft" || status === "storyboard_approved") return "reference";
  if (status === "frame_generating" || status === "frame_ready" || status === "frame_approved") return "frame";
  return "video";
}

/** 过期徽章。stale 是自身输入变了；upstream 是上游变了、自身输入没动 */

export function FreshBadge({ level, upstream }: { level?: "none" | "fresh" | "stale"; upstream?: boolean }) {
  if (!level || level === "none") return null;
  if (level === "stale") return <Stamp tone="cinnabar">已过期</Stamp>;
  if (upstream) return <Stamp tone="cinnabar">上游已变</Stamp>;
  return null;
}

/** 版本条：把该产物的历史版本一字排开，可预览、可设为当前、可在此基础上重跑 */

export function InputList({ items }: { items?: Array<{ role: string; label: string }> }) {
  if (!items?.length) return null;
  const ROLE: Record<string, string> = { scene: "场景", persona: "人设", prop: "道具", style: "画风", frame: "首帧", anchor: "同组锚点", bgm: "BGM" };
  return (
    <div className="mt-3 border-t border-dashed border-line pt-3">
      <div className="mb-1.5 text-[11.5px] tracking-wider text-ink-2">输入</div>
      <ul className="flex flex-wrap gap-1">
        {items.map((i, n) => (
          <li key={n} className="border border-line bg-panel px-1.5 py-0.5 text-[10.5px]">
            <span className="text-ink-3">{ROLE[i.role] ?? i.role}</span> {i.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

type PreviewProps = { shot: Shot; project: Project; chapter: Chapter; placement?: { trackStart: number; len: number; isRunStart: boolean } };


export function Tape({ label }: { label: string }) {
  return (
    <div className="mx-auto mt-2 max-w-[260px]">
      <div className="tape" />
      <Mono className="mt-1 block text-[10px] text-indigo">{label}</Mono>
    </div>
  );
}

