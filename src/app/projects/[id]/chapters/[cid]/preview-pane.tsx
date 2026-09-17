"use client";

import { useEffect, useState } from "react";
import { IMAGE_QUALITY_OPTIONS, imagePrice, type Chapter, type PrevizRun, type Project, type Shot, type ShotStatus, type FrameMode } from "@/lib/types";
import { STATUS_LABEL, formatTimecode, isGenerating } from "@/lib/status";
import {
  acceptVideos,
  approveFrames,
  approveStoryboard,
  generateFrames,
  generateVideos,
  generateVideoVersion,
  setShotUsePrevLastFrame,
  setShotFrameQuality,
  uploadShotFrame,
  useShotPrevLastFrame,
  addShotKeyframe,
  generateShotKeyframes,
  useShotNextFirstFrame,
  addShotExtraRef,
  labelShotExtraRef,
  removeShotExtraRef,
  listVersions,
  regenerateVideo,
  rerunFrom,
  revertShot,
  rewriteShot,
  setFrameMode,
} from "@/server/actions";
import type { ChatProviderName } from "@/server/providers/chat";
import { useAct } from "@/components/use-act";
import { Button, Field, Mono, Placeholder, Stamp, StatusStamp, Textarea, cx } from "@/components/ui";
import { segmentsOf } from "@/lib/keyframes";
import { ShotCanvas } from "./canvas";
import { TimelinePanel } from "./timeline-panel";
import { PrevizPicker } from "./previz-picker";
import { listPreviz } from "@/server/actions";
import { VersionStrip } from "./version-strip";
import { DropZone, FilePick, KeyframeCard, fileForm } from "./keyframe-card";
import { FreshBadge, InputList, PROVIDERS, STAGES, Tape, defaultStage, frameAspect, previewMaxW, type Stage } from "./shared";

/**
 * 首帧之外的关键帧。每一帧是镜头时间线上的一个画面锚点：结尾那张就是尾帧，也可以放中间的。
 * 三种来路：按描述以首帧为基准生成、直接上传、结尾那张还能拿下一镜首帧（剪辑点无缝）。
 * 视频路线随之变化：只有尾帧 → 首尾帧钉死；有中间帧 → 按帧切成若干段，每段首尾帧钉死后拼接。
 * 不动镜头状态，进度看各帧自己的 Generation。
 */
function KeyframesBlock({ shot, project, chapter, onTimeline }: { shot: Shot; project: Project; chapter: Chapter; onTimeline: () => void }) {
  const { act: run, pending } = useAct();
  const kfs = shot.keyframes ?? [];
  const route = shot.videoRoute ?? "i2v";
  const hasEnd = kfs.some((k) => k.at < 0);
  const withPrompt = kfs.filter((k) => k.prompt.trim()).length;
  const minSeg = project.minSegmentSeconds ?? 5;
  const routeNote =
    route === "segments"
      ? `分段首尾帧 · Turbo · 视频 $${project.videoPerSecond ?? 0.01}/s · 切成 ${segmentsOf(kfs, shot.duration).length} 段各自钉死起止后拼接`
      : route === "flf"
        ? `首尾帧 · Turbo · 视频 $${project.videoPerSecond ?? 0.01}/s · 起止画面钉死`
        : kfs.length
          ? "关键帧还没出图 · 视频仍走首帧模式"
          : "留空则只用首帧";

  return (
    <div className="mt-3 border-t border-dashed border-line pt-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11.5px] tracking-wider text-ink-2">关键帧 <span className="text-ink-3">· 可选</span></span>
        <div className="flex items-center gap-2">
          <Mono className="text-[10px] text-ink-3">{routeNote}</Mono>
          <button onClick={onTimeline} className="border border-line px-1.5 py-0.5 text-[10.5px] text-ink-2 hover:bg-panel hover:text-ink" title="大窗口：在时间线上拖动关键帧的时间点，预览注入视频提示词的原文">
            时间线
          </button>
        </div>
      </div>
      {kfs.map((k) => (
        <KeyframeCard key={k.id} kf={k} shot={shot} project={project} chapter={chapter} />
      ))}
      <div className="mt-2 flex flex-wrap justify-end gap-1">
        {!hasEnd && (
          <Button size="sm" variant="ghost" disabled={pending} title="结尾那一刻的画面：只有它时视频走首尾帧，起止都钉死" onClick={() => run(() => addShotKeyframe(project.id, chapter.id, shot.id, -1))}>
            ＋ 尾帧
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          title={`镜头中间某一秒的画面：有了它视频按帧切段、每段首尾帧钉死后拼接。每段至少 ${minSeg} 秒`}
          disabled={pending || shot.duration < minSeg * 2}
          onClick={() => {
            const v = prompt(`第几秒的画面？（${minSeg}–${shot.duration - minSeg}，整数）`, String(Math.round(shot.duration / 2)));
            if (v === null) return;
            const at = Number(v);
            if (!Number.isInteger(at) || at < minSeg || at > shot.duration - minSeg) { alert(`要在第 ${minSeg}–${shot.duration - minSeg} 秒之间的整数`); return; }
            run(() => addShotKeyframe(project.id, chapter.id, shot.id, at));
          }}
        >
          ＋ 中间帧
        </Button>
        {!hasEnd && (
          <Button size="sm" variant="ghost" disabled={pending} title="拿下一镜的首帧当本镜尾帧：本镜结束在下一镜开始的画面上，剪辑点无缝" onClick={() => run(() => useShotNextFirstFrame(project.id, chapter.id, shot.id))}>
            用下一镜首帧作尾帧
          </Button>
        )}
        {withPrompt > 1 && (
          <Button size="sm" variant="ghost" disabled={pending || !shot.frameUrl} title="按时间顺序串行重画所有写了描述的关键帧" onClick={() => run(() => generateShotKeyframes(project.id, chapter.id, shot.id))}>
            重画全部（{withPrompt}）
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * 创作者手动补充的首帧参考图。每张一个标签说明用途（姿势 / 光线 / 构图 / 某个物件…），
 * 提示词里会告诉模型「只在标签说的那个方面参考它」。换图、加图、删图都会让首帧标过期。
 */
function ExtraRefs({ shot, project, chapter }: { shot: Shot; project: Project; chapter: Chapter }) {
  const { act: run, pending } = useAct();
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [pendingLabel, setPendingLabel] = useState("");
  const refs = shot.extraRefs ?? [];
  const add = (f: File) => run(async () => { await addShotExtraRef(project.id, chapter.id, shot.id, fileForm(f), pendingLabel); setPendingLabel(""); });

  return (
    <div className="mt-3 border-t border-dashed border-line pt-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11.5px] tracking-wider text-ink-2">补充参考图</span>
        <Mono className="text-[10px] text-ink-3">{refs.length ? `${refs.length} 张 · 随人设道具一起送进首帧` : "姿势 / 光线 / 构图 / 物件…"}</Mono>
      </div>
      <DropZone hint="放开：作为补充参考图" onFile={add}>
        <div className="flex flex-wrap items-start gap-2">
          {refs.map((r) => (
            <div key={r.id} className="w-[96px]">
              <div className="relative">
                {r.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a href={r.url} target="_blank" rel="noreferrer"><img src={r.url} alt="" className="aspect-square w-full border border-line object-cover" /></a>
                ) : (
                  <Placeholder ratio="1/1" label="—" />
                )}
                <button
                  disabled={pending}
                  title="移除"
                  onClick={() => { if (confirm(`移除参考图「${r.label}」？`)) run(() => removeShotExtraRef(project.id, chapter.id, r.id)); }}
                  className="absolute right-0 top-0 bg-paper/90 px-1 font-mono text-[10px] leading-[16px] text-ink-3 hover:text-cinnabar"
                >
                  ×
                </button>
              </div>
              {editing?.id === r.id ? (
                <input
                  autoFocus
                  value={editing.text}
                  onChange={(e) => setEditing({ id: r.id, text: e.target.value })}
                  onBlur={() => { const t = editing.text; setEditing(null); if (t !== r.label) run(() => labelShotExtraRef(project.id, chapter.id, r.id, t)); }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(null); }}
                  className="mt-1 w-full border border-line bg-panel px-1 py-0.5 text-[10.5px]"
                />
              ) : (
                <button onClick={() => setEditing({ id: r.id, text: r.label })} className="mt-1 block w-full truncate text-left text-[10.5px] text-ink hover:text-cinnabar" title="点击改用途标签">
                  {r.label || "（无标签）"}
                </button>
              )}
            </div>
          ))}
          <div className="flex w-[96px] flex-col gap-1">
            <input
              value={pendingLabel}
              onChange={(e) => setPendingLabel(e.target.value)}
              placeholder="用途标签"
              className="w-full border border-line bg-panel px-1 py-0.5 text-[10.5px]"
              title="先写这张图是干什么用的，再拖图或点选"
            />
            <div className="placeholder flex aspect-square w-full items-center justify-center text-[10px] text-ink-3">拖图到此</div>
            <FilePick label="点选…" onFile={add} />
          </div>
        </div>
      </DropZone>
    </div>
  );
}

/** 血缘：这一级实际喂进模型的输入 */

/** 按当前状态推算下次出片走的模型与路线，和任务端 planH3 / videoRouteOf 的规则一致 */
function plannedVideoModel(shot: Shot, project: Project) {
  if (project.videoEngine === "omni") return "Omni 1.1";
  if (shot.frameMode === "text_only") return project.textOnlyRefs && (shot.characters.length || shot.sceneId || shot.propIds?.length) ? "H3 Max · 全能参考" : "H3 Turbo · 文生";
  const route = shot.videoRoute ?? "i2v";
  return route === "segments" ? `H3 Turbo · ${segmentsOf(shot.keyframes ?? [], shot.duration).length} 段拼接` : route === "flf" ? "H3 Turbo · 首尾帧" : "H3 Turbo · 首帧";
}

type PreviewProps = {
  shot: Shot;
  project: Project;
  chapter: Chapter;
  placement?: { trackStart: number; len: number; isRunStart: boolean };
  /** 外部要求切到某个页签（预演面板的「去截帧」）。nonce 变一次切一次 */
  stageRequest?: { stage: Stage; nonce: number } | null;
};

export function PreviewPane({ shot, ...rest }: { shot: Shot | null } & Omit<PreviewProps, "shot">) {
  if (!shot) {
    return (
      <aside className="flex items-center justify-center bg-paper p-6">
        <Placeholder className="h-64 w-full" label="选择一个镜头" />
      </aside>
    );
  }
  // key 让换镜头时页签自动回到默认阶段
  return <PreviewBody key={shot.id} shot={shot} {...rest} />;
}

function PreviewBody({ shot, project, chapter, placement, stageRequest }: PreviewProps) {
  const { act: run, pending } = useAct();
  const [stage, setStage] = useState<Stage>(stageRequest?.stage ?? defaultStage(shot.status));
  useEffect(() => {
    if (stageRequest) setStage(stageRequest.stage);
  }, [stageRequest]);
  // 这一镜有没有可截帧的预演：有就在首帧页最上面摆截帧器，并在别的页签给个入口
  const [previzRuns, setPrevizRuns] = useState<PrevizRun[] | null>(null);
  useEffect(() => {
    let alive = true;
    listPreviz(chapter.id).then((all) => {
      // 本章所有能播的预演都给：新插的镜头不在任何一条的格子里，也得能从邻近镜头的时段里截。含本镜的排前面
      const ok = all.filter((r) => r.status === "success" && r.url);
      const has = (r: PrevizRun) => (r.slots.some((s) => s.shotId === shot.id) ? 0 : 1);
      if (alive) setPrevizRuns(ok.sort((a, b) => has(a) - has(b)));
    });
    return () => { alive = false; };
    // chapter.updatedAt / 页面每次刷新都重拉一次：预演面板刚出的新条目才能立刻出现在下拉里
  }, [chapter.id, chapter.updatedAt, shot.id, shot.previzGenerationId, shot.previzTime, chapter]);
  const [canvas, setCanvas] = useState(false);
  const [timeline, setTimeline] = useState(false);
  const refs = shot.characters.map((c) => {
    const ch = project.characters.find((x) => x.id === c.characterId);
    const persona = ch?.personas.find((p) => p.tag === c.personaTag);
    return { name: ch?.name ?? "?", tag: c.personaTag, url: persona?.sheetUrl ?? null };
  });
  const ids = [shot.id];
  const latestVideoGen = shot.generations?.find((g) => g.kind === "video");
  const fresh = shot.freshness;
  // 上游变了但自身输入没动：视频看首帧
  const videoUpstream = fresh?.frame === "stale";

  return (
    <aside className="flex min-h-0 flex-col overflow-y-auto bg-paper">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-paper px-4 py-1.5">
        <div className="flex items-center gap-2">
          <Mono className="text-[12px]">#{String(shot.index).padStart(2, "0")}</Mono>
          <span className="text-[12px] text-ink-2">
            {shot.shotSize} · {shot.duration}s
          </span>
        </div>
        <div className="flex items-center gap-2">
          {shot.frameMode === "image" && (
            <button
              onClick={() => setTimeline(true)}
              className="border border-line px-1.5 py-0.5 text-[11px] text-ink-2 hover:bg-panel hover:text-ink"
              title="时间线：在一条时间轴上增删改首帧、关键帧、尾帧的时间点，预览注入视频提示词的原文"
            >
              时间线
            </button>
          )}
          <button
            onClick={() => setCanvas(true)}
            className="border border-line px-1.5 py-0.5 text-[11px] text-ink-2 hover:bg-panel hover:text-ink"
            title="把本镜的生产流程摊开成节点图"
          >
            展开为画布
          </button>
          <StatusStamp status={shot.status} />
        </div>
      </header>

      {canvas && <ShotCanvas shot={shot} project={project} chapter={chapter} onClose={() => setCanvas(false)} />}
      {timeline && <TimelinePanel shot={shot} project={project} chapter={chapter} onClose={() => setTimeline(false)} />}

      <nav className="flex border-b border-line bg-paper px-2">
        {STAGES.map((st) => {
          const dot = st.id === "frame" ? fresh?.frame : st.id === "video" ? fresh?.video : undefined;
          return (
            <button
              key={st.id}
              onClick={() => setStage(st.id)}
              className={cx(
                "relative border-b-2 px-2.5 py-1.5 text-[12px] transition-colors",
                stage === st.id ? "border-cinnabar text-ink" : "border-transparent text-ink-2 hover:text-ink",
              )}
            >
              {st.label}
              {dot === "stale" && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-cinnabar align-middle" />}
              {st.id === "frame" && previzRuns && previzRuns.length > 0 && <span className="ml-1 align-middle font-mono text-[9px] text-cinnabar" title="这一镜有预演可截帧">截</span>}
            </button>
          );
        })}
      </nav>

      <div className="p-4">
        {stage === "reference" && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11.5px] tracking-wider text-ink-2">参考图</span>
              <Mono className="text-[10px] text-ink-3">{refs.length} 个人设</Mono>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {refs.map((r) => (
                <div key={r.name + r.tag}>
                  {r.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.url} alt="" className="aspect-[3/2] w-full border border-line object-cover" />
                  ) : (
                    <Placeholder ratio="3/2" label="未生成三视图" />
                  )}
                  <div className="mt-1 flex items-center gap-1.5 text-[11.5px]">
                    <span className="font-serif font-bold">{r.name}</span>
                    <Stamp tone="cinnabar">{r.tag}</Stamp>
                  </div>
                </div>
              ))}
              {refs.length === 0 && <Placeholder ratio="3/2" label="空镜，无人物" className="col-span-2" />}
            </div>
            {shot.frameMode === "text_only" && <p className="mt-3 border-t border-line pt-3 text-[11.5px] text-ink-3">直出模式：跳过首帧。有人物参考图时走 H3 全能参考（可带人物声音样本），否则走文生视频。</p>}
          </div>
        )}

        {stage === "frame" && (
          <div>
            {previzRuns && previzRuns.length > 0 && (
              <PrevizPicker shot={shot} project={project} chapter={chapter} runs={previzRuns} />
            )}
            {previzRuns && previzRuns.length === 0 && (
              <p className="mb-2 border border-dashed border-line px-2.5 py-1.5 text-[10.5px] text-ink-3">这一章还没有预演。工具条「预演」把整章闪一遍，回来这里拖进度条截首帧。</p>
            )}
            {shot.frameMode === "text_only" && (
              <div className="mb-2 flex items-center justify-between gap-2 border border-cinnabar/40 bg-cinnabar-wash px-2.5 py-1.5 text-[11px] text-cinnabar">
                <span>这一镜是<b>直出</b>模式：出视频时不会用首帧{shot.frameUrl ? "，下面这张只是摆着" : ""}。传首帧 / 用上一镜末帧 / 生成首帧都会自动切到首帧模式。</span>
                <button className="shrink-0 border border-cinnabar/60 px-1.5 py-0.5 hover:bg-paper" disabled={pending} onClick={() => run(() => setFrameMode(project.id, chapter.id, ids, "image"))}>
                  改为首帧模式
                </button>
              </div>
            )}
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11.5px] tracking-wider text-ink-2">首帧</span>
              <div className="flex items-center gap-1.5">
                <FreshBadge level={fresh?.frame} />
                <select
                  value={shot.frameQuality || ""}
                  disabled={pending}
                  onChange={(e) => run(() => setShotFrameQuality(project.id, chapter.id, shot.id, e.target.value))}
                  className="rounded-sm border border-line bg-panel px-1.5 py-0.5 font-mono text-[10.5px]"
                  title="gpt-image-2.5 推理等级。改了会让首帧标过期"
                >
                  <option value="">跟随项目 · {project.imageQuality || "low"} · ${imagePrice(project.imageQuality || "low").toFixed(3)}</option>
                  {IMAGE_QUALITY_OPTIONS.map((q) => (
                    <option key={q} value={q}>
                      {q} · ${imagePrice(q).toFixed(3)}/张
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <DropZone
              className={cx("mx-auto block", previewMaxW(project.orientation))}
              hint="拖一张图进来直接当首帧"
              onFile={(f) => run(() => uploadShotFrame(project.id, chapter.id, shot.id, fileForm(f)))}
            >
              {shot.frameUrl ? (
                <a href={shot.frameUrl} target="_blank" rel="noreferrer" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={shot.frameUrl} alt="" className={cx("w-full border border-line object-cover", shot.status === "frame_generating" && "opacity-50")} style={{ aspectRatio: frameAspect(project.orientation) }} />
                </a>
              ) : (
                <Placeholder ratio={frameAspect(project.orientation)} label={shot.status === "frame_generating" ? "生成中" : "FIRST FRAME · 拖图进来"} />
              )}
            </DropZone>
            {shot.status === "frame_generating" && <Tape label="gpt-image-2.5 · 约 40–90 秒" />}
            <div className="mt-1.5 flex justify-end gap-1">
              <Button size="sm" variant="ghost" disabled={pending} title="不经过生图：直接截上一镜成片的最后一帧当本镜首帧，视频从那个画面接着拍" onClick={() => run(() => useShotPrevLastFrame(project.id, chapter.id, shot.id))}>
                用上一镜末帧
              </Button>
              <FilePick label="上传首帧" onFile={(f) => run(() => uploadShotFrame(project.id, chapter.id, shot.id, fileForm(f)))} />
            </div>

            <KeyframesBlock shot={shot} project={project} chapter={chapter} onTimeline={() => setTimeline(true)} />
            <ExtraRefs shot={shot} project={project} chapter={chapter} />
            <label className="mt-3 flex items-start gap-2 border border-line bg-panel px-2.5 py-2 text-[11.5px]" title="出首帧时把上一镜成片的最后一帧截下来当参考图，人物位置、姿态、光线从那一刻自然延续">
              <input
                type="checkbox"
                className="mt-0.5 accent-cinnabar"
                checked={Boolean(shot.usePrevLastFrame)}
                disabled={pending}
                onChange={(e) => run(() => setShotUsePrevLastFrame(project.id, chapter.id, shot.id, e.target.checked))}
              />
              <span>
                承接上一镜
                <Mono className="ml-1.5 text-[10px] text-ink-3">截取上一镜成片末帧作为首帧参考，保证时间上的延续</Mono>
              </span>
            </label>
            <div className="mt-3 flex gap-2">
              <Button className="flex-1" disabled={pending} onClick={() => run(() => generateFrames(project.id, chapter.id, ids))}>
                只重画首帧
              </Button>
              <Button variant="primary" className="flex-1" disabled={pending} onClick={() => run(() => rerunFrom(project.id, chapter.id, shot.id, "frame"))}>
                重画并出视频
              </Button>
            </div>
            <details className="mt-3 border-t border-dashed border-line pt-3">
              <summary className="cursor-pointer text-[11.5px] tracking-wider text-ink-2">首帧提示词</summary>
              <p className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-ink-2">{shot.framePrompt || "（空）"}</p>
            </details>
            <InputList items={shot.lineage?.frame} />
            <VersionStrip project={project} chapter={chapter} kind="图" load={() => listVersions(shot.id, "frame")} />
          </div>
        )}

        {stage === "video" && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11.5px] tracking-wider text-ink-2">视频</span>
              <div className="flex items-center gap-1.5">
                <FreshBadge level={fresh?.video} upstream={videoUpstream} />
                <span title="下次出片会走的路线（按当前关键帧算），不是上一版用的模型">
                  <Mono className="text-[10px] text-ink-3">{plannedVideoModel(shot, project)} · {shot.duration}s</Mono>
                </span>
              </div>
            </div>
            {shot.videoUrl && !isGenerating(shot.status) ? (
              <video controls src={shot.videoUrl} className={cx("mx-auto w-full border border-line bg-black", previewMaxW(project.orientation))} style={{ aspectRatio: frameAspect(project.orientation) }} />
            ) : shot.frameUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shot.frameUrl} alt="" className={cx("mx-auto w-full border border-line object-cover opacity-40", previewMaxW(project.orientation))} style={{ aspectRatio: frameAspect(project.orientation) }} />
            ) : (
              <Placeholder ratio={frameAspect(project.orientation)} label={isGenerating(shot.status) ? STATUS_LABEL[shot.status] : "VIDEO"} className={cx("mx-auto", previewMaxW(project.orientation))} />
            )}
            {isGenerating(shot.status) && <Tape label={shot.status === "video_queued" ? "排队提交中" : `生成中 · ${latestVideoGen?.progress || "轮询 10s"} · 常见 5–60 分钟`} />}
            {previzRuns && previzRuns.length > 0 && (
              <button onClick={() => setStage("frame")} className="mt-2 flex w-full items-center justify-between border border-dashed border-cinnabar/50 bg-cinnabar-wash px-2.5 py-1.5 text-[11px] text-cinnabar hover:bg-paper">
                <span>这一镜有预演 · 到首帧页拖进度条截首帧</span>
                <span className="font-mono">→ 首帧</span>
              </button>
            )}
            <details className="mt-3 border-t border-dashed border-line pt-3">
              <summary className="cursor-pointer text-[11.5px] tracking-wider text-ink-2">视频提示词</summary>
              <p className="mt-2 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-ink-2">{shot.videoPrompt || "（空）"}</p>
            </details>
            <InputList items={shot.lineage?.video} />
            <VersionStrip
              project={project}
              chapter={chapter}
              kind="视频"
              load={() => listVersions(shot.id, "video")}
              onGenerate={(keep) => generateVideoVersion(project.id, chapter.id, shot.id, keep)}
            />
          </div>
        )}

        {shot.bgmTrackName && placement && (
          <div className="mt-4 border-t border-line pt-4">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11.5px] tracking-wider text-ink-2">BGM</span>
              <Mono className="text-[10px] text-ink-3">{shot.bgmToModel === false ? "仅用于导出" : "送给模型 + 导出"}</Mono>
            </div>
            <div className="rounded-sm border border-line bg-panel px-2.5 py-2 text-[12px]">
              <div className="font-serif font-bold">♪ {shot.bgmTrackName}</div>
              <Mono className="mt-0.5 block text-[10.5px] text-ink-2">
                {placement.isRunStart ? "从曲子开头起" : `承接上一镜，从 ${formatTimecode(Math.floor(placement.trackStart))} 处继续`} · 取 {placement.len}s
              </Mono>
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
          <Actions
            status={shot.status}
            frameMode={shot.frameMode}
            pending={pending}
            on={{
              approve: () => run(() => approveStoryboard(project.id, chapter.id, ids)),
              frame: () => run(() => generateFrames(project.id, chapter.id, ids)),
              approveFrame: () => run(() => approveFrames(project.id, chapter.id, ids)),
              video: () => run(() => generateVideos(project.id, chapter.id, ids)),
              accept: () => run(() => acceptVideos(project.id, chapter.id, ids)),
              revert: () => run(() => revertShot(project.id, chapter.id, shot.id)),
              toggleMode: () => run(() => setFrameMode(project.id, chapter.id, ids, shot.frameMode === "image" ? "text_only" : "image")),
            }}
          />
        </div>

        {(shot.status === "video_ready" || shot.status === "done") && <RegenerateBox shot={shot} project={project} chapter={chapter} />}

        {!isGenerating(shot.status) && <RewriteBox shot={shot} project={project} chapter={chapter} />}

        <div className="mt-4 border-t border-line pt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11.5px] tracking-wider text-ink-2">生成记录</span>
            <Mono className="text-[10px] text-ink-3">本镜 $ {shot.cost.toFixed(2)}</Mono>
          </div>
          <ul className="font-mono text-[10.5px] text-ink-2">
            {(shot.generations ?? []).map((g) => (
              <li key={g.id} className="border-b border-dashed border-line py-1 last:border-0">
                <div className="flex items-center justify-between">
                  <span>
                    <span className="text-ink-3">{g.createdAt.slice(11)}</span> {g.kind} · {g.model || "-"} · {g.status}
                    {g.progress && g.status === "running" ? ` · ${g.progress}` : ""}
                  </span>
                  <span className="text-ink">{g.cost ? `$${g.cost.toFixed(2)}` : "—"}</span>
                </div>
                {g.error && <div className="mt-0.5 break-all text-cinnabar">{g.error.slice(0, 200)}</div>}
              </li>
            ))}
            {(shot.generations ?? []).length === 0 && <li className="py-1 text-ink-3">尚无生成</li>}
          </ul>
        </div>
      </div>
    </aside>
  );
}

function RegenerateBox({ shot, project, chapter }: { shot: Shot; project: Project; chapter: Chapter }) {
  const [text, setText] = useState("");
  const { act, pending } = useAct();
  return (
    <div className="mt-4 border-t border-line pt-4">
      <Field label="一句话修改 · 重生成视频" hint="上一版作参考">
        <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="例：镜头再推近一点，台词慢半拍，雪下得更大" />
      </Field>
      <div className="mt-2 flex items-center justify-between">
        <Mono className="text-[10px] text-ink-3">按秒计费 · {shot.duration}s · 768P</Mono>
        <Button size="sm" disabled={pending || !text.trim()} onClick={() => act(async () => { await regenerateVideo(project.id, chapter.id, shot.id, text); setText(""); })}>
          重生成
        </Button>
      </div>
    </div>
  );
}

function RewriteBox({ shot, project, chapter }: { shot: Shot; project: Project; chapter: Chapter }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [provider, setProvider] = useState<ChatProviderName>("chat");
  const { act, pending } = useAct();
  if (shot.rewriting) {
    return (
      <div className="mt-4 border-t border-line pt-4">
        <span className="text-[11.5px] tracking-wider text-ink-2">Agent 改写中</span>
        <Tape label="只重写本镜，其余不动 · 约 20–60 秒" />
      </div>
    );
  }
  return (
    <div className="mt-4 border-t border-line pt-4">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left text-[11.5px] tracking-wider text-ink-2 hover:text-ink">
        <span>让 Agent 重写本镜</span>
        <Mono className="text-[10px] text-ink-3">{open ? "收起" : "展开"}</Mono>
      </button>
      {open && (
        <div className="mt-2">
          <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="例：改成过肩反打，台词拆成两句；换成沈昭的「青年」人设；时长压到 4 秒。" />
          <div className="mt-2 flex items-center justify-between gap-2">
            <select value={provider} onChange={(e) => setProvider(e.target.value as ChatProviderName)} className="rounded-sm border border-line bg-panel px-1.5 py-1 font-mono text-[10.5px]">
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="primary"
              disabled={pending || !text.trim()}
              onClick={() =>
                act(async () => {
                  await rewriteShot(project.id, chapter.id, shot.id, text, provider);
                  setText("");
                  setOpen(false);
                })
              }
            >
              重写
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-ink-3">改写后本镜回到「待审分镜」，需要重新审定。</p>
        </div>
      )}
    </div>
  );
}


export function Actions({
  status,
  frameMode,
  pending,
  on,
}: {
  status: ShotStatus;
  frameMode: FrameMode;
  pending: boolean;
  on: Record<"approve" | "frame" | "approveFrame" | "video" | "accept" | "revert" | "toggleMode", () => void>;
}) {
  const P = { disabled: pending };
  switch (status) {
    case "draft":
      return (
        <Button variant="primary" {...P} onClick={on.approve}>
          审定分镜
        </Button>
      );
    case "storyboard_approved":
      return frameMode === "image" ? (
        <>
          <Button variant="primary" {...P} onClick={on.frame}>
            生成首帧
          </Button>
          <Button variant="ghost" {...P} onClick={on.revert}>
            退回修改
          </Button>
        </>
      ) : (
        <>
          <Button variant="primary" {...P} onClick={on.video}>
            生成视频（直出）
          </Button>
          <Button variant="ghost" {...P} onClick={on.revert}>
            退回修改
          </Button>
        </>
      );
    case "frame_generating":
      return <Button disabled>首帧生成中…</Button>;
    case "frame_ready":
      return (
        <>
          <Button variant="primary" {...P} onClick={on.approveFrame}>
            审定首帧
          </Button>
          <div className="flex gap-2">
            <Button className="flex-1" {...P} onClick={on.frame}>
              重新生成首帧
            </Button>
            <Button variant="ghost" {...P} onClick={on.revert}>
              退回
            </Button>
          </div>
        </>
      );
    case "frame_approved":
      return (
        <>
          <Button variant="primary" {...P} onClick={on.video}>
            生成视频
          </Button>
          <Button variant="ghost" {...P} onClick={on.revert}>
            退回首帧
          </Button>
        </>
      );
    case "video_queued":
      return <Button disabled>排队中…</Button>;
    case "video_generating":
      return <Button disabled>视频生成中…</Button>;
    case "video_ready":
      return (
        <>
          <Button variant="primary" {...P} onClick={on.accept}>
            验收通过
          </Button>
          <div className="flex gap-2">
            <Button className="flex-1" {...P} onClick={on.video}>
              重新生成
            </Button>
            <Button className="flex-1" {...P} onClick={on.revert}>
              退回
            </Button>
          </div>
        </>
      );
    case "done":
      return (
        <Button variant="ghost" {...P} onClick={on.revert}>
          重新打开
        </Button>
      );
  }
}

/* ================================================================== */

