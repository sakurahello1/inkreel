"use client";

import { useRef, useState } from "react";
import type { Project, Prop } from "@/lib/types";
import { createProp, deleteProp, generatePropSheet, updateProp, uploadPropSheet } from "@/server/actions";
import { useAct } from "@/components/use-act";
import { useAutoRefresh } from "@/components/use-auto-refresh";
import { Button, Field, Input, Mono, Placeholder, Section, Stamp, Textarea, cx } from "@/components/ui";

export function PropLibrary({ project }: { project: Project }) {
  const props = project.props ?? [];
  const { act, pending } = useAct();
  const [draft, setDraft] = useState({ name: "", description: "" });
  const busy = props.some((p) => p.status === "generating");
  useAutoRefresh(busy, 4000);

  // 每件道具被多少镜头用到
  const usage = new Map<string, number>();
  for (const ch of project.chapters) for (const s of ch.shots) for (const id of s.propIds ?? []) usage.set(id, (usage.get(id) ?? 0) + 1);

  return (
    <main className="mx-auto grid max-w-[1500px] grid-cols-[1fr_340px] gap-6 px-6 py-6">
      <Section title="道具库" aside={<Mono className="text-[10.5px] text-ink-3">{props.length} 件 · 概念图会作为首帧的参考</Mono>}>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {props.map((p) => (
            <PropCard key={p.id} projectId={project.id} prop={p} used={usage.get(p.id) ?? 0} />
          ))}
          {props.length === 0 && (
            <p className="col-span-full py-10 text-center text-[12.5px] text-ink-3">
              还没有道具。右侧添加，比如「未央剑」「竹杖」「红绳」，生成概念图后，拆镜时 Agent 会自动把它们排进镜头。
            </p>
          )}
        </div>
      </Section>

      <div className="flex flex-col gap-6">
        <Section title="添加道具">
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.name.trim()) return;
              act(async () => {
                await createProp(project.id, draft);
                setDraft({ name: "", description: "" });
              });
            }}
          >
            <Field label="名称">
              <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="例：未央剑" />
            </Field>
            <Field label="外观描述" hint="材质、形制、标志性细节">
              <Textarea rows={4} value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} placeholder="例：直身长剑，剑脊有一道贯穿的裂纹，护手是缠枝纹，剑穗暗红。" />
            </Field>
            <Button variant="primary" type="submit" disabled={pending || !draft.name.trim()}>
              加入道具库
            </Button>
          </form>
        </Section>
        <Section title="说明">
          <ul className="list-disc space-y-1.5 pl-4 text-[12px] leading-relaxed text-ink-2">
            <li>概念图只画物品本身、干净背景，方便当参考图用。</li>
            <li>同一件道具的不同状态（完好 / 断裂 / 染血）建议各建一件，名字带上状态。</li>
            <li>拆镜时 Agent 会为每个镜头列出出场道具；分镜页可逐镜增删。</li>
            <li>生成单镜首帧时，出场道具的概念图会一并作为参考图送进去。</li>
          </ul>
        </Section>
      </div>
    </main>
  );
}

function PropCard({ projectId, prop: p, used }: { projectId: string; prop: Prop; used: number }) {
  const { act, pending } = useAct();
  const [form, setForm] = useState({ name: p.name, description: p.description, prompt: p.prompt });
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = form.name !== p.name || form.description !== p.description || form.prompt !== p.prompt;
  const generating = p.status === "generating";

  return (
    <article className="rounded-sm border border-line bg-paper">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="font-serif text-[14px] font-bold tracking-wide">{p.name}</span>
        <div className="flex items-center gap-2">
          <Mono className="text-[10px] text-ink-3">{used} 镜在用</Mono>
          {generating ? <Stamp tone="indigo">生成中</Stamp> : p.status === "failed" ? <Stamp tone="cinnabar">失败</Stamp> : p.sheetUrl ? <Stamp tone="moss">OK</Stamp> : <Stamp tone="amber">未生成</Stamp>}
        </div>
      </div>
      <div className="p-3">
        {p.sheetUrl ? (
          <a href={p.sheetUrl} target="_blank" rel="noreferrer" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.sheetUrl} alt={p.name} className={cx("aspect-square w-full border border-line object-contain", generating && "opacity-50")} />
          </a>
        ) : (
          <Placeholder ratio="1/1" label={generating ? "gpt-image-2 生成中" : "尚未生成概念图"} hint={generating ? undefined : "填写描述后点「生成概念图」"} />
        )}
        {generating && <div className="tape mt-2" />}
        {p.status === "failed" && p.error && <p className="mt-2 break-all font-mono text-[10.5px] text-cinnabar">{p.error}</p>}

        <div className="mt-3 flex flex-col gap-2">
          <Field label="名称">
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="外观描述">
            <Textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
        </div>
        <details className="group mt-2">
          <summary className="cursor-pointer select-none text-[11.5px] tracking-wider text-ink-2 hover:text-ink">生成提示词{form.prompt ? "" : "（留空则自动拼接）"}</summary>
          <Textarea className="mt-2" rows={4} value={form.prompt} onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))} placeholder="留空：画风前缀 + 名称描述 + 单体干净背景 自动拼接。生成后会回填实际用的提示词。" />
        </details>
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" variant={p.sheetUrl ? "outline" : "primary"} disabled={generating || pending} onClick={() => act(() => generatePropSheet(projectId, p.id))}>
            {generating ? "生成中…" : p.sheetUrl ? "重新生成" : "生成概念图"}
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
              act(() => uploadPropSheet(projectId, p.id, fd));
              e.target.value = "";
            }}
          />
          <span className="flex-1" />
          {dirty && (
            <Button size="sm" variant="primary" disabled={pending} onClick={() => act(() => updateProp(projectId, p.id, form))}>
              保存
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (confirm(`删除道具「${p.name}」？${used ? `有 ${used} 个镜头在用。` : ""}`)) act(() => deleteProp(projectId, p.id));
            }}
          >
            删除
          </Button>
        </div>
      </div>
    </article>
  );
}
