"use client";

import { useEffect, useState } from "react";
import type { Chapter, Project, Shot } from "@/lib/types";
import { EMOTION_LABEL, TTS_EMOTIONS } from "@/lib/narrated";
import { generateChapterVoices, generateUtterance, getCastingStatus, renderPages, updateUtterance } from "@/server/actions";
import { useAct } from "@/components/use-act";
import { Button, Mono, Stamp, cx } from "@/components/ui";
import { Tape } from "./shared";

/**
 * 说书：这一页要念的每一条（旁白 / 台词）——配音状态、试听、语气语速、单条重配。
 * 底部「配音本页」受选角闸门约束：有角色没确认音色就不能点。
 */
export function UtterancesPanel({ shot, project, chapter }: { shot: Shot; project: Project; chapter: Chapter }) {
  const { act: run, pending } = useAct();
  const utts = shot.utterances ?? [];
  const [gate, setGate] = useState<{ ready: boolean; missing: string[] } | null>(null);
  useEffect(() => {
    getCastingStatus(project.id).then((s) => setGate({ ready: s.ready, missing: s.roles.filter((r) => !r.confirmed).map((r) => r.name) }));
  }, [project.id, shot.id]);

  const name = (id: string | null) => (id ? project.characters.find((c) => c.id === id)?.name ?? "?" : "旁白");
  const busy = utts.some((u) => u.status === "generating");
  const allReady = utts.length > 0 && utts.every((u) => u.status === "ready" && u.url);
  const total = utts.reduce((a, u) => a + (u.duration ?? 0), 0);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11.5px] tracking-wider text-ink-2">配音</span>
        <Mono className="text-[10px] text-ink-3">
          {utts.length} 条 · {utts.filter((u) => u.status === "ready").length} 已配{total ? ` · ${total.toFixed(1)}s` : ""} · $ {utts.reduce((a, u) => a + u.cost, 0).toFixed(3)}
        </Mono>
      </div>
      {gate && !gate.ready && (
        <div className="mb-2 border border-amber/40 bg-amber-wash px-2.5 py-1.5 text-[11px] text-amber">
          选角未完成：{gate.missing.join("、")} 还没确认音色。
          <a href={`/projects/${project.id}/casting`} className="ml-1 underline">去选角 →</a>
        </div>
      )}
      {utts.length === 0 && <p className="border border-dashed border-line px-2.5 py-3 text-center text-[11.5px] text-ink-3">这一页没有旁白也没有台词。左边编辑器里写了保存，就会出现在这里。</p>}
      <ol className="stagger flex flex-col gap-1.5">
        {utts.map((u, i) => (
          <li key={u.id} style={{ "--i": i } as React.CSSProperties} className={cx("border bg-panel px-2.5 py-2 transition-colors", u.status === "failed" ? "border-cinnabar/50" : u.status === "generating" ? "border-indigo/50" : "border-line")}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <Stamp tone={u.kind === "narration" ? "neutral" : "cinnabar"}>{u.kind === "narration" ? "旁白" : name(u.characterId)}</Stamp>
                  {u.tone && <Mono className="text-[10px] text-ink-3">{u.tone}</Mono>}
                  <Mono className="text-[10px] text-ink-3">{u.text.length} 字{u.duration ? ` · ${u.duration.toFixed(1)}s` : ""}</Mono>
                  {u.status === "generating" && <Mono className="text-[10px] text-indigo">配音中…</Mono>}
                  {u.status === "ready" && <Mono className="text-[10px] text-moss">✓</Mono>}
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-ink">{u.text}</p>
                {u.status === "failed" && <p className="mt-1 text-[10.5px] text-cinnabar">{u.error}</p>}
              </div>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              {u.url ? <audio controls preload="none" src={u.url} className="h-7 min-w-0 flex-1" /> : <div className="flex-1" />}
              <select
                value={u.emotion}
                disabled={pending}
                onChange={(e) => run(() => updateUtterance(project.id, chapter.id, u.id, { emotion: e.target.value }))}
                className="rounded-sm border border-line bg-paper px-1 py-0.5 font-mono text-[10px]"
                title="情绪（改了要重配）"
              >
                {TTS_EMOTIONS.map((e) => (
                  <option key={e} value={e}>
                    {EMOTION_LABEL[e]}
                  </option>
                ))}
              </select>
              <input
                type="number"
                step={0.05}
                min={0.5}
                max={2}
                defaultValue={u.speed}
                disabled={pending}
                onBlur={(e) => { const v = Number(e.target.value); if (v !== u.speed && v >= 0.5 && v <= 2) run(() => updateUtterance(project.id, chapter.id, u.id, { speed: v })); }}
                className="w-14 rounded-sm border border-line bg-paper px-1 py-0.5 font-mono text-[10px]"
                title="语速 0.5–2（改了要重配）"
              />
              <button
                disabled={pending || u.status === "generating" || !gate?.ready}
                onClick={() => run(() => generateUtterance(project.id, chapter.id, u.id))}
                className="border border-line px-1.5 py-0.5 font-mono text-[10px] hover:bg-panel disabled:opacity-40"
                title="只重配这一条"
              >
                {u.status === "ready" ? "重配" : "配音"}
              </button>
            </div>
          </li>
        ))}
      </ol>
      {busy && <Tape label="MiniMax TTS · 每条几秒 · 配齐自动渲染页视频" />}
      <div className="mt-3 flex gap-2">
        <Button className="flex-1" disabled={pending || busy || !utts.length || !gate?.ready} onClick={() => run(() => generateChapterVoices(project.id, chapter.id, { shotIds: [shot.id] }))}>
          配音本页
        </Button>
        <Button variant="primary" className="flex-1" disabled={pending || busy || !allReady || !shot.frameUrl} title={!shot.frameUrl ? "先出图" : !allReady ? "先配完音" : "图 + 配音 → 页视频"} onClick={() => run(() => renderPages(project.id, chapter.id, [shot.id]))}>
          渲染页视频
        </Button>
      </div>
    </div>
  );
}
