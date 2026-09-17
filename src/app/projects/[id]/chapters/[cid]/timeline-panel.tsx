"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { VIDEO_ROUTE_LABEL, type Chapter, type Keyframe, type Project, type Shot } from "@/lib/types";
import { orderKeyframes, segmentsOf } from "@/lib/keyframes";
import { addShotKeyframe, generateFrames, generateShotKeyframes, removeShotKeyframe, updateShotKeyframe, useShotNextFirstFrame } from "@/server/actions";
import { useAct } from "@/components/use-act";
import { Button, Mono, Placeholder, Stamp, cx } from "@/components/ui";
import { FreshBadge, frameAspect } from "./shared";
import { KeyframeCard } from "./keyframe-card";

/**
 * 高级时间线面板：一条时间轴，首帧钉在 0 秒、尾帧钉在结尾，中间帧可以点轴新增、拖着改时间点。
 *
 * 右栏的关键帧块是「普通模式」，这里是同一份数据的另一种操作方式，不另存任何状态。
 * 右下角把**将怎样切段出片**照样列出来——它和任务端切段用的是同一个函数（src/lib/keyframes.ts），
 * 每段的首尾图与段提示词不可能对不上。
 */

/** 时间点吸附到整秒：每一段都是独立的一次生成，时长必须是整数秒 */
const SNAP = 1;
const snap = (t: number) => Math.round(t / SNAP) * SNAP;

type Sel = "first" | string;

export function TimelinePanel({ shot, project, chapter, onClose }: { shot: Shot; project: Project; chapter: Chapter; onClose: () => void }) {
  const { act: run, pending } = useAct();
  const kfs = shot.keyframes ?? [];
  const duration = shot.duration;
  const [sel, setSel] = useState<Sel>(kfs[0]?.id ?? "first");
  const trackRef = useRef<HTMLDivElement>(null);
  // 拖动中的临时时间点：松手才落库
  const [drag, setDrag] = useState<{ id: string; at: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 若选中的帧被删了，退回首帧
  useEffect(() => {
    if (sel !== "first" && !kfs.some((k) => k.id === sel)) setSel("first");
  }, [kfs, sel]);

  const posOf = (k: Keyframe) => (drag?.id === k.id ? drag.at : k.at < 0 ? duration : k.at);
  const pct = (t: number) => `${(t / duration) * 100}%`;

  /** 每段最短秒数（fal 5 / 中转站 4）：中间帧只能落在 [minSeg, duration - minSeg] */
  const minSeg = project.minSegmentSeconds ?? 5;
  const canMid = duration >= minSeg * 2;

  /** 鼠标 x → 时间（限制在首尾各留 minSeg 的区间内） */
  const timeAt = (clientX: number) => {
    const el = trackRef.current;
    if (!el || !canMid) return null;
    const r = el.getBoundingClientRect();
    const t = snap(((clientX - r.left) / r.width) * duration);
    return Math.min(duration - minSeg, Math.max(minSeg, t));
  };

  const addAt = (t: number) => {
    if (kfs.some((k) => k.at === t)) return;
    run(async () => { const id = await addShotKeyframe(project.id, chapter.id, shot.id, t); setSel(id); });
  };

  const startDrag = (k: Keyframe) => (e: React.PointerEvent) => {
    if (k.at < 0) return; // 尾帧钉在结尾
    e.preventDefault();
    setSel(k.id);
    setDrag({ id: k.id, at: k.at });
    const move = (ev: PointerEvent) => { const t = timeAt(ev.clientX); if (t !== null) setDrag({ id: k.id, at: t }); };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const t = timeAt(ev.clientX);
      setDrag(null);
      if (t !== null && t !== k.at && !kfs.some((x) => x.id !== k.id && x.at === t)) run(() => updateShotKeyframe(project.id, chapter.id, k.id, { at: t }));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const route = shot.videoRoute ?? "i2v";
  const ordered = orderKeyframes(kfs);
  // 分段预览：只有已出图的帧参与切段，和任务端 segmentsOf 用的是同一个函数
  const segs = useMemo(() => segmentsOf(ordered, duration), [ordered, duration]);


  const hasEnd = kfs.some((k) => k.at < 0);
  const selected = sel === "first" ? null : kfs.find((k) => k.id === sel) ?? null;
  const ticks = Array.from({ length: Math.floor(duration) + 1 }, (_, i) => i);
  const withPrompt = kfs.filter((k) => k.prompt.trim()).length;
  const price = project.videoPerSecond ?? 0.01;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-paper">
      <header className="flex items-center justify-between border-b border-line px-4 py-2">
        <div className="flex items-center gap-3">
          <Mono className="text-[13px]">#{String(shot.index).padStart(2, "0")}</Mono>
          <span className="text-[13px] text-ink-2">{shot.shotSize} · {duration}s · 时间线</span>
          <Stamp tone={route === "i2v" ? "neutral" : "cinnabar"}>{VIDEO_ROUTE_LABEL[route]}</Stamp>
          <Mono className="text-[10.5px] text-ink-3">
            H3 Turbo · ${price}/s · 本镜约 ${(price * segs.reduce((n, sg) => n + Math.max(minSeg, sg.end - sg.start), 0)).toFixed(2)}
          </Mono>
        </div>
        <div className="flex items-center gap-2">
          <Mono className="text-[10.5px] text-ink-3">{canMid ? `点轴空白处加中间帧 · 拖动圆点改时间 · 每段至少 ${minSeg}s · Esc 关闭` : `这一镜只有 ${duration}s，放不下中间帧（每段至少 ${minSeg}s）· 可以拆成两镜 · Esc 关闭`}</Mono>
          <Button size="sm" variant="ghost" onClick={onClose}>关闭</Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
        {/* 时间轴 */}
        <section className="border border-line bg-panel px-6 pb-3 pt-10">
          <div
            ref={trackRef}
            className="relative h-3 cursor-crosshair rounded-full bg-line"
            title="点击加一个中间帧"
            onClick={(e) => { if (e.target === e.currentTarget) { const t = timeAt(e.clientX); if (t !== null) addAt(t); } }}
          >
            {ticks.map((t) => (
              <div key={t} className="absolute top-full mt-1 -translate-x-1/2 font-mono text-[9.5px] text-ink-3" style={{ left: pct(t) }}>
                {t}s
              </div>
            ))}
            {/* 首帧 */}
            <Marker left="0%" label="首帧 · 0s" tone="ink" selected={sel === "first"} url={shot.frameUrl} fresh={shot.freshness?.frame} orientation={project.orientation} onClick={() => setSel("first")} />
            {ordered.map((k) => (
              <Marker
                key={k.id}
                left={pct(posOf(k))}
                label={k.at < 0 ? `尾帧 · ${duration}s` : `${posOf(k)}s`}
                tone={k.at < 0 ? "cinnabar" : "ink"}
                selected={sel === k.id}
                url={k.url}
                fresh={k.freshness}
                orientation={project.orientation}
                dragging={drag?.id === k.id}
                draggable={k.at >= 0}
                onClick={() => setSel(k.id)}
                onPointerDown={startDrag(k)}
              />
            ))}
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-between gap-2">
            <Mono className="text-[10.5px] text-ink-3">
              {kfs.length ? `首帧 + ${kfs.length} 个关键帧` : "只有首帧"} · {route === "segments" ? `有中间帧：切成 ${segs.length} 段，每段首尾帧钉死后拼接` : route === "flf" ? "只有尾帧：走首尾帧，起止画面钉死" : "没有已出图的关键帧：走首帧模式"}
            </Mono>
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="ghost" disabled={pending || !canMid} title={canMid ? `加在第 ${snap(duration / 2)} 秒，可再拖` : `每段至少 ${minSeg}s，这一镜放不下中间帧`} onClick={() => { const t = snap(duration / 2); addAt(kfs.some((k) => k.at === t) ? t + SNAP : t); }}>＋ 中间帧</Button>
              {!hasEnd && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(async () => { const id = await addShotKeyframe(project.id, chapter.id, shot.id, -1); setSel(id); })}>＋ 尾帧</Button>}
              {!hasEnd && <Button size="sm" variant="ghost" disabled={pending} title="拿下一镜首帧当尾帧，剪辑点无缝" onClick={() => run(() => useShotNextFirstFrame(project.id, chapter.id, shot.id))}>用下一镜首帧作尾帧</Button>}
              {withPrompt > 0 && <Button size="sm" variant="ghost" disabled={pending || !shot.frameUrl} title="按时间顺序串行重画所有写了描述的关键帧" onClick={() => run(() => generateShotKeyframes(project.id, chapter.id, shot.id))}>重画全部关键帧（{withPrompt}）</Button>}
            </div>
          </div>
        </section>

        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
          {/* 选中帧 */}
          <section>
            {selected ? (
              <KeyframeCard kf={selected} shot={shot} project={project} chapter={chapter} />
            ) : (
              <div className="mt-2 border border-line bg-panel p-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[11.5px]">
                    <Stamp tone="neutral">首帧 · 0 秒</Stamp>
                    <FreshBadge level={shot.freshness?.frame} />
                  </span>
                  <Mono className="text-[10px] text-ink-3">起点固定 · 在右栏首帧页改</Mono>
                </div>
                {shot.frameUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={shot.frameUrl} alt="" className="w-full border border-line object-cover" style={{ aspectRatio: frameAspect(project.orientation) }} />
                ) : (
                  <Placeholder ratio={frameAspect(project.orientation)} label="还没有首帧" />
                )}
                <p className="mt-1.5 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-ink-2">{shot.framePrompt || "（首帧提示词为空）"}</p>
                <div className="mt-1 flex justify-end">
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => generateFrames(project.id, chapter.id, [shot.id]))}>只重画首帧</Button>
                </div>
              </div>
            )}
          </section>

          {/* 分段预览：任务端就是按这张表提交的 */}
          <section className="mt-2 border border-line bg-panel p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11.5px] tracking-wider text-ink-2">将怎样出片</span>
              <Mono className="text-[10px] text-ink-3">与任务端同一切段函数 · 只含已出图的帧</Mono>
            </div>
            <ol className="flex flex-col gap-1.5">
              {segs.map((sg) => {
                const d = sg.end - sg.start;
                const text = (sg.to?.segmentPrompt ?? "").trim();
                return (
                  <li key={sg.index} className={cx("border bg-paper px-2 py-1.5 text-[11px]", d < minSeg && segs.length > 1 ? "border-cinnabar" : "border-line")}>
                    <div className="flex items-center justify-between font-mono text-[10.5px]">
                      <span>
                        <span className="text-cinnabar">段 {sg.index + 1}</span> · {sg.start}–{sg.end}s（{d}s）
                      </span>
                      <span className="text-ink-3">
                        首帧＝{sg.from ? `第 ${sg.from.at} 秒的画面` : "本镜首帧"} → {sg.to ? (sg.to.at < 0 ? "尾帧" : `第 ${sg.to.at} 秒的画面`) : "不钉终点"}
                      </span>
                    </div>
                    <p className={cx("mt-1 line-clamp-2 leading-relaxed", text ? "text-ink" : "text-ink-3")}>
                      {segs.length > 1 ? text || `（未写段提示词，将用镜头的视频提示词：${shot.videoPrompt.slice(0, 60)}…）` : shot.videoPrompt.slice(0, 120)}
                    </p>
                    {d < minSeg && segs.length > 1 && <p className="mt-1 text-[10.5px] text-cinnabar">这一段短于 {minSeg}s，模型不收，提交会被拦</p>}
                  </li>
                );
              })}
            </ol>
            {ordered.some((k) => !k.url) && (
              <p className="mt-2 text-[10.5px] text-ink-3">有 {ordered.filter((k) => !k.url).length} 个关键帧还没出图，不参与切段；出图后自动进入上表。</p>
            )}
            {route === "segments" && (
              <p className="mt-2 border-t border-dashed border-line pt-2 text-[10.5px] leading-relaxed text-ink-3">
                每一段是独立的一次首尾帧生成，模型看不到别的段：这段的动作过程和台词要写在那一帧的「段提示词」里；没写会退回镜头的视频提示词，每段都会试着念一遍全部台词。段与段的接缝是同一张关键帧图，画面连续；声音接缝处会有一个切点。
              </p>
            )}
            <div className="mt-2 flex justify-end">
              {selected && (
                <button
                  disabled={pending}
                  onClick={() => { if (confirm("删掉这一帧？")) run(() => removeShotKeyframe(project.id, chapter.id, selected.id)); }}
                  className="text-[10.5px] text-ink-3 hover:text-cinnabar"
                >
                  删掉选中的帧
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Marker({
  left, label, tone, selected, url, fresh, orientation, dragging, draggable, onClick, onPointerDown,
}: {
  left: string; label: string; tone: "ink" | "cinnabar"; selected: boolean; url?: string | null; fresh?: "none" | "fresh" | "stale"; orientation?: string;
  dragging?: boolean; draggable?: boolean; onClick: () => void; onPointerDown?: (e: React.PointerEvent) => void;
}) {
  const landscape = orientation === "16:9";
  return (
    <div className={cx("absolute top-1/2 -translate-x-1/2 -translate-y-1/2", dragging ? "z-20" : selected ? "z-10" : "")} style={{ left }}>
      {/* 缩略图挂在轴上方 */}
      <button
        onClick={onClick}
        className={cx("absolute bottom-4 left-1/2 -translate-x-1/2 border bg-paper", selected ? "border-cinnabar" : "border-line", landscape ? "w-24" : "w-12")}
        title={label}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="block w-full object-cover" style={{ aspectRatio: frameAspect(orientation) }} />
        ) : (
          <div className="flex items-center justify-center text-[9px] text-ink-3" style={{ aspectRatio: frameAspect(orientation) }}>未出图</div>
        )}
        {fresh === "stale" && <span className="absolute right-0 top-0 h-1.5 w-1.5 bg-cinnabar" />}
      </button>
      <div
        onClick={onClick}
        onPointerDown={onPointerDown}
        className={cx(
          "h-4 w-4 rounded-full border-2 bg-paper",
          tone === "cinnabar" ? "border-cinnabar" : "border-ink",
          selected && "ring-2 ring-cinnabar/40",
          draggable ? "cursor-ew-resize" : "cursor-pointer",
        )}
        title={draggable ? `${label} · 拖动改时间` : label}
      />
      <Mono className={cx("absolute left-1/2 top-4 -translate-x-1/2 whitespace-nowrap text-[9.5px]", selected ? "text-cinnabar" : "text-ink-2")}>{label}</Mono>
    </div>
  );
}
