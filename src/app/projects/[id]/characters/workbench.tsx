"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Character, Persona, Project, VoiceOption } from "@/lib/types";
import {
  createCharacter,
  createPersona,
  deleteCharacter,
  deletePersona,
  generatePersonaSheet,
  getVoiceOptions,
  setCharacterSystemVoice,
  updateCharacter,
  updatePersona,
  uploadCharacterVoice,
  uploadPersonaSheet,
} from "@/server/actions";
import { useAutoRefresh } from "@/components/use-auto-refresh";
import { useAct } from "@/components/use-act";
import { Avatar, Button, Field, Input, Mono, Placeholder, Section, Stamp, Textarea, cx } from "@/components/ui";

export function CharacterWorkbench({ project, initialId }: { project: Project; initialId: string | null }) {
  const [currentId, setCurrentId] = useState<string | null>(initialId ?? project.characters[0]?.id ?? null);
  const { act: start, pending } = useAct();
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (currentId && !project.characters.some((c) => c.id === currentId)) setCurrentId(project.characters[0]?.id ?? null);
    if (!currentId && project.characters[0]) setCurrentId(project.characters[0].id);
  }, [project.characters, currentId]);

  const current = project.characters.find((c) => c.id === currentId) ?? null;
  const busy = project.characters.some((c) => c.voice.status === "generating" || c.personas.some((p) => p.status === "generating"));
  useAutoRefresh(busy, 4000);

  return (
    <main className="mx-auto grid max-w-[1500px] grid-cols-[240px_1fr] gap-6 px-6 py-6">
      <aside className="self-start rounded-sm border border-line bg-panel">
        <header className="flex items-center justify-between border-b border-line px-3 py-2">
          <h3 className="font-serif text-[14px] font-bold tracking-wide">人物</h3>
          <Mono className="text-[10.5px] text-ink-3">{project.characters.length}</Mono>
        </header>
        <ul>
          {project.characters.map((c) => {
            const active = c.id === currentId;
            const ready = c.personas.filter((p) => p.sheetReady).length;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setCurrentId(c.id)}
                  className={cx("flex w-full items-center gap-3 border-l-2 px-3 py-2.5 text-left transition-colors", active ? "border-cinnabar bg-paper" : "border-transparent hover:bg-paper")}
                >
                  <Avatar name={c.name} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-serif text-[14px] font-bold">{c.name}</span>
                    <span className="block truncate text-[11px] text-ink-2">{c.role || "未填身份"}</span>
                  </span>
                  <Mono className="text-[10px] text-ink-3">
                    {ready}/{c.personas.length}
                  </Mono>
                </button>
              </li>
            );
          })}
          {project.characters.length === 0 && <li className="px-3 py-6 text-center text-[12px] text-ink-3">还没有人物</li>}
        </ul>
        <div className="border-t border-line p-2">
          {adding ? (
            <form
              className="flex gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  const id = await createCharacter(project.id, newName);
                  setCurrentId(id);
                  setNewName("");
                  setAdding(false);
                });
              }}
            >
              <Input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="姓名" />
              <Button size="sm" variant="primary" type="submit" disabled={pending}>
                加
              </Button>
            </form>
          ) : (
            <Button className="w-full" size="sm" onClick={() => setAdding(true)}>
              ＋ 新增人物
            </Button>
          )}
        </div>
      </aside>

      {current ? <CharacterDetail key={current.id} projectId={project.id} character={current} /> : <Placeholder className="min-h-[400px]" label="EMPTY" hint="左侧新增一个人物" />}
    </main>
  );
}

/* ------------------------------------------------------------------ */

function CharacterDetail({ projectId, character: c }: { projectId: string; character: Character }) {
  const [form, setForm] = useState({ name: c.name, age: c.age, role: c.role, personality: c.personality, catchphrase: c.catchphrase, relations: c.relations });
  const { act: start, pending } = useAct();
  const dirty = useMemo(() => Object.entries(form).some(([k, v]) => v !== (c as unknown as Record<string, string>)[k]), [form, c]);
  const [addingPersona, setAddingPersona] = useState(false);
  const [newPersona, setNewPersona] = useState({ tag: "", description: "" });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="flex flex-col gap-6">
      <Section
        title="基础信息"
        aside={
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (confirm(`删除人物「${c.name}」及其全部人设？`)) start(() => deleteCharacter(projectId, c.id));
              }}
            >
              删除
            </Button>
            <Button size="sm" disabled={!dirty || pending} onClick={() => start(() => updateCharacter(projectId, c.id, form))}>
              保存
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-[1fr_1fr_2fr] gap-3">
          <Field label="姓名">
            <Input value={form.name} onChange={set("name")} />
          </Field>
          <Field label="年龄">
            <Input value={form.age} onChange={set("age")} />
          </Field>
          <Field label="身份">
            <Input value={form.role} onChange={set("role")} />
          </Field>
          <Field label="性格" className="col-span-2">
            <Textarea rows={2} value={form.personality} onChange={set("personality")} />
          </Field>
          <Field label="口头禅">
            <Input value={form.catchphrase} onChange={set("catchphrase")} />
          </Field>
          <Field label="人物关系" className="col-span-3">
            <Input value={form.relations} onChange={set("relations")} />
          </Field>
        </div>
      </Section>

      <Section
        title="人设"
        aside={
          <>
            <Mono className="text-[10.5px] text-ink-3">gpt-image-2 · 1536×1024 · 一张图</Mono>
            <Button size="sm" onClick={() => setAddingPersona(true)}>
              ＋ 新增人设
            </Button>
          </>
        }
      >
        {addingPersona && (
          <form
            className="mb-4 grid grid-cols-[140px_1fr_auto] items-end gap-2 rounded-sm border border-dashed border-line-strong bg-paper p-3"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                await createPersona(projectId, c.id, newPersona);
                setNewPersona({ tag: "", description: "" });
                setAddingPersona(false);
              });
            }}
          >
            <Field label="tag" hint="青年 / 老年 / 入魔">
              <Input autoFocus value={newPersona.tag} onChange={(e) => setNewPersona((p) => ({ ...p, tag: e.target.value }))} />
            </Field>
            <Field label="该人设下的外貌、服装、标志物">
              <Input value={newPersona.description} onChange={(e) => setNewPersona((p) => ({ ...p, description: e.target.value }))} />
            </Field>
            <div className="flex gap-1">
              <Button size="sm" variant="primary" type="submit" disabled={pending}>
                添加
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAddingPersona(false)}>
                取消
              </Button>
            </div>
          </form>
        )}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {c.personas.map((p) => (
            <PersonaCard key={p.id} projectId={projectId} persona={p} />
          ))}
          {c.personas.length === 0 && !addingPersona && (
            <button type="button" onClick={() => setAddingPersona(true)} className="placeholder flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-sm text-ink-2 hover:text-cinnabar xl:col-span-2">
              <span className="font-serif text-[26px] leading-none">＋</span>
              <span className="text-[12px] tracking-wider">新增人设</span>
              <span className="text-[11px] text-ink-3">同一人物的不同阶段或状态，用 tag 区分</span>
            </button>
          )}
        </div>
      </Section>

      <VoiceSection projectId={projectId} character={c} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function PersonaCard({ projectId, persona: p }: { projectId: string; persona: Persona }) {
  const [tag, setTag] = useState(p.tag);
  const [description, setDescription] = useState(p.description);
  const [prompt, setPrompt] = useState(p.prompt);
  const { act: start, pending } = useAct();
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = tag !== p.tag || description !== p.description || prompt !== p.prompt;
  const generating = p.status === "generating";

  return (
    <article className="rounded-sm border border-line bg-paper">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <div className="flex items-center gap-2">
          <Stamp tone="cinnabar">{p.tag}</Stamp>
          <Mono className="text-[10px] text-ink-3">{p.id.slice(-6)}</Mono>
        </div>
        {generating ? <Stamp tone="indigo">生成中</Stamp> : p.status === "failed" ? <Stamp tone="cinnabar">失败</Stamp> : p.sheetReady ? <Stamp tone="moss">SHEET OK</Stamp> : <Stamp tone="amber">未生成</Stamp>}
      </div>
      <div className="p-3">
        {p.sheetUrl ? (
          <a href={p.sheetUrl} target="_blank" rel="noreferrer" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.sheetUrl} alt={`${p.tag} 三视图`} className={cx("aspect-[3/2] w-full border border-line object-cover", generating && "opacity-50")} />
          </a>
        ) : (
          <Placeholder ratio="3/2" label={generating ? "gpt-image-2 生成中 · 约 40 秒" : "尚未生成三视图"} hint={generating ? undefined : "填写描述后点「生成三视图」"} />
        )}
        {generating && <div className="tape mt-2" />}
        {p.status === "failed" && p.error && <p className="mt-2 break-all font-mono text-[10.5px] text-cinnabar">{p.error}</p>}

        <div className="mt-3 grid grid-cols-[120px_1fr] gap-2">
          <Field label="tag">
            <Input value={tag} onChange={(e) => setTag(e.target.value)} />
          </Field>
          <Field label="外貌描述">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        <details className="group mt-2">
          <summary className="cursor-pointer select-none text-[11.5px] tracking-wider text-ink-2 hover:text-ink">生成提示词{prompt ? "" : "（留空则自动拼接）"}</summary>
          <Textarea className="mt-2" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="留空：画风前缀 + 人物描述 + 三视图要求 自动拼接。生成后会把实际用的提示词回填到这里。" />
        </details>
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" variant={p.sheetReady ? "outline" : "primary"} disabled={generating || pending} onClick={() => start(() => generatePersonaSheet(projectId, p.id))}>
            {generating ? "生成中…" : p.sheetReady ? "重新生成" : "生成三视图"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
            上传替换
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const fd = new FormData();
              fd.set("file", f);
              start(() => uploadPersonaSheet(projectId, p.id, fd));
              e.target.value = "";
            }}
          />
          <span className="flex-1" />
          {dirty && (
            <Button size="sm" disabled={pending} onClick={() => start(() => updatePersona(projectId, p.id, { tag, description, prompt }))}>
              保存
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (confirm(`删除人设「${p.tag}」？`)) start(() => deletePersona(projectId, p.id));
            }}
          >
            删除
          </Button>
        </div>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */

function VoiceSection({ projectId, character: c }: { projectId: string; character: Character }) {
  const { act: start, pending } = useAct();
  const [options, setOptions] = useState<VoiceOption[] | null>(null);
  const [optError, setOptError] = useState("");
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const v = c.voice;

  useEffect(() => {
    if (!picking || options) return;
    getVoiceOptions().then((r) => {
      if (Array.isArray(r)) setOptions(r);
      else setOptError(r.error);
    });
  }, [picking, options]);

  const filtered = useMemo(() => (options ?? []).filter((o) => !q || o.name.includes(q) || o.voiceId.includes(q)).slice(0, 60), [options, q]);

  return (
    <Section title="声音" aside={<Mono className="text-[10.5px] text-ink-3">作为视频模型的参考音频（全能参考模式）</Mono>}>
      <div className="grid grid-cols-2 gap-4">
        <div className={cx("rounded-sm border p-3", v.source === "upload" ? "border-cinnabar bg-paper" : "border-line")}>
          <div className="font-serif text-[13.5px] font-bold">上传参考音频</div>
          <p className="mt-1 text-[11.5px] text-ink-2">10–15 秒清晰人声，wav 或 mp3，≤ 15 MB。</p>
          <button type="button" onClick={() => fileRef.current?.click()} className="placeholder mt-3 flex h-12 w-full items-center justify-center rounded-sm font-mono text-[10.5px] text-ink-2 hover:text-cinnabar">
            {v.source === "upload" ? v.label : "点击上传"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const fd = new FormData();
              fd.set("file", f);
              start(() => uploadCharacterVoice(projectId, c.id, fd));
              e.target.value = "";
            }}
          />
        </div>
        <div className={cx("rounded-sm border p-3", v.source === "minimax_system" ? "border-cinnabar bg-paper" : "border-line")}>
          <div className="font-serif text-[13.5px] font-bold">MiniMax 音色库</div>
          <p className="mt-1 text-[11.5px] text-ink-2">选定后后台用该音色合成一段 12 秒样本作为参考音频。</p>
          <div className="mt-3 flex items-center gap-2">
            <Input readOnly value={v.source === "minimax_system" ? v.label : "未选择"} />
            <Button size="sm" onClick={() => setPicking((x) => !x)}>
              {picking ? "收起" : "选音色"}
            </Button>
          </div>
          {picking && (
            <div className="mt-2 rounded-sm border border-line bg-panel">
              <div className="border-b border-line p-2">
                <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索音色名或 id，例如：青年、御姐、male" />
              </div>
              <ul className="max-h-56 overflow-y-auto">
                {optError && <li className="p-3 font-mono text-[11px] text-cinnabar">{optError}</li>}
                {!options && !optError && <li className="p-3 text-[12px] text-ink-3">加载音色列表…</li>}
                {filtered.map((o) => (
                  <li key={o.voiceId}>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          await setCharacterSystemVoice(projectId, c.id, o.voiceId, o.name);
                          setPicking(false);
                        })
                      }
                      className={cx("flex w-full items-center justify-between px-3 py-1.5 text-left text-[12.5px] hover:bg-paper", v.voiceId === o.voiceId && "text-cinnabar")}
                    >
                      <span>{o.name}</span>
                      <Mono className="text-[10px] text-ink-3">{o.voiceId}</Mono>
                    </button>
                  </li>
                ))}
                {options && filtered.length === 0 && <li className="p-3 text-[12px] text-ink-3">没有匹配的音色</li>}
              </ul>
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
        <div className="flex items-center gap-2">
          <Mono className="text-[10.5px] text-ink-3">SAMPLE</Mono>
          {v.status === "generating" ? <Stamp tone="indigo">合成中</Stamp> : v.status === "failed" ? <Stamp tone="cinnabar">失败</Stamp> : v.sampleReady ? <Stamp tone="moss">已就绪</Stamp> : <Stamp tone="amber">未设置</Stamp>}
          {v.status === "failed" && v.error && <span className="font-mono text-[10.5px] text-cinnabar">{v.error}</span>}
        </div>
        {v.sampleUrl && <audio controls preload="none" src={v.sampleUrl} className="h-8" />}
      </div>
    </Section>
  );
}
