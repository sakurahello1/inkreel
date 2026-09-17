"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Chapter, Project, Shot } from "@/lib/types";
import { formatTimecode } from "@/lib/status";
import { exportChapter } from "@/server/actions";
import { useAct } from "@/components/use-act";
import { useAutoRefresh } from "@/components/use-auto-refresh";
import { Avatar, Button, Mono, Placeholder, Stamp, cx } from "@/components/ui";

/** 与导出一致的裁剪规则，用来推算每一镜在成片里的起始时码 */
function clipLen(s: Shot) {
  const dur = s.videoDuration ?? s.duration;
  const start = Math.min(Math.max(0, s.clip?.in ?? 0), Math.max(0, dur - 0.2));
  const end = s.clip?.out && s.clip.out > start + 0.2 ? Math.min(s.clip.out, dur) : dur;
  return Math.max(0, end - start);
}

function chapterClips(ch: Chapter) {
  return ch.shots
    .filter((s) => s.videoUrl && s.clip?.enabled !== false)
    .sort((a, b) => (a.clip?.order ?? a.index) - (b.clip?.order ?? b.index));
}

export function Watch({ project, initialChapterId }: { project: Project; initialChapterId: string | null }) {
  const exported = project.chapters.filter((c) => c.timeline?.exportUrl);
  const [chapterId, setChapterId] = useState(initialChapterId ?? exported[0]?.id ?? project.chapters[0]?.id ?? "");
  const chapter = project.chapters.find((c) => c.id === chapterId) ?? null;
  const tl = chapter?.timeline;
  const { act, pending } = useAct();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [now, setNow] = useState(0);
  useAutoRefresh(tl?.exportStatus === "running", 4000);

  // 每一镜在成片里的起点，用于点击跳转与高亮
  const marks = useMemo(() => {
    if (!chapter) return [] as Array<{ shot: Shot; at: number; len: number }>;
    let at = 0;
    return chapterClips(chapter).map((shot) => {
      const len = clipLen(shot);
      const m = { shot, at, len };
      at += len;
      return m;
    });
  }, [chapter]);

  const total = marks.reduce((a, m) => a + m.len, 0);
  const activeIdx = marks.findIndex((m, i) => now >= m.at - 0.01 && (i === marks.length - 1 || now < marks[i + 1].at));

  useEffect(() => {
    setNow(0);
  }, [chapterId]);

  function seekTo(t: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(t + 0.05, (v.duration || total) - 0.1));
    void v.play().catch(() => undefined);
  }

  return (
    <main className="mx-auto grid max-w-[1500px] grid-cols-[220px_1fr_340px] gap-6 px-6 py-6">
      {/* 章节 */}
      <aside className="self-start rounded-sm border border-line bg-panel">
        <header className="flex items-center justify-between border-b border-line px-3 py-2">
          <h3 className="font-serif text-[14px] font-bold tracking-wide">章节</h3>
          <Mono className="text-[10.5px] text-ink-3">
            {exported.length}/{project.chapters.length}
          </Mono>
        </header>
        <ul>
          {project.chapters.map((c) => {
            const ready = Boolean(c.timeline?.exportUrl);
            const active = c.id === chapterId;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setChapterId(c.id)}
                  className={cx("flex w-full items-center gap-2 border-l-2 px-3 py-2.5 text-left transition-colors", active ? "border-cinnabar bg-paper" : "border-transparent hover:bg-paper")}
                >
                  <Mono className="shrink-0 text-[11px] text-ink-2">{String(c.index).padStart(2, "0")}</Mono>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-serif text-[13.5px] font-bold">{c.title}</span>
                    <Mono className="block text-[10px] text-ink-3">
                      {ready ? formatTimecode(Math.round(c.timeline?.exportDuration ?? 0)) : c.timeline?.exportStatus === "running" ? "合成中" : `${chapterClips(c).length} 段未导出`}
                    </Mono>
                  </span>
                  {ready && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-moss" />}
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* 播放器 */}
      <section className="flex flex-col items-center">
        {tl?.exportUrl && tl.exportStatus !== "running" ? (
          <>
            <video
              ref={videoRef}
              src={tl.exportUrl}
              controls
              playsInline
              onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
              className="max-h-[calc(100vh-230px)] w-auto border border-line-strong bg-black"
              style={{ aspectRatio: project.orientation === "16:9" ? "16/9" : "9/16" }}
            />
            <div className="mt-3 flex w-full max-w-[520px] items-center justify-between gap-3">
              <Mono className="text-[11px] text-ink-2">
                {formatTimecode(Math.floor(now))} / {formatTimecode(Math.round(tl.exportDuration ?? total))}
                {activeIdx >= 0 && <span className="ml-2 text-ink-3">第 {marks[activeIdx].shot.index} 镜</span>}
              </Mono>
              <div className="flex items-center gap-2">
                <Button size="sm" disabled={pending || !chapter} onClick={() => chapter && act(() => exportChapter(project.id, chapter.id))}>
                  重新导出
                </Button>
                <a
                  href={tl.exportUrl}
                  download={`${project.title}-第${chapter?.index ?? 1}章-${chapter?.title ?? ""}.mp4`}
                  className="inline-flex h-7 items-center rounded-sm border border-cinnabar bg-cinnabar px-2.5 text-[12px] text-paper hover:bg-cinnabar-deep"
                >
                  下载 mp4
                </a>
              </div>
            </div>
          </>
        ) : (
          <div className="flex w-full max-w-[420px] flex-col items-center">
            <Placeholder
              ratio={project.orientation === "16:9" ? "16/9" : "9/16"}
              className="w-full"
              label={tl?.exportStatus === "running" ? "ffmpeg 合成中" : "这一章还没有成片"}
              hint={tl?.exportStatus === "running" ? undefined : chapter && chapterClips(chapter).length ? "有可用镜头，点下面导出" : "先在分镜页把镜头的视频生成出来"}
            />
            {tl?.exportStatus === "running" && <div className="tape mt-3 w-full max-w-[260px]" />}
            {tl?.exportStatus === "failed" && tl.exportError && <p className="mt-3 w-full break-all rounded-sm border border-cinnabar/40 bg-cinnabar-wash px-2 py-1.5 font-mono text-[10.5px] text-cinnabar">{tl.exportError}</p>}
            {chapter && chapterClips(chapter).length > 0 && tl?.exportStatus !== "running" && (
              <Button variant="primary" className="mt-4" disabled={pending} onClick={() => act(() => exportChapter(project.id, chapter.id))}>
                导出这一章
              </Button>
            )}
          </div>
        )}
      </section>

      {/* 镜头目录：点了跳到那一镜 */}
      <aside className="self-start rounded-sm border border-line bg-panel">
        <header className="flex items-center justify-between border-b border-line px-3 py-2">
          <h3 className="font-serif text-[14px] font-bold tracking-wide">镜头目录</h3>
          <Mono className="text-[10.5px] text-ink-3">{marks.length} 段</Mono>
        </header>
        <ul className="max-h-[calc(100vh-260px)] overflow-y-auto">
          {marks.map((m, i) => {
            const line = m.shot.dialogue[0];
            const speaker = line ? project.characters.find((c) => c.id === line.characterId)?.name : null;
            return (
              <li key={m.shot.id}>
                <button
                  type="button"
                  onClick={() => seekTo(m.at)}
                  disabled={!tl?.exportUrl}
                  className={cx("flex w-full gap-2 border-b border-line px-2.5 py-2 text-left transition-colors last:border-0 disabled:opacity-50", i === activeIdx ? "bg-paper" : "hover:bg-paper")}
                >
                  {m.shot.frameUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.shot.frameUrl} alt="" className={cx("h-14 w-[31px] shrink-0 border object-cover", i === activeIdx ? "border-cinnabar" : "border-line")} />
                  ) : (
                    <span className="placeholder h-14 w-[31px] shrink-0 rounded-sm" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-1">
                      <Mono className={cx("text-[10.5px]", i === activeIdx ? "text-cinnabar" : "text-ink-2")}>
                        {formatTimecode(Math.floor(m.at))} · #{String(m.shot.index).padStart(2, "0")}
                      </Mono>
                      <Mono className="text-[9.5px] text-ink-3">{m.len.toFixed(1)}s</Mono>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1">
                      {m.shot.characters.slice(0, 2).map((c) => {
                        const ch = project.characters.find((x) => x.id === c.characterId);
                        return ch ? <Avatar key={c.characterId} name={ch.name} size={14} /> : null;
                      })}
                      <span className="truncate text-[11px] text-ink-2">
                        {line ? `${speaker}：${line.line}` : m.shot.action || m.shot.scene}
                      </span>
                    </span>
                    {m.shot.bgmTrackName && <Mono className="mt-0.5 block truncate text-[9.5px] text-ink-3">♪ {m.shot.bgmTrackName}</Mono>}
                  </span>
                </button>
              </li>
            );
          })}
          {marks.length === 0 && <li className="px-3 py-8 text-center text-[12px] text-ink-3">这一章还没有生成视频的镜头</li>}
        </ul>
        {chapter && (
          <div className="flex items-center justify-between border-t border-line px-3 py-2">
            <Mono className="text-[10.5px] text-ink-3">合计 {formatTimecode(Math.round(total))}</Mono>
            {tl?.subtitles && <Stamp tone="moss">已烧字幕</Stamp>}
          </div>
        )}
      </aside>
    </main>
  );
}
