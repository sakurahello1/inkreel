"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { Chapter, Project, Shot } from "@/lib/types";
import { rerunFrom } from "@/server/actions";
import { useAct } from "@/components/use-act";
import { Button, Mono, Stamp, cx } from "@/components/ui";

/**
 * 展开为画布：把一个镜头的生产流程摊平成节点图。
 *
 * 这是**展示用**的画布，不是 ComfyUI 那种可以任意连线的自由图：
 * 管线拓扑是固定的（资产 → 首帧 → 视频 → 片段），
 * 画布负责让人一眼看清「这一格画面是由哪些输入喂出来的」以及「哪一级已经过期」。
 * 布局按层写死，所以不需要力导向，也不需要引第三方图库。
 */

type Level = "none" | "fresh" | "stale";

interface NodeDef {
  id: string;
  col: number;
  /** 同列内的先后顺序 */
  row: number;
  title: string;
  sub?: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  /** 媒体区高度。按内容比例给足，否则 9:16 的首帧缩成一条看不清 */
  mediaH?: number;
  body?: string;
  level?: Level;
  /** 上游变了但自身输入没动 */
  upstream?: boolean;
  shared?: string;
}

const COL_W = 460;
const GAP_X = 96;
const GAP_Y = 28;

/**
 * 媒体区高度。给得大方一点：画布的价值就是把图看清楚，
 * 一屏装不下不要紧，拖着看就是了，所以不为了塞进屏幕而牺牲尺寸。
 * 三视图与道具图偏方，首帧与视频是 9:16，竖向要给足。
 */
const MEDIA = { sheetRef: 300, portrait: 620, landscape: 240 };
/** 首帧与视频节点的媒体高度：竖屏铺高、横屏铺宽（列宽 460，16:9 约 240 高） */
const frameMediaH = (orientation?: string) => (orientation === "16:9" ? MEDIA.landscape : MEDIA.portrait);

const HEAD_H = 34;
const SUB_H = 20;
const BODY_H = 78;
const SHARED_H = 28;
const PAD = 10;

function nodeHeight(n: NodeDef) {
  return HEAD_H + (n.sub ? SUB_H : 0) + (n.mediaH ? n.mediaH + 6 : 0) + (n.body ? BODY_H : 0) + (n.shared ? SHARED_H : 0) + PAD;
}

/** 按列堆叠。固定行高在内容高度差很大时会撞在一起，所以改成累加实际高度。 */
function layout(nodes: NodeDef[]) {
  const box = new Map<string, { x: number; y: number; h: number }>();
  const cols = new Map<number, NodeDef[]>();
  for (const n of nodes) cols.set(n.col, [...(cols.get(n.col) ?? []), n]);
  for (const [col, list] of cols) {
    let y = 0;
    for (const n of [...list].sort((a, b) => a.row - b.row)) {
      const h = nodeHeight(n);
      box.set(n.id, { x: col * (COL_W + GAP_X), y, h });
      y += h + GAP_Y;
    }
  }
  return box;
}

export function ShotCanvas({ shot, project, chapter, onClose }: { shot: Shot; project: Project; chapter: Chapter; onClose: () => void }) {
  const { act: run, pending } = useAct();
  const [view, setView] = useState({ x: 24, y: 20, k: 1 });
  // dragging 只为驱动光标：ref 变化不会触发重渲染，以前光标其实一直没变过
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const fresh = shot.freshness;
  const videoUpstream = fresh?.frame === "stale";

  const { nodes, edges } = useMemo(() => {
    const ns: NodeDef[] = [];
    const es: Array<[string, string]> = [];

    // 第 1 列：输入资产。场景排最前——它是空间底子，先立住场地再放人
    let row = 0;
    const sc = shot.sceneId ? (project.scenes ?? []).find((x) => x.id === shot.sceneId) : undefined;
    if (sc) {
      ns.push({ id: "scene", col: 0, row: row++, title: sc.name, sub: "场景空间基准图", imageUrl: sc.sheetUrl, mediaH: MEDIA.sheetRef });
      es.push(["scene", "frame"]);
    }
    for (const c of shot.characters) {
      const ch = project.characters.find((x) => x.id === c.characterId);
      const persona = ch?.personas.find((p) => p.tag === c.personaTag);
      const id = `persona:${c.characterId}:${c.personaTag}`;
      ns.push({ id, col: 0, row: row++, title: ch?.name ?? "?", sub: `人设三视图 · ${c.personaTag}`, imageUrl: persona?.sheetUrl, mediaH: MEDIA.sheetRef });
      es.push([id, "frame"]);
    }
    for (const pid of shot.propIds ?? []) {
      const pr = project.props?.find((x) => x.id === pid);
      if (!pr) continue;
      const id = `prop:${pid}`;
      ns.push({ id, col: 0, row: row++, title: pr.name, sub: "道具概念图", imageUrl: pr.sheetUrl, mediaH: MEDIA.sheetRef });
      es.push([id, "frame"]);
    }
    ns.push({ id: "style", col: 0, row: row++, title: "画风", sub: `${project.styleRefs} 张参考图`, body: project.style.split("\n")[0] || "未设定" });
    es.push(["style", "frame"]);

    // 第 2 列：首帧提示词
    ns.push({ id: "framePrompt", col: 1, row: 0, title: "首帧提示词", body: shot.framePrompt });
    es.push(["framePrompt", "frame"]);

    // 第 3 列：首帧
    ns.push({
      id: "frame",
      col: 2,
      row: 0,
      title: "首帧",
      sub: "gpt-image-2",
      imageUrl: shot.frameUrl,
      mediaH: frameMediaH(project.orientation),
      level: fresh?.frame,
    });
    es.push(["sheet", "frame"]);

    // 关键帧：以首帧为基准画的其他时刻，和首帧一起喂给视频
    let r3 = 1;
    for (const k of shot.keyframes ?? []) {
      const id = `keyframe:${k.id}`;
      ns.push({
        id,
        col: 2,
        row: r3++,
        title: k.at < 0 ? "尾帧" : `关键帧 · 第 ${k.at} 秒`,
        sub: shot.videoRoute === "segments" ? "分段 · 首尾帧钉死后拼接" : shot.videoRoute === "flf" ? "首尾帧 · 钉死" : "未出图",
        imageUrl: k.url,
        body: k.url ? undefined : k.prompt,
        mediaH: frameMediaH(project.orientation),
        level: k.freshness,
      });
      es.push(["frame", id]);
      es.push([id, "video"]);
    }
    // 第 3 列还放视频提示词与 BGM：它们和首帧一起喂给视频
    ns.push({ id: "videoPrompt", col: 2, row: r3++, title: "视频提示词", body: shot.videoPrompt });
    es.push(["videoPrompt", "video"]);
    if (shot.bgmTrackName) {
      ns.push({
        id: "bgm",
        col: 2,
        row: r3,
        title: `♪ ${shot.bgmTrackName}`,
        sub: shot.bgmToModel ? "送给模型 + 导出" : "仅用于导出",
        body: shot.bgmToModel ? "本镜对应的那段 BGM 会作为参考音频送进模型" : "导出时混音，不进模型",
      });
      es.push(["bgm", "video"]);
    }

    // 第 4 列：视频
    ns.push({
      id: "video",
      col: 3,
      row: 0,
      title: "视频",
      sub: `${project.videoEngine === "omni" ? "Omni 1.1" : "MiniMax H3"} · ${shot.duration}s · ${project.videoResolution}`,
      videoUrl: shot.videoUrl,
      imageUrl: shot.frameUrl,
      mediaH: frameMediaH(project.orientation),
      level: fresh?.video,
      upstream: videoUpstream,
    });
    es.push(["frame", "video"]);

    // 第 5 列：成片片段
    ns.push({
      id: "clip",
      col: 4,
      row: 0,
      title: "成片片段",
      sub: shot.clip?.enabled === false ? "已停用" : "已启用",
      body: shot.clip?.subtitle || "（无字幕）",
    });
    es.push(["video", "clip"]);

    return { nodes: ns, edges: es };
  }, [shot, project, fresh, videoUpstream]);

  const box = useMemo(() => layout(nodes), [nodes]);
  const W = Math.max(...nodes.map((n) => (box.get(n.id)?.x ?? 0) + COL_W)) + 80;
  const H = Math.max(...nodes.map((n) => (box.get(n.id)?.y ?? 0) + (box.get(n.id)?.h ?? 0))) + 80;

  /**
   * 「适应窗口」是个按钮，不是默认行为。
   * 默认按 100% 打开：画布是用来看清图的，缩到一屏装下就什么都看不清了，
   * 装不下就拖着看。想要全局俯瞰时再点这个按钮。
   */
  const fit = useCallback(() => {
    const el = boardRef.current;
    if (!el) return;
    const k = Math.min(1, Math.max(0.25, Math.min((el.clientWidth - 48) / W, (el.clientHeight - 48) / H)));
    setView({ x: Math.max(24, (el.clientWidth - W * k) / 2), y: 24, k });
  }, [W, H]);

  /**
   * 平移。
   *
   * 这里有两个坑，都踩过：
   * 1. 绝不能在 setView 的更新函数里读 drag.current。更新函数是 React 择机执行的，
   *    等它跑的时候鼠标可能已经松开、ref 已被置空，就会崩在读 vx 上；
   *    开发模式下 React 还会重复调用更新函数，撞上的概率更高。
   *    所以先把 ref 读成局部变量、把位移算成普通数字，更新函数里只用这些数字。
   * 2. 用指针捕获，这样拖到画布外面再松手也能收到 up 事件，不会留下一个永远在拖的状态。
   */
  function onDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  }

  function onMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const nx = d.vx + (e.clientX - d.x);
    const ny = d.vy + (e.clientY - d.y);
    setView((v) => ({ ...v, x: nx, y: ny }));
  }

  function stop(e?: React.PointerEvent) {
    drag.current = null;
    setDragging(false);
    if (e && e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function onWheel(e: React.WheelEvent) {
    const delta = e.deltaY;
    setView((v) => ({ ...v, k: Math.min(1.8, Math.max(0.25, v.k - delta * 0.0012)) }));
  }

  const zoom = (d: number) => setView((v) => ({ ...v, k: Math.min(1.8, Math.max(0.25, v.k + d)) }));

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-paper">
      <header className="flex items-center justify-between border-b border-line px-4 py-2">
        <div className="flex items-center gap-3">
          <Mono className="text-[13px]">#{String(shot.index).padStart(2, "0")}</Mono>
          <span className="text-[13px] text-ink-2">
            {shot.shotSize} · {shot.duration}s · {shot.scene}
          </span>
          {fresh && (fresh.frame === "stale" || fresh.video === "stale") && <Stamp tone="cinnabar">有产物已过期</Stamp>}
        </div>
        <div className="flex items-center gap-2">
          <Mono className="text-[10.5px] text-ink-3">拖动平移 · 滚轮缩放 · 点图看原图</Mono>
          <div className="flex items-center border border-line">
            <button onClick={() => zoom(-0.15)} className="px-2 py-1 text-[13px] leading-none hover:bg-panel">
              −
            </button>
            <Mono className="w-11 text-center text-[10.5px] text-ink-2">{Math.round(view.k * 100)}%</Mono>
            <button onClick={() => zoom(0.15)} className="px-2 py-1 text-[13px] leading-none hover:bg-panel">
              +
            </button>
          </div>
          <button onClick={fit} className="border border-line px-2 py-1 text-[11.5px] hover:bg-panel">
            适应窗口
          </button>
          <button onClick={() => setView({ x: 24, y: 20, k: 1 })} className="border border-line px-2 py-1 text-[11.5px] hover:bg-panel">
            原始大小
          </button>
          <button onClick={onClose} className="border border-line px-2 py-1 text-[11.5px] hover:bg-panel">
            收起画布
          </button>
        </div>
      </header>

      <div
        ref={boardRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-[radial-gradient(circle,var(--color-line)_1px,transparent_1px)] [background-size:22px_22px]"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={stop}
        onPointerCancel={stop}
        onWheel={onWheel}
        style={{ cursor: dragging ? "grabbing" : "grab", touchAction: "none" }}
      >
        <div className="absolute origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, width: W, height: H }}>
          <svg width={W} height={H} className="pointer-events-none absolute left-0 top-0">
            {edges.map(([from, to], i) => {
              const a = box.get(from);
              const b = box.get(to);
              const an = nodes.find((n) => n.id === from);
              const bn = nodes.find((n) => n.id === to);
              if (!a || !b || !an || !bn) return null;
              // 从各自节点的竖向中点出发，节点高度差很大时线才不会歪得离谱
              const y1 = a.y + Math.min(a.h / 2, 90);
              const y2 = b.y + Math.min(b.h / 2, 90);
              const x1 = a.x + COL_W;
              const x2 = b.x;
              const mx = (x1 + x2) / 2;
              const hot = (bn.level === "stale" || bn.upstream) && (an.level === "stale" || an.upstream || bn.level === "stale");
              return (
                <path
                  key={i}
                  d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={hot ? "var(--color-cinnabar)" : "var(--color-line-strong)"}
                  strokeWidth={hot ? 1.8 : 1.2}
                  strokeDasharray={hot ? "6 4" : undefined}
                />
              );
            })}
          </svg>

          {nodes.map((n) => {
            const b = box.get(n.id)!;
            return (
              <div
                key={n.id}
                className={cx(
                  "absolute border bg-paper shadow-[2px_2px_0_var(--color-line)]",
                  n.level === "stale" || n.upstream ? "border-cinnabar" : "border-line-strong",
                )}
                style={{ left: b.x, top: b.y, width: COL_W }}
              >
                <div className="flex items-center justify-between border-b border-line px-2.5 py-1.5">
                  <span className="font-serif text-[14px] font-bold">{n.title}</span>
                  {n.level === "stale" ? <Stamp tone="cinnabar">已过期</Stamp> : n.upstream ? <Stamp tone="cinnabar">上游已变</Stamp> : null}
                </div>

                {n.sub && <Mono className="block px-2.5 pt-1 text-[10.5px] text-ink-3">{n.sub}</Mono>}

                {n.videoUrl ? (
                  // 停掉指针冒泡，否则拖进度条会把整张画布一起拖走
                  <div className="mt-1.5 px-2.5" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
                    <video
                      src={n.videoUrl}
                      controls
                      preload="metadata"
                      playsInline
                      className="mx-auto block bg-black"
                      style={{ height: n.mediaH, maxWidth: "100%" }}
                    />
                  </div>
                ) : n.imageUrl ? (
                  <a
                    href={n.imageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1.5 block px-2.5"
                    onPointerDown={(e) => e.stopPropagation()}
                    title="点开看原图"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={n.imageUrl} alt="" className="mx-auto block object-contain" style={{ height: n.mediaH, maxWidth: "100%" }} />
                  </a>
                ) : n.mediaH ? (
                  <div className="mt-1.5 flex items-center justify-center px-2.5" style={{ height: n.mediaH }}>
                    <div className="flex h-full w-full items-center justify-center border border-dashed border-line">
                      <Mono className="text-[11px] text-ink-3">尚未生成</Mono>
                    </div>
                  </div>
                ) : null}

                {n.body && (
                  <p
                    className="overflow-y-auto px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-2"
                    style={{ height: BODY_H }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onWheel={(e) => e.stopPropagation()}
                  >
                    {n.body}
                  </p>
                )}

                {n.shared && (
                  <div className="border-t border-dashed border-line px-2.5 py-1.5">
                    <Mono className="text-[10.5px] text-cinnabar">{n.shared}</Mono>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <footer className="flex items-center gap-2 border-t border-line px-4 py-2">
        <span className="text-[11.5px] text-ink-2">从这一级往下重跑：</span>
        <Button disabled={pending} onClick={() => run(() => rerunFrom(project.id, chapter.id, shot.id, "frame"))}>
          首帧
        </Button>
        <Button disabled={pending} onClick={() => run(() => rerunFrom(project.id, chapter.id, shot.id, "video"))}>
          视频
        </Button>
        <span className="ml-auto text-[11px] text-ink-3">重跑首帧会连带把视频一起重出</span>
      </footer>
    </div>
  );
}
