"use client";

import { useEffect, useRef, useState } from "react";
import type { Chapter, Keyframe, Project, Shot } from "@/lib/types";
import { segmentsOf } from "@/lib/keyframes";
import { generateShotKeyframe, listKeyframeVersions, removeShotKeyframe, updateShotKeyframe, uploadShotKeyframe } from "@/server/actions";
import { useAct } from "@/components/use-act";
import { Button, Placeholder, Stamp, cx } from "@/components/ui";
import { FreshBadge, Tape, frameAspect, previewMaxW } from "./shared";
import { VersionStrip } from "./version-strip";

export function fileForm(f: File) {
  const fd = new FormData();
  fd.set("file", f);
  return fd;
}

/** 拖放区：拖一张图进来就回调；点击不拦截，里面的链接照常工作 */
export function DropZone({ children, onFile, hint, className }: { children: React.ReactNode; onFile: (f: File) => void; hint: string; className?: string }) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={cx("relative", className)}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = [...e.dataTransfer.files].find((x) => x.type.startsWith("image/"));
        if (f) onFile(f);
      }}
    >
      {children}
      {over && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center border-2 border-dashed border-cinnabar bg-paper/80 text-[12px] text-cinnabar">{hint}</div>
      )}
    </div>
  );
}

/** 点选文件的小按钮 */
export function FilePick({ label, onFile, size = "sm" }: { label: string; onFile: (f: File) => void; size?: "sm" }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button size={size} variant="ghost" onClick={() => ref.current?.click()}>
        {label}
      </Button>
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
    </>
  );
}

/** 一张关键帧的卡片：时间点、图、描述、生成 / 上传、版本。右栏普通模式与时间线面板共用 */
export function KeyframeCard({ kf, shot, project, chapter }: { kf: Keyframe; shot: Shot; project: Project; chapter: Chapter }) {
  const { act: run, pending } = useAct();
  const [text, setText] = useState(kf.prompt);
  useEffect(() => setText(kf.prompt), [kf.prompt]);
  const [seg, setSeg] = useState(kf.segmentPrompt ?? "");
  useEffect(() => setSeg(kf.segmentPrompt ?? ""), [kf.segmentPrompt]);
  const segDirty = seg !== (kf.segmentPrompt ?? "");
  const saveSeg = () => { if (segDirty) run(() => updateShotKeyframe(project.id, chapter.id, kf.id, { segmentPrompt: seg })); };
  // 这一帧是哪一段的终点：首帧/上一帧 → 这一帧
  const segs = segmentsOf(shot.keyframes ?? [], shot.duration);
  const mine = segs.find((x) => x.to?.id === kf.id);
  const multi = segs.length > 1;
  const running = shot.generations?.some((g) => g.kind === "keyframe" && g.keyframeId === kf.id && (g.status === "running" || g.status === "queued"));
  const hasPrompt = Boolean(kf.prompt.trim());
  const dirty = text !== kf.prompt;
  const isEnd = kf.at < 0;
  const upload = (f: File) => run(() => uploadShotKeyframe(project.id, chapter.id, kf.id, fileForm(f)));
  const savePrompt = () => { if (dirty) run(() => updateShotKeyframe(project.id, chapter.id, kf.id, { prompt: text })); };

  return (
    <div className="mt-2 border border-line bg-panel p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11.5px]">
          <Stamp tone={isEnd ? "cinnabar" : "neutral"}>{isEnd ? "尾帧" : `第 ${kf.at} 秒`}</Stamp>
          {!isEnd && (
            <button
              className="font-mono text-[10px] text-ink-3 hover:text-cinnabar"
              title="改时间点"
              disabled={pending}
              onClick={() => {
                const v = prompt(`改到第几秒？（1–${Math.max(1, shot.duration - 1)}）`, String(kf.at));
                if (v === null) return;
                const at = Number(v);
                if (!Number.isFinite(at) || at <= 0 || at >= shot.duration) { alert("要在 0 与镜头时长之间"); return; }
                run(() => updateShotKeyframe(project.id, chapter.id, kf.id, { at: Math.round(at * 2) / 2 }));
              }}
            >
              改
            </button>
          )}
          <FreshBadge level={kf.freshness} />
        </span>
        <button
          disabled={pending}
          title="删掉这一帧及其历史版本"
          onClick={() => { if (confirm(`删掉${isEnd ? "尾帧" : `第 ${kf.at} 秒的关键帧`}？`)) run(() => removeShotKeyframe(project.id, chapter.id, kf.id)); }}
          className="font-mono text-[11px] text-ink-3 hover:text-cinnabar"
        >
          ×
        </button>
      </div>
      <DropZone className={cx("mx-auto block", previewMaxW(project.orientation))} hint="拖一张图进来直接当这一帧" onFile={upload}>
        {kf.url ? (
          <a href={kf.url} target="_blank" rel="noreferrer" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={kf.url} alt="" className={cx("w-full border border-line object-cover", running && "opacity-50")} style={{ aspectRatio: frameAspect(project.orientation) }} />
          </a>
        ) : (
          <Placeholder ratio={frameAspect(project.orientation)} label={running ? "生成中" : isEnd ? "END FRAME · 拖图进来" : `KEYFRAME @${kf.at}s · 拖图进来`} />
        )}
      </DropZone>
      {running && <Tape label="gpt-image-2.5 · 以首帧为基准 · 约 40–90 秒" />}
      <textarea
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={savePrompt}
        placeholder={isEnd ? "结束那一刻的画面，只写相对首帧变了什么：她已转过身推开门；机位不变" : "这一秒的画面，只写相对首帧变了什么"}
        className="mt-1.5 w-full border border-line bg-paper px-1.5 py-1 text-[11px] leading-relaxed"
        title="失焦即保存。改了会让这一帧标过期"
      />
      {multi && mine && (
        <>
          <textarea
            rows={2}
            value={seg}
            onChange={(e) => setSeg(e.target.value)}
            onBlur={saveSeg}
            placeholder={`第 ${mine.index + 1}/${segs.length} 段（${mine.start}–${mine.end}s）的视频提示词：从${mine.from ? `第 ${mine.from.at} 秒的画面` : "首帧"}到这一帧的动作过程 + 这一段的台词。留空 = 用镜头的视频提示词`}
            className={cx("mt-1.5 w-full border bg-paper px-1.5 py-1 text-[11px] leading-relaxed", seg.trim() ? "border-line" : "border-dashed border-cinnabar/50")}
            title="分段路线里每一段是独立的一次生成，模型看不到别的段；这段的动作与台词要在这里写全。失焦即保存，改了会让视频标过期"
          />
          {segDirty && (
            <div className="mt-1 flex justify-end">
              <Button size="sm" variant="primary" disabled={pending} onClick={saveSeg}>保存段提示词</Button>
            </div>
          )}
        </>
      )}
      <div className="mt-1 flex flex-wrap justify-end gap-1">
        {dirty && (
          <Button size="sm" variant="primary" disabled={pending} onClick={savePrompt}>
            保存描述
          </Button>
        )}
        <Button
          size="sm"
          variant={hasPrompt && !kf.url && !dirty ? "primary" : "ghost"}
          disabled={pending || running || !hasPrompt || !shot.frameUrl || dirty}
          title={!shot.frameUrl ? "先出首帧" : !hasPrompt ? "先写描述" : "以本镜首帧为基准，按描述出这一帧"}
          onClick={() => run(() => generateShotKeyframe(project.id, chapter.id, kf.id))}
        >
          {kf.url ? "重画" : "生成"}
        </Button>
        <FilePick label="上传" onFile={upload} />
      </div>
      {(kf.url || hasPrompt) && <VersionStrip project={project} chapter={chapter} kind="图" load={() => listKeyframeVersions(kf.id)} />}
    </div>
  );
}

