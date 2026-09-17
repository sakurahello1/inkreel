"use client";

import { useEffect, useRef, useState } from "react";
import type { Chapter, PrevizRun, Project } from "@/lib/types";
import { createPreviz, discardPreviz, estimatePreviz, listPreviz } from "@/server/actions";
import { useAct } from "@/components/use-act";
import { Button, Mono, Placeholder, Stamp, cx } from "@/components/ui";
import { frameAspect } from "./shared";

/**
 * 分镜预演面板：发起预演、看每一批的进度、整条播放。
 *
 * 截帧不在这里做——人要一镜一镜挑，所以放在右栏首帧页：打开镜头，拖进度条，采用当前帧。
 * 这里只负责「把一章的镜头闪一遍」这件事本身。
 */
export function PrevizPanel({ project, chapter, selectedIds, onClose, onPickFrame }: { project: Project; chapter: Chapter; selectedIds: string[]; onClose: () => void; onPickFrame: (shotId: string) => void }) {
  const { act: run, pending } = useAct();
  const [runs, setRuns] = useState<PrevizRun[] | null>(null);
  const [slotSeconds, setSlotSeconds] = useState(0.75);
  const [resolution, setResolution] = useState(project.videoResolution || "768P");
  const [scope, setScope] = useState<"all" | "selected">(selectedIds.length ? "selected" : "all");
  const [est, setEst] = useState<{ batches: number; cost: number } | null>(null);
  const [cur, setCur] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const shotCount = scope === "selected" ? selectedIds.length : chapter.shots.length;
  const refresh = async () => {
    const r = await listPreviz(chapter.id);
    setRuns(r);
    setCur((c) => c ?? r.find((x) => x.status === "success")?.id ?? r[0]?.id ?? null);
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter.id]);
  // 有在跑的就每 5 秒刷一次
  const busy = runs?.some((r) => r.status === "running" || r.status === "queued");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);
  useEffect(() => {
    estimatePreviz(shotCount, slotSeconds, resolution).then(setEst);
  }, [shotCount, slotSeconds, resolution]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const current = runs?.find((r) => r.id === cur) ?? null;
  const seek = (t: number) => { const v = videoRef.current; if (v) { v.currentTime = t; v.pause(); } };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-paper">
      <header className="flex items-center justify-between border-b border-line px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="text-[13px] text-ink-2">第 {String(chapter.index).padStart(2, "0")} 章 · 分镜预演</span>
          <Mono className="text-[10.5px] text-ink-3">全能参考 · H3 Max · 人设 / 场景 / 道具图作参考 · 每镜不到一秒闪一遍 · 首帧从里面截</Mono>
        </div>
        <div className="flex items-center gap-2">
          <Mono className="text-[10.5px] text-ink-3">Esc 关闭</Mono>
          <Button size="sm" variant="ghost" onClick={onClose}>关闭</Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[380px_1fr] gap-4 overflow-hidden p-5">
        {/* 左：发起 + 历史 */}
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
          <section className="border border-line bg-panel p-3">
            <div className="mb-2 text-[11.5px] tracking-wider text-ink-2">新预演</div>
            <div className="flex flex-col gap-2 text-[12px]">
              <label className="flex items-center justify-between">
                <span>范围</span>
                <select value={scope} onChange={(e) => setScope(e.target.value as "all" | "selected")} className="border border-line bg-paper px-1.5 py-0.5 font-mono text-[11px]">
                  <option value="all">全章 {chapter.shots.length} 镜</option>
                  <option value="selected" disabled={!selectedIds.length}>工具条勾选的 {selectedIds.length} 镜</option>
                </select>
              </label>
              <label className="flex items-center justify-between">
                <span>每镜</span>
                <select value={slotSeconds} onChange={(e) => setSlotSeconds(Number(e.target.value))} className="border border-line bg-paper px-1.5 py-0.5 font-mono text-[11px]">
                  <option value={0.5}>0.5s · 一批 30 镜</option>
                  <option value={0.75}>0.75s · 一批 20 镜</option>
                  <option value={1}>1.0s · 一批 15 镜</option>
                </select>
              </label>
              <label className="flex items-center justify-between">
                <span>分辨率</span>
                <select value={resolution} onChange={(e) => setResolution(e.target.value)} className="border border-line bg-paper px-1.5 py-0.5 font-mono text-[11px]">
                  <option value="768P">768P · 截出 1344×768</option>
                  <option value="1080P">1080P · 截出 1920×1080 · 两倍价</option>
                </select>
              </label>
              <div className="flex items-center justify-between border-t border-line pt-2">
                <Mono className="text-[10.5px] text-ink-3">{est ? `${est.batches} 批 · 约 $${est.cost.toFixed(2)}` : "…"}</Mono>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={pending || !shotCount}
                  onClick={() => run(async () => { await createPreviz(project.id, chapter.id, { shotIds: scope === "selected" ? selectedIds : undefined, slotSeconds, resolution }); await refresh(); })}
                >
                  生成预演
                </Button>
              </div>
              <p className="text-[10.5px] leading-relaxed text-ink-3">
                每镜的描述只取景别 + 对焦的人物 + 一句动作；人物基本静止、镜头硬切。出来之后到右栏首帧页拖进度条截帧。
              </p>
            </div>
          </section>

          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11.5px] tracking-wider text-ink-2">已有预演</span>
              <Mono className="text-[10px] text-ink-3">{runs ? `${runs.length} 条` : "…"}</Mono>
            </div>
            {runs?.length === 0 && <Placeholder className="h-16" label="还没有预演" />}
            <div className="flex flex-col gap-1.5">
              {runs?.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setCur(r.id)}
                  className={cx("border px-2.5 py-2 text-left", cur === r.id ? "border-cinnabar bg-paper" : "border-line bg-panel hover:border-line-strong")}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[12px]">
                      <Stamp tone={r.status === "success" ? "neutral" : r.status === "failed" ? "cinnabar" : "indigo"}>{r.status === "success" ? "完成" : r.status === "failed" ? "失败" : r.progress || "排队"}</Stamp>
                      {r.label && <span className="text-ink-2">{r.label}</span>}
                      <span className="text-ink-2">{r.slots.length} 镜 · {r.duration ? r.duration.toFixed(1) : "?"}s</span>
                    </span>
                    <Mono className="text-[10px] text-ink-3">{new Date(r.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}{r.cost ? ` · $${r.cost.toFixed(2)}` : ""}</Mono>
                  </div>
                  <Mono className="mt-0.5 block truncate text-[10px] text-ink-3">
                    #{String(r.slots[0]?.index).padStart(2, "0")}–#{String(r.slots[r.slots.length - 1]?.index).padStart(2, "0")} · {r.slotSeconds}s/镜 · {r.resolution} · 参考图 {r.refs.length} 张
                  </Mono>
                  {r.status === "failed" && <p className="mt-1 text-[10.5px] text-cinnabar">{r.error.slice(0, 200)}</p>}
                </button>
              ))}
            </div>
          </section>
        </div>

        {/* 右：播放 + 镜头格子 */}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          {current?.url ? (
            <video ref={videoRef} controls src={current.url} className="w-full max-w-[960px] border border-line bg-black" style={{ aspectRatio: frameAspect(project.orientation) }} />
          ) : (
            <Placeholder ratio={frameAspect(project.orientation)} label={current ? (current.status === "failed" ? "这条失败了" : `${current.progress || "生成中"} · H3 Max 全能参考约 1–3 分钟`) : "选一条预演"} className="w-full max-w-[960px]" />
          )}
          {current && (
            <>
              <div className="flex items-center justify-between">
                <Mono className="text-[10.5px] text-ink-3">参考图：{current.refs.join(" · ") || "（无）"}</Mono>
                <div className="flex items-center gap-2">
                  <details>
                    <summary className="cursor-pointer text-[11px] text-ink-3">提示词</summary>
                    <pre className="mt-1 max-h-60 max-w-[720px] overflow-auto whitespace-pre-wrap border border-line bg-panel p-2 text-[10.5px] leading-relaxed text-ink-2">{current.prompt || "（提交后可见）"}</pre>
                  </details>
                  <button
                    disabled={pending}
                    onClick={() => { if (confirm("弃掉这条预演？视频会删除，已截出的首帧不受影响。")) run(async () => { await discardPreviz(project.id, chapter.id, current.id); setCur(null); await refresh(); }); }}
                    className="text-[11px] text-ink-3 hover:text-cinnabar"
                  >
                    弃
                  </button>
                </div>
              </div>
              {current.status === "success" && (
                <p className="border border-dashed border-cinnabar/50 bg-cinnabar-wash px-2.5 py-1.5 text-[11px] text-cinnabar">
                  截帧在每一镜自己的页面里做：点下面格子上的「去截帧」，会关掉这个面板、选中那一镜并切到右栏首帧页，拖进度条选好后点「采用当前帧为首帧」。
                  已截过的格子标红；{current.slots.filter((sl) => chapter.shots.find((s) => s.id === sl.shotId)?.previzGenerationId === current.id).length}/{current.slots.length} 镜已截。
                </p>
              )}
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-1.5">
                {current.slots.map((sl) => {
                  const shot = chapter.shots.find((s) => s.id === sl.shotId);
                  const picked = shot?.previzGenerationId === current.id;
                  return (
                    <div
                      key={sl.shotId}
                      className={cx("border px-2 py-1.5 text-left", picked ? "border-cinnabar/60 bg-paper" : "border-line bg-panel")}
                    >
                      <div className="flex items-center justify-between font-mono text-[10.5px]">
                        <button onClick={() => seek(sl.start)} className="hover:text-cinnabar" title="播放器跳到这一镜的计划时间点">
                          #{String(sl.index).padStart(2, "0")} · {sl.start.toFixed(1)}–{sl.end.toFixed(1)}s
                        </button>
                        {picked ? <span className="text-cinnabar">已截 @{(shot?.previzTime ?? 0).toFixed(2)}s</span> : !shot ? <span className="text-ink-3">镜头已删</span> : null}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-ink-2">{sl.text}</p>
                      {shot && current.status === "success" && (
                        <button onClick={() => onPickFrame(sl.shotId)} className={cx("mt-1 w-full border py-0.5 text-[10.5px]", picked ? "border-line text-ink-2 hover:bg-panel" : "border-cinnabar bg-cinnabar text-paper hover:opacity-90")}>
                          {picked ? "重新截帧" : "去截帧"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
