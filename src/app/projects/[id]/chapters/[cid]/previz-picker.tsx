"use client";

import { useEffect, useRef, useState } from "react";
import type { Chapter, PrevizRun, Project, Shot } from "@/lib/types";
import { adoptPrevizFrame } from "@/server/actions";
import { useAct } from "@/components/use-act";
import { Button, Mono, cx } from "@/components/ui";
import { frameAspect, previewMaxW } from "./shared";

/** ISO 时间 → 本地 "MM-DD HH:mm"。服务端存的是 UTC，直接切字符串会差 8 小时 */
function localTime(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 预演视频 24 fps；逐帧步进用它 */
const FRAME = 1 / 24;

/**
 * 从预演视频里给本镜截首帧：拖进度条、逐帧微调、采用当前帧。
 * 打开时进度条自动跳到上次截帧的位置；没截过就跳到这一镜在预演里的计划起点。
 * 截帧一律人工——预演的切点和计划时间对不齐是常态，自动截只会截到过渡帧。
 */
export function PrevizPicker({ shot, project, chapter, runs }: { shot: Shot; project: Project; chapter: Chapter; runs: PrevizRun[] }) {
  const { act: run, pending } = useAct();
  const [runId, setRunId] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const [ready, setReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    // 上次截帧用的那条优先；否则最新的一条
    setRunId((cur) => (cur && runs.some((r) => r.id === cur) ? cur : runs.find((r) => r.id === shot.previzGenerationId)?.id ?? runs[0]?.id ?? null));
  }, [runs, shot.previzGenerationId]);

  const current = runs?.find((r) => r.id === runId) ?? null;
  const slot = current?.slots.find((s) => s.shotId === shot.id) ?? null;
  const duration = current?.duration ?? 0;
  // 本镜不在这条预演里（比如新插的镜头）：拿序号最接近的前一镜的时段当落脚点
  const neighbor = !slot && current ? [...current.slots].filter((s) => s.index <= shot.index).sort((a, b) => b.index - a.index)[0] ?? current.slots[0] ?? null : null;

  // 换了预演 / 换了镜头：进度条跳到上次位置、计划起点，或邻近镜头的时段
  useEffect(() => {
    if (!current) return;
    const start = shot.previzGenerationId === current.id && (shot.previzTime ?? -1) >= 0 ? shot.previzTime! : slot ? slot.start : neighbor ? neighbor.end : 0;
    setT(start);
    setReady(false);
    const v = videoRef.current;
    if (v) {
      const go = () => { v.currentTime = start; setReady(true); };
      if (v.readyState >= 1) go();
      else v.addEventListener("loadedmetadata", go, { once: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, slot?.start, neighbor?.end, shot.previzGenerationId, shot.previzTime]);

  const seek = (nt: number) => {
    const c = Math.max(0, Math.min(duration || nt, nt));
    setT(c);
    const v = videoRef.current;
    if (v) { v.pause(); v.currentTime = c; }
  };

  if (runs.length === 0) return null;
  const picked = shot.previzGenerationId === current?.id && (shot.previzTime ?? -1) >= 0;

  return (
    <div className="mb-3 border border-cinnabar/40 bg-cinnabar-wash/40 p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11.5px] tracking-wider text-cinnabar">① 从预演截首帧 <span className="text-ink-3">· 拖进度条 → 采用当前帧</span></span>
        <div className="flex items-center gap-1.5">
          {runs.length > 1 && (
            <select value={runId ?? ""} onChange={(e) => setRunId(e.target.value)} className="border border-line bg-panel px-1 py-0.5 font-mono text-[10px]" title="切换用哪条预演截帧。默认是上次截帧用的那条；最新的一条标了「最新」">
              {runs.map((r, i) => (
                <option key={r.id} value={r.id}>
                  {i === 0 ? "最新 · " : ""}{localTime(r.createdAt)} · {r.resolution}{r.label ? ` · ${r.label}` : ""}{r.id === shot.previzGenerationId ? " · 上次用的" : ""}
                </option>
              ))}
            </select>
          )}
          <Mono className="text-[10px] text-ink-3">{slot ? `计划 ${slot.start.toFixed(1)}–${slot.end.toFixed(1)}s` : neighbor ? `本镜不在这条预演里 · 已跳到 #${String(neighbor.index).padStart(2, "0")} 之后` : "本镜不在这条预演里"}</Mono>
        </div>
      </div>
      {current?.url && (
        <>
          <video
            ref={videoRef}
            src={current.url}
            preload="auto"
            muted
            playsInline
            onTimeUpdate={(e) => setT((e.target as HTMLVideoElement).currentTime)}
            onClick={(e) => { const v = e.currentTarget; if (v.paused) v.play(); else v.pause(); }}
            className={cx("mx-auto block w-full cursor-pointer border border-line bg-black", previewMaxW(project.orientation))}
            style={{ aspectRatio: frameAspect(project.orientation) }}
            title="点击播放 / 暂停；拖下面的进度条定位"
          />
          <div className={cx("mx-auto mt-1.5", previewMaxW(project.orientation))}>
            <div className="relative">
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.01}
                value={t}
                onChange={(e) => seek(Number(e.target.value))}
                className="w-full accent-cinnabar"
              />
              {/* 本镜计划时段的标记 */}
              {slot && duration > 0 && (
                <div className="pointer-events-none absolute left-0 right-0 top-full h-1">
                  <div className="absolute h-1 bg-cinnabar/40" style={{ left: `${(slot.start / duration) * 100}%`, width: `${((slot.end - slot.start) / duration) * 100}%` }} />
                </div>
              )}
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <button className="border border-line px-1.5 py-0.5 font-mono text-[10.5px] hover:bg-panel" onClick={() => seek(t - 0.5)} title="后退 0.5s">−0.5s</button>
                <button className="border border-line px-1.5 py-0.5 font-mono text-[10.5px] hover:bg-panel" onClick={() => seek(t - FRAME)} title="上一帧">−1f</button>
                <Mono className="w-[64px] text-center text-[11px]">{t.toFixed(2)}s</Mono>
                <button className="border border-line px-1.5 py-0.5 font-mono text-[10.5px] hover:bg-panel" onClick={() => seek(t + FRAME)} title="下一帧">+1f</button>
                <button className="border border-line px-1.5 py-0.5 font-mono text-[10.5px] hover:bg-panel" onClick={() => seek(t + 0.5)} title="前进 0.5s">+0.5s</button>
                {slot && <button className="ml-1 border border-line px-1.5 py-0.5 font-mono text-[10.5px] text-ink-3 hover:bg-panel" onClick={() => seek(slot.start)} title="跳回这一镜的计划起点">计划点</button>}
                {!slot && neighbor && <button className="ml-1 border border-line px-1.5 py-0.5 font-mono text-[10.5px] text-ink-3 hover:bg-panel" onClick={() => seek(neighbor.end)} title={`跳到 #${String(neighbor.index).padStart(2, "0")} 那一格结束的位置`}>#{String(neighbor.index).padStart(2, "0")} 之后</button>}
              </div>
              <Button
                size="sm"
                variant="primary"
                disabled={pending || !ready}
                title="把当前这一帧截下来当本镜首帧（走版本库，可回退），并记住这个位置"
                onClick={() => run(() => adoptPrevizFrame(project.id, chapter.id, current.id, shot.id, t))}
              >
                采用当前帧为首帧
              </Button>
            </div>
            <Mono className="mt-1 block text-[10px] text-ink-3">
              {picked ? `上次截在 ${shot.previzTime!.toFixed(2)}s · 当前首帧就是它` : slot ? "还没从这条预演截过 · 进度条停在这一镜的计划起点，前后拖一拖找最清楚的一帧" : "这一镜是后来加的，预演里没有它的格子 · 整条视频都能翻，找一帧合适的画面就行；要精确的话把它勾上再预演一次"}
            </Mono>
          </div>
        </>
      )}
    </div>
  );
}
