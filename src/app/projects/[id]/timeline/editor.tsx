"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Chapter, Project, Shot } from "@/lib/types";
import { formatTimecode } from "@/lib/status";
import Link from "next/link";
import { alignChapterSubtitles, exportChapter, moveClip, updateChapterTimeline, updateClip } from "@/server/actions";
import { useAct } from "@/components/use-act";
import { useAutoRefresh } from "@/components/use-auto-refresh";
import { Avatar, Button, Input, Mono, Placeholder, Section, Stamp, StatusStamp, Textarea, cx } from "@/components/ui";

function clipLen(s: Shot) {
  const dur = s.videoDuration ?? s.duration;
  const start = Math.min(Math.max(0, s.clip?.in ?? 0), Math.max(0, dur - 0.2));
  const end = s.clip?.out && s.clip.out > start + 0.2 ? Math.min(s.clip.out, dur) : dur;
  return Math.max(0, end - start);
}

export function TimelineEditor({ project, chapter }: { project: Project; chapter: Chapter }) {
  const tl = chapter.timeline!;
  const { act, pending } = useAct();
  const [volume, setVolume] = useState(tl.bgmVolume);
  useAutoRefresh(tl.exportStatus === "running", 4000);

  const clips = useMemo(
    () =>
      chapter.shots
        .filter((s) => s.videoUrl)
        .sort((a, b) => (a.clip?.order ?? a.index) - (b.clip?.order ?? b.index)),
    [chapter.shots],
  );
  const enabled = clips.filter((c) => c.clip?.enabled !== false);
  const total = enabled.reduce((a, s) => a + clipLen(s), 0);
  // BGM 连续段落（与导出逻辑一致）：相邻同曲接着播，换曲从头开始
  const bgmRuns: Array<{ name: string; start: number; len: number; clips: number }> = [];
  {
    let at = 0;
    for (const s of enabled) {
      const len = clipLen(s);
      const last = bgmRuns[bgmRuns.length - 1];
      if (s.bgmTrackId) {
        if (last && last.name === s.bgmTrackName && at === last.start + last.len) {
          last.len += len;
          last.clips += 1;
        } else bgmRuns.push({ name: s.bgmTrackName ?? "?", start: at, len, clips: 1 });
      }
      at += len;
    }
  }
  const pxPerSec = 28;
  const width = Math.max(total, 30) * pxPerSec;

  return (
    <div className="grid grid-cols-[1fr_340px] gap-6">
      <div className="flex flex-col gap-6">
        <Section
          title={`第 ${chapter.index} 章 · ${chapter.title}`}
          aside={
            <>
              <Mono className="text-[10.5px] text-ink-3">
                {enabled.length} 段 · {formatTimecode(Math.round(total))}
              </Mono>
              <label className="flex items-center gap-1.5 text-[12px] text-ink-2">
                <input type="checkbox" className="accent-cinnabar" checked={tl.subtitles} onChange={(e) => act(() => updateChapterTimeline(project.id, chapter.id, { subtitles: e.target.checked }))} />
                烧录字幕
              </label>
            </>
          }
        >
          <div className="overflow-x-auto pb-2">
            <div className="relative h-5 border-b border-line" style={{ width }}>
              {Array.from({ length: Math.ceil(Math.max(total, 30)) + 1 }).map((_, s) =>
                s % 5 === 0 ? (
                  <span key={s} className="absolute top-0 font-mono text-[9.5px] text-ink-3" style={{ left: s * pxPerSec }}>
                    {formatTimecode(s)}
                  </span>
                ) : null,
              )}
            </div>
            <div className="mt-2 flex h-20 items-stretch gap-[2px]" style={{ width }}>
              {enabled.map((s) => (
                <div key={s.id} className={cx("relative overflow-hidden border border-line-strong bg-paper-deep", s.status === "video_ready" && "border-dashed")} style={{ width: Math.max(24, clipLen(s) * pxPerSec - 2) }}>
                  {s.frameUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.frameUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />
                  )}
                  <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-paper/80 px-1.5 py-0.5 font-mono text-[9.5px]">
                    <span>#{String(s.index).padStart(2, "0")}</span>
                    <span className="text-ink-3">{clipLen(s).toFixed(1)}s</span>
                  </div>
                  <div className="absolute inset-x-1.5 bottom-1 truncate bg-paper/80 text-[10.5px] text-ink-2">{s.action}</div>
                </div>
              ))}
              {enabled.length === 0 && <Placeholder className="w-full" label="暂无已生成视频的镜头" hint="分镜页生成视频后会自动出现在这里" />}
            </div>
            <div className="mt-[2px] flex h-6 items-center border border-dashed border-line px-1.5 font-mono text-[9.5px] text-ink-3" style={{ width }}>
              SUBTITLE · {tl.subtitles ? "台词自动生成，可在下方逐段覆盖" : "关闭"}
            </div>
            <div className="relative mt-[2px] h-6 border border-dashed border-line" style={{ width }}>
              {bgmRuns.map((r, i) => (
                <div key={i} className="absolute top-0 flex h-full items-center overflow-hidden border-r border-line bg-indigo-wash px-1.5 font-mono text-[9.5px] text-indigo" style={{ left: r.start * pxPerSec, width: Math.max(20, r.len * pxPerSec) }} title={`${r.name} · ${r.clips} 镜连续 · ${r.len.toFixed(1)}s`}>
                  ♪ {r.name}
                  {r.clips > 1 ? ` ×${r.clips}` : ""}
                </div>
              ))}
              {bgmRuns.length === 0 && <span className="px-1.5 font-mono text-[9.5px] leading-6 text-ink-3">BGM · 未给镜头指定</span>}
            </div>
          </div>
        </Section>

        <Section title="片段" aside={<Mono className="text-[10.5px] text-ink-3">入点 / 出点 单位秒 · 留空出点 = 到结尾</Mono>}>
          <div className="flex flex-col gap-3">
            {clips.map((s, i) => (
              <ClipRow key={s.id} shot={s} project={project} chapter={chapter} first={i === 0} last={i === clips.length - 1} />
            ))}
            {clips.length === 0 && <p className="py-6 text-center text-[12.5px] text-ink-3">这一章还没有生成视频的镜头。</p>}
          </div>
        </Section>
      </div>

      <div className="flex flex-col gap-6">
        <Section title="BGM" aside={<Link href={`/projects/${project.id}/music`} className="text-[11.5px] text-cinnabar hover:underline">音乐库</Link>}>
          {bgmRuns.length ? (
            <ul className="flex flex-col gap-1.5 font-mono text-[11px]">
              {bgmRuns.map((r, i) => (
                <li key={i} className="flex items-center justify-between border-b border-dashed border-line pb-1 last:border-0">
                  <span className="text-ink">♪ {r.name}</span>
                  <span className="text-ink-3">
                    {formatTimecode(Math.round(r.start))} 起 · {r.clips} 镜 · {r.len.toFixed(1)}s
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-ink-2">还没有镜头指定 BGM。到分镜页逐镜或批量指定，拆镜时 Agent 也会按情绪自动选曲。</p>
          )}
          <label className="mt-3 block border-t border-line pt-3">
            <div className="mb-1 flex items-baseline justify-between text-[11.5px] text-ink-2">
              <span>整章 BGM 总倍率</span>
              <Mono className="text-[10px] text-ink-3">×{volume.toFixed(2)}</Mono>
            </div>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              onMouseUp={() => act(() => updateChapterTimeline(project.id, chapter.id, { bgmVolume: volume }))}
              onTouchEnd={() => act(() => updateChapterTimeline(project.id, chapter.id, { bgmVolume: volume }))}
              className="w-full accent-cinnabar"
            />
            <p className="mt-1 text-[10.5px] text-ink-3">每首曲子的基础音量在音乐库里调，这里整体放大或压低。</p>
          </label>
        </Section>

        <Section title="导出">
          {tl.exportUrl && tl.exportStatus !== "running" ? (
            <video controls src={tl.exportUrl} className={cx("w-full border border-line bg-black", project.orientation === "16:9" ? "aspect-video" : "aspect-[9/16]")} />
          ) : (
            <Placeholder ratio={project.orientation === "16:9" ? "16/9" : "9/16"} label={tl.exportStatus === "running" ? "ffmpeg 合成中" : "尚未导出"} />
          )}
          {tl.exportStatus === "running" && (
            <div className="mt-2">
              <div className="tape" />
              <Mono className="mt-1 block text-[10px] text-indigo">拼接 · 字幕 · 混音 · 编码，通常 1–3 分钟</Mono>
            </div>
          )}
          {tl.exportStatus === "failed" && <p className="mt-2 break-all rounded-sm border border-cinnabar/40 bg-cinnabar-wash px-2 py-1.5 font-mono text-[10.5px] text-cinnabar">{tl.exportError}</p>}
          <dl className="mt-3 grid grid-cols-2 gap-y-1.5 font-mono text-[11.5px]">
            <dt className="text-ink-3">格式</dt>
            <dd>MP4 · H.264 · AAC</dd>
            <dt className="text-ink-3">分辨率</dt>
            <dd>{project.orientation === "16:9" ? "1920×1080" : "1080×1920"}</dd>
            <dt className="text-ink-3">帧率</dt>
            <dd>24 fps</dd>
            <dt className="text-ink-3">时长</dt>
            <dd>{formatTimecode(Math.round(tl.exportDuration ?? total))}</dd>
          </dl>
          <div className="mt-4 flex flex-col gap-2">
            <Button
              className="w-full"
              disabled={pending || enabled.length === 0}
              title="用 Whisper 的字级时间戳把每镜台词对到真正说话的时间上；成片没换的镜头会跳过"
              onClick={() =>
                act(async () => {
                  const r = await alignChapterSubtitles(project.id, chapter.id);
                  const bad = r.filter((x) => x.similarity >= 0 && x.similarity < 0.6);
                  alert(`已对齐 ${r.length} 镜${bad.length ? `\n\n疑似念错 / 没念（相似度 < 0.6）：\n${bad.map((x) => `#${String(x.index).padStart(2, "0")} 听到：${x.heard || "（无人声）"}`).join("\n")}` : ""}`);
                })
              }
            >
              对齐字幕
            </Button>
            <Button variant="primary" className="w-full" disabled={pending || tl.exportStatus === "running" || enabled.length === 0} onClick={() => act(() => exportChapter(project.id, chapter.id))}>
              {tl.exportStatus === "running" ? "合成中…" : tl.exportUrl ? "重新导出" : "导出成片"}
            </Button>
            {tl.exportUrl && tl.exportStatus === "ready" && (
              <a href={tl.exportUrl} download={`${project.title}-第${chapter.index}章.mp4`} className="inline-flex h-8 items-center justify-center rounded-sm border border-line-strong bg-panel text-[13px] hover:bg-paper-deep">
                下载 mp4
              </a>
            )}
          </div>
          {enabled.some((s) => s.status === "video_ready") && <p className="mt-3 text-[11px] text-amber">含未验收的镜头（虚线边框），导出不受影响，但建议先验收。</p>}
        </Section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ClipRow({ shot: s, project, chapter, first, last }: { shot: Shot; project: Project; chapter: Chapter; first: boolean; last: boolean }) {
  const { act, pending } = useAct();
  const c = s.clip!;
  const [form, setForm] = useState({ in: String(c.in || ""), out: c.out ? String(c.out) : "", fadeIn: String(c.fadeIn || ""), fadeOut: String(c.fadeOut || ""), subtitle: c.subtitle });
  const snap = JSON.stringify({ in: String(c.in || ""), out: c.out ? String(c.out) : "", fadeIn: String(c.fadeIn || ""), fadeOut: String(c.fadeOut || ""), subtitle: c.subtitle });
  const last_ = useRef(snap);
  useEffect(() => {
    if (snap !== last_.current) {
      last_.current = snap;
      setForm(JSON.parse(snap));
    }
  }, [snap]);
  const dirty = JSON.stringify(form) !== snap;
  const dialogueText = s.dialogue.map((d) => d.line).join("\n");
  const dur = s.videoDuration ?? s.duration;

  return (
    <div className={cx("grid grid-cols-[44px_96px_1fr] gap-3 rounded-sm border border-line bg-paper p-3", c.enabled === false && "opacity-50")}>
      <div className="flex flex-col items-center gap-1">
        <button type="button" disabled={first || pending} onClick={() => act(() => moveClip(project.id, chapter.id, s.id, -1))} className="h-6 w-6 rounded-sm border border-line text-[11px] hover:border-line-strong disabled:opacity-30">
          ↑
        </button>
        <Mono className="text-[11px]">#{String(s.index).padStart(2, "0")}</Mono>
        <button type="button" disabled={last || pending} onClick={() => act(() => moveClip(project.id, chapter.id, s.id, 1))} className="h-6 w-6 rounded-sm border border-line text-[11px] hover:border-line-strong disabled:opacity-30">
          ↓
        </button>
      </div>
      <div>
        {s.frameUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.frameUrl} alt="" className="aspect-[9/16] w-full border border-line object-cover" />
        ) : (
          <Placeholder ratio="9/16" label="无首帧" />
        )}
      </div>
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {s.characters.map((ch) => (
              <Avatar key={ch.characterId} name={project.characters.find((x) => x.id === ch.characterId)?.name ?? "?"} tag={ch.personaTag} size={20} />
            ))}
            <span className="truncate text-[12.5px] text-ink-2">{s.action}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusStamp status={s.status} withLabel={false} />
            <label className="flex items-center gap-1 text-[11.5px] text-ink-2">
              <input type="checkbox" className="accent-cinnabar" checked={c.enabled !== false} onChange={(e) => act(() => updateClip(project.id, chapter.id, s.id, { clipEnabled: e.target.checked }))} />
              启用
            </label>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-[1fr_1fr_1fr_1fr_auto] items-end gap-2">
          <label className="block">
            <span className="text-[10.5px] tracking-wider text-ink-3">入点</span>
            <Input value={form.in} placeholder="0" onChange={(e) => setForm((f) => ({ ...f, in: e.target.value }))} />
          </label>
          <label className="block">
            <span className="text-[10.5px] tracking-wider text-ink-3">出点</span>
            <Input value={form.out} placeholder={dur.toFixed(1)} onChange={(e) => setForm((f) => ({ ...f, out: e.target.value }))} />
          </label>
          <label className="block">
            <span className="text-[10.5px] tracking-wider text-ink-3">淡入</span>
            <Input value={form.fadeIn} placeholder="0" onChange={(e) => setForm((f) => ({ ...f, fadeIn: e.target.value }))} />
          </label>
          <label className="block">
            <span className="text-[10.5px] tracking-wider text-ink-3">淡出</span>
            <Input value={form.fadeOut} placeholder="0" onChange={(e) => setForm((f) => ({ ...f, fadeOut: e.target.value }))} />
          </label>
          <Mono className="pb-2 text-[10.5px] text-ink-3">
            源 {dur.toFixed(1)}s → 用 {clipLen({ ...s, clip: { ...c, in: Number(form.in) || 0, out: Number(form.out) || null } }).toFixed(1)}s
          </Mono>
        </div>
        <div className="mt-2">
          <span className="text-[10.5px] tracking-wider text-ink-3">字幕（留空则用台词）</span>
          <Textarea rows={2} value={form.subtitle} placeholder={dialogueText || "本镜无台词"} onChange={(e) => setForm((f) => ({ ...f, subtitle: e.target.value }))} />
        </div>
        {dirty && (
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setForm(JSON.parse(snap))}>
              还原
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={pending}
              onClick={() =>
                act(() =>
                  updateClip(project.id, chapter.id, s.id, {
                    clipIn: Math.max(0, Number(form.in) || 0),
                    clipOut: form.out.trim() ? Math.max(0, Number(form.out) || 0) : null,
                    fadeIn: Math.max(0, Number(form.fadeIn) || 0),
                    fadeOut: Math.max(0, Number(form.fadeOut) || 0),
                    clipSubtitle: form.subtitle,
                  }),
                )
              }
            >
              保存
            </Button>
          </div>
        )}
        {s.status === "video_ready" && <Stamp tone="amber" className="mt-2">未验收</Stamp>}
      </div>
    </div>
  );
}
