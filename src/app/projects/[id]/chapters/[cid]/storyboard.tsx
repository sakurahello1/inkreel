"use client";

import { useEffect, useMemo, useState } from "react";
import type { Chapter, Project, Shot } from "@/lib/types";
import { formatTimecode, isGenerating } from "@/lib/status";
import { useAutoRefresh } from "@/components/use-auto-refresh";
import { useAct } from "@/components/use-act";
import {
  acceptVideos,
  addShotAfter,
  approveFrames,
  approveStoryboard,
  generateChapterSprites,
  generateChapterVoices,
  generateFrames,
  generateVideos,
  renderPages,
  setFrameMode,
  setShotBgm,
  setShotBgmToModel,
} from "@/server/actions";
import Link from "next/link";
import { Button, Mono, Stamp, cx } from "@/components/ui";
import { bgmPlacements } from "./shared";
import { LeftPane, UnitHeader, ShotRow } from "./left-pane";
import { ShotEditor } from "./shot-editor";
import { PreviewPane } from "./preview-pane";
import { AgentDrawer, EmptyChapter } from "./agent-drawer";
import { PrevizPanel } from "./previz-panel";

/**
 * 分镜工作台外壳：三栏布局与跨栏共享的选中状态。
 *
 * 各栏的实现分别在 left-pane / shot-editor / preview-pane 里，
 * 这个文件只负责把它们拼起来，以及维护「当前选中哪一镜、勾选了哪些镜」。
 */
export function Storyboard({ project, chapter }: { project: Project; chapter: Chapter }) {
  const [currentId, setCurrentId] = useState<string | null>(chapter.shots[0]?.id ?? null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [agentOpen, setAgentOpen] = useState(false);
  const [previzOpen, setPrevizOpen] = useState(false);
  const [stageRequest, setStageRequest] = useState<{ stage: "reference" | "frame" | "video"; nonce: number } | null>(null);
  const { act, pending, toast } = useAct();
  const narrated = project.kind === "narrated";

  const shots = chapter.shots;
  const current = shots.find((s) => s.id === currentId) ?? null;
  const busy =
    chapter.agentStatus === "running" ||
    shots.some((s) => isGenerating(s.status) || s.rewriting || (s.utterances ?? []).some((u) => u.status === "generating"));
  useAutoRefresh(busy, 5000);

  useEffect(() => {
    if (currentId && !shots.some((s) => s.id === currentId)) setCurrentId(shots[0]?.id ?? null);
  }, [shots, currentId]);

  // 键盘：↑↓ / j k 换镜，x 勾选当前，Esc 关抽屉。输入框里不抢键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = shots.findIndex((s) => s.id === currentId);
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setCurrentId(shots[Math.min(shots.length - 1, idx + 1)]?.id ?? null);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setCurrentId(shots[Math.max(0, idx - 1)]?.id ?? null);
      } else if (e.key === "x" && currentId) {
        setChecked((prev) => {
          const n = new Set(prev);
          if (n.has(currentId)) n.delete(currentId);
          else n.add(currentId);
          return n;
        });
      } else if (e.key === "Escape") {
        setAgentOpen(false);
        setPrevizOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shots, currentId]);

  // 当前镜滚进视野（键盘换镜、预演跳转时）
  useEffect(() => {
    if (!currentId) return;
    document.getElementById(`shot-${currentId}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentId]);

  const totalDuration = shots.reduce((a, s) => a + s.duration, 0);
  const totalCost = shots.reduce((a, s) => a + s.cost, 0);
  const doneCount = shots.filter((s) => s.status === "done").length;

  const placements = useMemo(() => bgmPlacements(shots), [shots]);

  const groups = useMemo(() => {
    const byUnit = chapter.units.map((u) => ({ unit: u, shots: shots.filter((s) => s.unitId === u.id) }));
    const orphan = shots.filter((s) => !chapter.units.some((u) => u.id === s.unitId));
    if (orphan.length) byUnit.push({ unit: { id: "_", index: 0, summary: "未归类", sourceRange: [0, 0] }, shots: orphan });
    return byUnit;
  }, [chapter.units, shots]);

  const ids = [...checked];

  if (shots.length === 0) return <EmptyChapter project={project} chapter={chapter} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 工具条 */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-y-1.5 border-b border-line bg-panel px-6 py-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 pr-2 text-[12px] text-ink-2">
            <input type="checkbox" className="accent-cinnabar" checked={checked.size === shots.length} onChange={() => setChecked(checked.size === shots.length ? new Set() : new Set(shots.map((s) => s.id)))} />
            全选
          </label>
          {narrated ? (
            <>
              <Button size="sm" disabled={!ids.length || pending} onClick={() => act(() => approveStoryboard(project.id, chapter.id, ids))}>
                审定页
              </Button>
              <Button size="sm" disabled={!ids.length || pending} onClick={() => act(() => generateFrames(project.id, chapter.id, ids))} title="gpt-image 画这一页的画面">
                出图
              </Button>
              <Link href={`/projects/${project.id}/casting`} className="inline-flex h-7 items-center border border-line px-2 text-[12px] text-ink-2 hover:border-line-strong hover:text-ink" title="配音前的闸门：每个开口的角色和旁白都要人工确认一个音色">
                选角
              </Link>
              <Button size="sm" disabled={!ids.length || pending} onClick={() => act(async () => { const n = await generateChapterVoices(project.id, chapter.id, { shotIds: ids }); toast.push(n ? "ok" : "info", n ? `已排队 ${n} 条配音` : "选中的页配音都是新的，没有要重配的"); })} title="MiniMax TTS。选角没全部确认会拒绝；配齐一页自动渲染页视频">
                配音
              </Button>
              {project.presentStyle === "galgame" && (
                <Button size="sm" disabled={pending} onClick={() => act(async () => { const n = await generateChapterSprites(project.id, chapter.id); toast.push(n ? "ok" : "info", n ? `已排队 ${n} 张立绘（按本章台词的人设 × 表情补齐）` : "本章台词用到的立绘都齐了"); })} title="galgame 立绘：按本章台词里出现的人设 × 表情，把还没有的补齐；人物库里也能逐个看和重画">
                立绘
              </Button>
              )}
              <Button size="sm" disabled={!ids.length || pending} onClick={() => act(async () => { const n = await renderPages(project.id, chapter.id, ids); toast.push(n ? "ok" : "info", n ? `开始渲染 ${n} 页` : "选中的页里没有「有图且配音齐」的"); })} title="图 + 配音 → 页视频（有图且配音齐的页才会渲染）">
                渲染页
              </Button>
              <Button size="sm" disabled={!ids.length || pending} onClick={() => act(() => acceptVideos(project.id, chapter.id, ids))}>
                验收
              </Button>
              <span className="mx-1 h-4 border-l border-line" />
            </>
          ) : (
            <>
              <Button size="sm" disabled={!ids.length || pending} onClick={() => act(() => approveStoryboard(project.id, chapter.id, ids))}>
                审定分镜
              </Button>
              <Button size="sm" variant="primary" disabled={pending} onClick={() => setPrevizOpen(true)} title="以视频为中心的首帧：把镜头在一条视频里快速闪一遍，再从里面截首帧。勾选了镜头就只预演勾选的">
                预演
              </Button>
              <Button size="sm" disabled={!ids.length || pending} onClick={() => act(() => generateFrames(project.id, chapter.id, ids))} title="备用：用 gpt-image 画首帧">
                生成首帧
              </Button>
              <Button size="sm" disabled={!ids.length || pending} onClick={() => act(() => approveFrames(project.id, chapter.id, ids))}>
                审定首帧
              </Button>
              <Button size="sm" disabled={!ids.length || pending} onClick={() => act(() => generateVideos(project.id, chapter.id, ids))}>
                生成视频
              </Button>
              <Button size="sm" disabled={!ids.length || pending} onClick={() => act(() => acceptVideos(project.id, chapter.id, ids))}>
                验收
              </Button>
              <span className="mx-1 h-4 border-l border-line" />
              <Button size="sm" variant="ghost" disabled={!ids.length || pending} onClick={() => act(() => setFrameMode(project.id, chapter.id, ids, "image"))}>
                设为首帧
              </Button>
              <Button size="sm" variant="ghost" disabled={!ids.length || pending} onClick={() => act(() => setFrameMode(project.id, chapter.id, ids, "text_only"))}>
                设为直出
              </Button>
              <span className="mx-1 h-4 border-l border-line" />
            </>
          )}
          <select
            value=""
            disabled={!ids.length || pending}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") return;
              act(() => setShotBgm(project.id, chapter.id, ids, v === "__none" ? null : v));
            }}
            className="h-7 rounded-sm border border-line bg-panel px-1.5 text-[12px] text-ink-2 disabled:opacity-40"
            title="给选中镜头设 BGM"
          >
            <option value="">♪ 设 BGM…</option>
            <option value="__none">无</option>
            {(project.bgmTracks ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {!narrated && <select
            value=""
            disabled={!ids.length || pending}
            onChange={(e) => {
              if (!e.target.value) return;
              act(() => setShotBgmToModel(project.id, chapter.id, ids, e.target.value === "on"));
            }}
            className="h-7 rounded-sm border border-line bg-panel px-1.5 text-[12px] text-ink-2 disabled:opacity-40"
            title="BGM 是否作为参考音频送给视频模型（不影响导出混音）"
          >
            <option value="">BGM 送模型…（默认关）</option>
            <option value="on">送</option>
            <option value="off">不送</option>
          </select>}
          {checked.size > 0 && <Mono className="text-[10.5px] text-ink-3">已选 {checked.size}</Mono>}
        </div>
        <div className="flex items-center gap-5 font-mono text-[11px] text-ink-2">
          <span>
            第 {String(chapter.index).padStart(2, "0")} 章 <span className="font-serif font-bold text-ink">{chapter.title}</span>
          </span>
          <span className="border-l border-line pl-5">
            {doneCount}/{shots.length} {narrated ? "页" : "镜"}
          </span>
          <span>{formatTimecode(totalDuration)}</span>
          <span>
            <span className="text-ink-3">费用</span> $ {totalCost.toFixed(2)}
          </span>
          {busy && <span className="text-indigo">● 有任务在跑</span>}
          <Button size="sm" variant={agentOpen ? "primary" : "outline"} onClick={() => setAgentOpen((v) => !v)}>
            Agent
          </Button>
        </div>
      </div>

      {previzOpen && (
        <PrevizPanel
          project={project}
          chapter={chapter}
          selectedIds={ids}
          onClose={() => setPrevizOpen(false)}
          onPickFrame={(shotId) => {
            setPrevizOpen(false);
            setCurrentId(shotId);
            setStageRequest({ stage: "frame", nonce: Date.now() });
          }}
        />
      )}

      {/* 三栏 */}
      <div className="grid min-h-0 flex-1 grid-cols-[320px_1fr_380px] 2xl:grid-cols-[360px_1fr_440px]">
        <LeftPane
          project={project}
          chapter={chapter}
          current={current}
          onPickUnit={(unitId) => setCurrentId(shots.find((s) => s.unitId === unitId)?.id ?? null)}
          onPickShot={(id) => setCurrentId(id)}
        />

        <div className="min-h-0 overflow-y-auto border-r border-line bg-panel">
          {chapter.agentStatus === "failed" && chapter.agentError && (
            <div className="border-b border-line bg-cinnabar-wash px-4 py-2 font-mono text-[11px] text-cinnabar">{narrated ? "拆页" : "拆镜"}失败：{chapter.agentError}</div>
          )}
          {groups.map(({ unit, shots: us }) => (
            <section key={unit.id}>
              <UnitHeader unit={unit} shots={us} narrated={narrated} />
              <ul className="stagger">
                {us.map((s, i) => (
                  <ShotRow
                    order={i}
                    key={s.id}
                    shot={s}
                    project={project}
                    chapter={chapter}
                    active={s.id === currentId}
                    checked={checked.has(s.id)}
                    onSelect={() => setCurrentId(s.id)}
                    onCheck={() =>
                      setChecked((prev) => {
                        const n = new Set(prev);
                        if (n.has(s.id)) n.delete(s.id);
                        else n.add(s.id);
                        return n;
                      })
                    }
                    onToggleFrameMode={() => act(() => setFrameMode(project.id, chapter.id, [s.id], s.frameMode === "image" ? "text_only" : "image"))}
                  />
                ))}
              </ul>
            </section>
          ))}
          <div className="p-4">
            <button
              type="button"
              disabled={pending}
              onClick={() => act(async () => setCurrentId(await addShotAfter(project.id, chapter.id, shots[shots.length - 1]?.id ?? null)))}
              className="placeholder w-full rounded-sm py-3 text-[12px] tracking-wider text-ink-2 hover:text-cinnabar"
            >
              ＋ 手动加一{narrated ? "页" : "镜"}
            </button>
          </div>
        </div>

        <PreviewPane shot={current} project={project} chapter={chapter} placement={current ? placements.get(current.id) : undefined} stageRequest={stageRequest} />
      </div>

      {agentOpen && <AgentDrawer project={project} chapter={chapter} onClose={() => setAgentOpen(false)} />}
    </div>
  );
}
