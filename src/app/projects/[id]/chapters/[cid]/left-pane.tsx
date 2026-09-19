"use client";

import { useRef, useState } from "react";
import type { Chapter, Project, Shot, Unit } from "@/lib/types";
import { STATUS_LABEL, isGenerating } from "@/lib/status";
import { useAct } from "@/components/use-act";
import { Avatar, Button, Mono, Placeholder, Stamp, StatusStamp, Textarea, cx } from "@/components/ui";
import { charName, frameAspect } from "./shared";
import { FrameModeToggle, ShotEditor } from "./shot-editor";

/** 分镜组只是叙事划分：一段连续的小情节，同场景同时间同光线。它本身没有产物。 */
export function UnitHeader({ unit, shots, narrated }: { unit: Unit; shots: Shot[]; narrated?: boolean }) {
  const dur = shots.reduce((a, s) => a + s.duration, 0);
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-paper px-4 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <Mono className="shrink-0 text-[10.5px] uppercase text-ink-3">U{unit.index || "-"}</Mono>
        <span className="truncate text-[12px] text-ink-2">{unit.summary}</span>
      </div>
      <Mono className="shrink-0 text-[10.5px] text-ink-3">
        {shots.length} {narrated ? "页" : "镜"} · {dur}s
      </Mono>
    </header>
  );
}

export function LeftPane({
  project,
  chapter,
  current,
  onPickUnit,
  onPickShot,
}: {
  project: Project;
  chapter: Chapter;
  current: Shot | null;
  onPickUnit: (unitId: string) => void;
  onPickShot: (shotId: string) => void;
}) {
  const [tab, setTab] = useState<"board" | "text">("board");
  const activeUnit = current ? chapter.units.find((u) => u.id === current.unitId) : null;
  const framed = chapter.shots.filter((s) => s.frameUrl).length;

  return (
    <aside className="flex min-h-0 flex-col border-r border-line bg-paper">
      <header className="sticky top-0 z-20 flex items-center gap-1 border-b border-line bg-paper px-3 py-1.5">
        {(
          [
            ["board", "画面", `${framed}/${chapter.shots.length}`],
            ["text", "原文", `${chapter.sourceText.join("").length} 字`],
          ] as const
        ).map(([k, label, meta]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cx(
              "flex items-baseline gap-1.5 rounded-sm border px-2 py-0.5 text-[12px] transition-colors",
              tab === k ? "border-line-strong bg-panel text-ink" : "border-transparent text-ink-2 hover:text-ink",
            )}
          >
            {label}
            <Mono className="text-[9.5px] text-ink-3">{meta}</Mono>
          </button>
        ))}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "text" ? (
          <div className="px-5 py-4">
            {chapter.sourceText.map((para, i) => {
              const unit = chapter.units.find((u) => i >= u.sourceRange[0] && i <= u.sourceRange[1]);
              const active = unit && activeUnit && unit.id === activeUnit.id;
              return (
                <p
                  key={i}
                  onClick={() => unit && onPickUnit(unit.id)}
                  className={cx("relative mb-3 cursor-pointer border-l-2 pl-3 font-serif text-[13.5px] leading-[1.9] transition-colors", active ? "border-cinnabar text-ink" : "border-transparent text-ink-2 hover:text-ink")}
                >
                  {para}
                </p>
              );
            })}
            {chapter.sourceText.length === 0 && <p className="py-6 text-center text-[12px] text-ink-3">这一章没有原文</p>}
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-3">
            {chapter.units.map((u) => {
              const us = chapter.shots.filter((s) => s.unitId === u.id);
              if (!us.length) return null;
              return (
                <section key={u.id}>
                  <div className="mb-1.5 flex items-baseline gap-1.5">
                    <Mono className="shrink-0 text-[10px] uppercase text-ink-3">U{u.index}</Mono>
                    <span className="truncate text-[11.5px] text-ink-2" title={u.summary}>
                      {u.summary}
                    </span>
                  </div>
                  <div className={cx("grid gap-1.5", project.orientation === "16:9" ? "grid-cols-2" : "grid-cols-3")}>
                    {us.map((s) => {
                      const active = current?.id === s.id;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => onPickShot(s.id)}
                          title={project.kind === "narrated" ? `第 ${s.index} 页\n${s.narration || s.scene}` : `#${String(s.index).padStart(2, "0")} ${s.shotSize} ${s.duration}s\n${s.action || s.scene}`}
                          className={cx("group relative block overflow-hidden rounded-sm border transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-px hover:shadow-md", active ? "border-cinnabar shadow-sm" : "border-line hover:border-line-strong")}
                        >
                          {s.frameUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={s.frameUrl} alt="" className="w-full object-cover" style={{ aspectRatio: frameAspect(project.orientation) }} />
                          ) : (
                            <div className="placeholder flex items-center justify-center text-[9.5px] text-ink-3" style={{ aspectRatio: frameAspect(project.orientation) }}>{project.kind === "narrated" ? "无图" : s.frameMode === "text_only" ? "直出" : "无首帧"}</div>
                          )}
                          <span className="absolute left-0 top-0 bg-paper/85 px-1 font-mono text-[9px] leading-[14px]">#{String(s.index).padStart(2, "0")}</span>
                          {s.videoUrl && <span className="absolute right-0 top-0 bg-moss px-1 font-mono text-[9px] leading-[14px] text-paper">▶</span>}
                          <span className="absolute inset-x-0 bottom-0 bg-paper/85 text-center font-mono text-[9px] leading-[14px] text-ink-2">{project.kind === "narrated" && !s.videoUrl ? `${(s.utterances ?? []).length} 条` : `${s.duration}s`}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
            {chapter.units.length === 0 && <p className="py-6 text-center text-[12px] text-ink-3">还没有分镜组</p>}
          </div>
        )}
      </div>
    </aside>
  );
}

/* ================================================================== */

export function ShotRow({
  shot,
  project,
  chapter,
  active,
  checked,
  onSelect,
  onCheck,
  onToggleFrameMode,
  order = 0,
}: {
  order?: number;
  shot: Shot;
  project: Project;
  chapter: Chapter;
  active: boolean;
  checked: boolean;
  onSelect: () => void;
  onCheck: () => void;
  onToggleFrameMode: () => void;
}) {
  const firstLine = shot.dialogue[0];
  const narrated = project.kind === "narrated";
  return (
    <li id={`shot-${shot.id}`} style={{ "--i": order } as React.CSSProperties} className={cx("border-b border-line transition-colors duration-200", active ? "bg-paper" : "hover:bg-paper/60")}>
      <div onClick={onSelect} className={cx("grid cursor-pointer grid-cols-[28px_40px_36px_70px_1fr_88px_72px_110px] items-center gap-2 border-l-2 px-4 py-2 transition-[border-color,padding] duration-200", active ? "border-cinnabar pl-[14px]" : "border-transparent")}>
        <input type="checkbox" className="accent-cinnabar" checked={checked} onChange={onCheck} onClick={(e) => e.stopPropagation()} />
        <Mono className="text-[12px] text-ink-2">
          #{String(shot.index).padStart(2, "0")}
        </Mono>
        <Mono className="text-[11.5px]">{narrated ? (shot.videoUrl ? `${shot.duration}s` : "—") : `${shot.duration}s`}</Mono>
        <span className="text-[12px]">{narrated ? <Mono className="text-[10.5px] text-ink-3">{(shot.utterances ?? []).length} 条</Mono> : shot.shotSize}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              {shot.characters.map((c) => (
                <Avatar key={c.characterId + c.personaTag} name={charName(project, c.characterId)} tag={c.personaTag} size={22} />
              ))}
            </div>
            <span className="truncate text-[12.5px]">
              {narrated && shot.narration ? (
                <span className="text-ink-2">{shot.narration}</span>
              ) : firstLine ? (
                <>
                  <span className="text-ink-2">{charName(project, firstLine.characterId)}：</span>「{firstLine.line}」
                </>
              ) : (
                <span className="text-ink-2">{shot.action || shot.scene || (narrated ? "（空页）" : "（空镜头）")}</span>
              )}
            </span>
            {shot.bgmTrackName && <Mono className="shrink-0 rounded-sm border border-line px-1 text-[9.5px] text-ink-3">♪ {shot.bgmTrackName}</Mono>}
          </div>
        </div>
        {narrated ? <span /> : <FrameModeToggle mode={shot.frameMode} onToggle={onToggleFrameMode} />}
        <div className="flex items-center">{shot.needsReview && <Stamp tone="cinnabar">复核</Stamp>}</div>
        <div className="flex justify-end">
          <StatusStamp status={shot.status} withLabel={false} />
        </div>
      </div>
      {active && <ShotEditor shot={shot} project={project} chapter={chapter} />}
    </li>
  );
}

