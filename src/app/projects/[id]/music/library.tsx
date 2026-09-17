"use client";

import { useRef, useState } from "react";
import type { BgmTrack, Project } from "@/lib/types";
import { addBgmTrack, deleteBgmTrack, updateBgmTrack } from "@/server/actions";
import { useAct } from "@/components/use-act";
import { Button, Field, Input, Mono, Section, Stamp, Textarea } from "@/components/ui";
import { formatTimecode } from "@/lib/status";

const MOOD_HINTS = ["抒情", "悲伤", "紧张", "悬疑", "对峙", "温暖", "回忆", "战斗", "日常", "空灵"];

export function MusicLibrary({ project }: { project: Project }) {
  const tracks = project.bgmTracks ?? [];
  const { act, pending } = useAct();
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<{ file: File | null; name: string; mood: string; description: string }>({ file: null, name: "", mood: "", description: "" });

  // 每首曲子被多少镜头引用
  const usage = new Map<string, number>();
  for (const ch of project.chapters) for (const s of ch.shots) if (s.bgmTrackId) usage.set(s.bgmTrackId, (usage.get(s.bgmTrackId) ?? 0) + 1);

  return (
    <main className="mx-auto grid max-w-[1500px] grid-cols-[1fr_360px] gap-6 px-6 py-6">
      <Section title="音乐库" aside={<Mono className="text-[10.5px] text-ink-3">{tracks.length} 首 · 拆镜时 Agent 按情绪标签选曲</Mono>}>
        <div className="flex flex-col gap-3">
          {tracks.map((t) => (
            <TrackRow key={t.id} projectId={project.id} track={t} used={usage.get(t.id) ?? 0} />
          ))}
          {tracks.length === 0 && (
            <p className="py-8 text-center text-[12.5px] text-ink-3">
              还没有曲子。右侧上传 mp3 / wav，写好情绪标签，之后拆镜时 Agent 会自动给每一镜配乐。
            </p>
          )}
        </div>
      </Section>

      <div className="flex flex-col gap-6">
        <Section title="添加曲子">
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.file) return;
              const fd = new FormData();
              fd.set("file", draft.file);
              fd.set("name", draft.name);
              fd.set("mood", draft.mood);
              fd.set("description", draft.description);
              act(async () => {
                await addBgmTrack(project.id, fd);
                setDraft({ file: null, name: "", mood: "", description: "" });
              });
            }}
          >
            <button type="button" onClick={() => fileRef.current?.click()} className="placeholder flex h-14 w-full items-center justify-center rounded-sm px-3 font-mono text-[11px] text-ink-2 hover:text-cinnabar">
              {draft.file ? `${draft.file.name} · ${(draft.file.size / 1024 / 1024).toFixed(1)} MB` : "选择 mp3 / wav"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setDraft((d) => ({ ...d, file: f, name: d.name || (f ? f.name.replace(/\.[a-z0-9]+$/i, "") : "") }));
                e.target.value = "";
              }}
            />
            <Field label="曲名">
              <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="例：雪夜·断桥" />
            </Field>
            <Field label="情绪标签" hint="逗号分隔，Agent 靠它选曲">
              <Input value={draft.mood} onChange={(e) => setDraft((d) => ({ ...d, mood: e.target.value }))} placeholder="抒情，悲伤" />
              <div className="mt-1.5 flex flex-wrap gap-1">
                {MOOD_HINTS.map((m) => (
                  <button key={m} type="button" onClick={() => setDraft((d) => ({ ...d, mood: d.mood ? (d.mood.includes(m) ? d.mood : `${d.mood}，${m}`) : m }))} className="rounded-sm border border-line bg-paper px-1.5 py-0.5 text-[11px] text-ink-2 hover:border-line-strong hover:text-ink">
                    {m}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="说明" hint="可选">
              <Textarea rows={2} value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} placeholder="适合什么场景、节奏快慢、有没有人声……" />
            </Field>
            <Button variant="primary" type="submit" disabled={pending || !draft.file}>
              加入音乐库
            </Button>
          </form>
        </Section>
        <Section title="规则">
          <ul className="list-disc space-y-1.5 pl-4 text-[12px] leading-relaxed text-ink-2">
            <li>拆镜时 Agent 会为每一镜选曲，同一情绪段落里相邻镜头沿用同一首。</li>
            <li>分镜页可逐镜改、批量改，改 BGM 不会影响审定状态。</li>
            <li>导出时相邻同曲镜头接着上一镜的位置继续播，换曲从头开始，段落首尾自动淡入淡出。</li>
            <li>曲子比段落短会自动循环。</li>
          </ul>
        </Section>
      </div>
    </main>
  );
}

function TrackRow({ projectId, track: t, used }: { projectId: string; track: BgmTrack; used: number }) {
  const { act, pending } = useAct();
  const [form, setForm] = useState({ name: t.name, mood: t.mood, description: t.description, volume: t.volume });
  const dirty = form.name !== t.name || form.mood !== t.mood || form.description !== t.description || form.volume !== t.volume;
  return (
    <div className="grid grid-cols-[1fr_300px] gap-4 rounded-sm border border-line bg-paper p-3">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-serif text-[15px] font-bold tracking-wide">{t.name}</span>
          {t.mood.split(/[,，]/).map((m) => m.trim()).filter(Boolean).map((m) => (
            <Stamp key={m} tone="indigo">
              {m}
            </Stamp>
          ))}
          <span className="flex-1" />
          <Mono className="text-[10px] text-ink-3">
            {t.duration ? formatTimecode(Math.round(t.duration)) : "--:--"} · {used} 镜在用
          </Mono>
        </div>
        <audio controls preload="none" src={t.url} className="mt-2 h-8 w-full" />
        <div className="mt-2 grid grid-cols-[1fr_1fr] gap-2">
          <Field label="曲名">
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="情绪标签">
            <Input value={form.mood} onChange={(e) => setForm((f) => ({ ...f, mood: e.target.value }))} />
          </Field>
          <Field label="说明" className="col-span-2">
            <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
        </div>
      </div>
      <div className="flex flex-col justify-between">
        <label className="block">
          <div className="mb-1 flex items-baseline justify-between text-[11.5px] text-ink-2">
            <span>混音音量</span>
            <Mono className="text-[10px] text-ink-3">{Math.round(form.volume * 100)}%</Mono>
          </div>
          <input type="range" min={0} max={1} step={0.05} value={form.volume} onChange={(e) => setForm((f) => ({ ...f, volume: Number(e.target.value) }))} className="w-full accent-cinnabar" />
        </label>
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (confirm(`删除「${t.name}」？${used ? `有 ${used} 个镜头在用，会被清空。` : ""}`)) act(() => deleteBgmTrack(projectId, t.id));
            }}
          >
            删除
          </Button>
          <Button size="sm" variant={dirty ? "primary" : "outline"} disabled={!dirty || pending} onClick={() => act(() => updateBgmTrack(projectId, t.id, form))}>
            保存
          </Button>
        </div>
      </div>
    </div>
  );
}
