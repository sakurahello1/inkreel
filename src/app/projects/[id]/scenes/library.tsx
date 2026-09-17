"use client";

import { useRef, useState } from "react";
import type { Project, Scene } from "@/lib/types";
import { createScene, deleteScene, generateSceneSheet, updateScene, uploadSceneSheet } from "@/server/actions";
import { useAct } from "@/components/use-act";
import { useAutoRefresh } from "@/components/use-auto-refresh";
import { Button, Field, Input, Mono, Placeholder, Section, Stamp, Textarea, cx } from "@/components/ui";

export function SceneLibrary({ project }: { project: Project }) {
  const scenes = project.scenes ?? [];
  const { act, pending } = useAct();
  const [draft, setDraft] = useState({ name: "", description: "" });
  const busy = scenes.some((s) => s.status === "generating");
  useAutoRefresh(busy, 4000);

  // 每个场景被多少镜头挂着
  const usage = new Map<string, number>();
  for (const ch of project.chapters) for (const s of ch.shots) if (s.sceneId) usage.set(s.sceneId, (usage.get(s.sceneId) ?? 0) + 1);
  const unassigned = project.chapters.reduce((a, ch) => a + ch.shots.filter((s) => !s.sceneId).length, 0);

  return (
    <main className="mx-auto grid max-w-[1500px] grid-cols-[1fr_340px] gap-6 px-6 py-6">
      <Section
        title="场景库"
        aside={
          <Mono className="text-[10.5px] text-ink-3">
            {scenes.length} 处 · 空间基准图会作为首帧的参考
            {unassigned > 0 && <span className="ml-2 text-cinnabar">{unassigned} 镜未挂场景</span>}
          </Mono>
        }
      >
        <div className="grid grid-cols-1 gap-4">
          {scenes.map((s) => (
            <SceneCard key={s.id} projectId={project.id} scene={s} used={usage.get(s.id) ?? 0} />
          ))}
          {scenes.length === 0 && (
            <p className="col-span-full py-10 text-center text-[12.5px] text-ink-3">
              还没有场景。一部戏通常只有三五个实景反复出现，把它们建出来并生成空间基准图，之后每一镜的首帧都会锚在同一个空间里。
            </p>
          )}
        </div>
      </Section>

      <div className="flex flex-col gap-6">
        <Section title="添加场景">
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.name.trim()) return;
              act(async () => {
                await createScene(project.id, draft);
                setDraft({ name: "", description: "" });
              });
            }}
          >
            <Field label="名称">
              <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="例：高三四班教室" />
            </Field>
            <Field label="空间描述" hint="布局、家具、门窗朝向、材质、年代细节">
              <Textarea
                rows={5}
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="例：南方县城中学老教室，水磨石地面，六排木质课桌椅，左侧一整排结霜的木框玻璃窗，正前方绿色黑板与讲台，后墙贴高考倒计时，天花板两台吊扇与两排日光灯管。"
              />
            </Field>
            <Button variant="primary" type="submit" disabled={pending || !draft.name.trim()}>
              加入场景库
            </Button>
          </form>
        </Section>
        <Section title="说明">
          <ul className="list-disc space-y-1.5 pl-4 text-[12px] leading-relaxed text-ink-2">
            <li>基准图一张里画两格：同一空间的主视角与正对面反打回来的视角。短剧几乎每场都在正反打之间切，只给一个方向，模型就得自己发明人物背后是什么。</li>
            <li>基准图只定「这是哪儿」——房间形状、陈设排布、门窗朝向、材质年代。不定「这一刻长什么样」，机位、景别、时间与光线仍由每一镜自己决定。</li>
            <li>同一个地点如果跨越很不一样的时空（十年前 / 十年后、白天 / 深夜），建议各建一处，名字带上时段。</li>
            <li>在分镜页给每一镜挂上所属场景；没挂的镜头会退回到只靠文字描述，跨镜头的空间就不保证一致。</li>
          </ul>
        </Section>
      </div>
    </main>
  );
}

function SceneCard({ projectId, scene: s, used }: { projectId: string; scene: Scene; used: number }) {
  const { act, pending } = useAct();
  const [form, setForm] = useState({ name: s.name, description: s.description, prompt: s.prompt });
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = form.name !== s.name || form.description !== s.description || form.prompt !== s.prompt;
  const generating = s.status === "generating";

  return (
    <article className="rounded-sm border border-line bg-paper">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="font-serif text-[14px] font-bold tracking-wide">{s.name}</span>
        <div className="flex items-center gap-2">
          <Mono className="text-[10px] text-ink-3">{used} 镜在用</Mono>
          {generating ? (
            <Stamp tone="indigo">生成中</Stamp>
          ) : s.status === "failed" ? (
            <Stamp tone="cinnabar">失败</Stamp>
          ) : s.sheetUrl ? (
            <Stamp tone="moss">OK</Stamp>
          ) : (
            <Stamp tone="amber">未生成</Stamp>
          )}
        </div>
      </div>
      <div className="p-3">
        {s.sheetUrl ? (
          <a href={s.sheetUrl} target="_blank" rel="noreferrer" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.sheetUrl} alt={s.name} className={cx("w-full border border-line object-contain", generating && "opacity-50")} />
          </a>
        ) : (
          <Placeholder ratio="2/1" label={generating ? "gpt-image-2 生成中" : "尚未生成空间基准图"} hint={generating ? undefined : "填写空间描述后点「生成基准图」"} />
        )}
        {generating && <div className="tape mt-2" />}
        {s.status === "failed" && s.error && <p className="mt-2 break-all font-mono text-[10.5px] text-cinnabar">{s.error}</p>}

        <div className="mt-3 flex flex-col gap-2">
          <Field label="名称">
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="空间描述">
            <Textarea rows={4} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
        </div>
        <details className="group mt-2">
          <summary className="cursor-pointer select-none text-[11.5px] tracking-wider text-ink-2 hover:text-ink">
            生成提示词{form.prompt ? "" : "（留空则自动拼接）"}
          </summary>
          <Textarea
            className="mt-2"
            rows={4}
            value={form.prompt}
            onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
            placeholder="留空：画风前缀 + 名称描述 + 正反打两视角要求 自动拼接。写了就以你写的为准。"
          />
        </details>
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" variant={s.sheetUrl ? "outline" : "primary"} disabled={generating || pending} onClick={() => act(() => generateSceneSheet(projectId, s.id))}>
            {generating ? "生成中…" : s.sheetUrl ? "重新生成" : "生成基准图"}
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
              act(() => uploadSceneSheet(projectId, s.id, fd));
              e.target.value = "";
            }}
          />
          <span className="flex-1" />
          {dirty && (
            <Button size="sm" variant="primary" disabled={pending} onClick={() => act(() => updateScene(projectId, s.id, form))}>
              保存
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (confirm(`删除场景「${s.name}」？${used ? `有 ${used} 个镜头挂在它上面。` : ""}`)) act(() => deleteScene(projectId, s.id));
            }}
          >
            删除
          </Button>
        </div>
      </div>
    </article>
  );
}
