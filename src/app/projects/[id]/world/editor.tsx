"use client";

import { useRef, useState } from "react";
import { useAct } from "@/components/use-act";
import type { Project } from "@/lib/types";
import { addStyleRef, removeStyleRef, updateProjectBasics, updateProjectWorld } from "@/server/actions";
import { Button, Field, Input, Mono, Placeholder, Section, Textarea } from "@/components/ui";

export function WorldEditor({ project }: { project: Project }) {
  const [world, setWorld] = useState(project.world);
  const [style, setStyle] = useState(project.style);
  const [title, setTitle] = useState(project.title);
  const [genre, setGenre] = useState(project.genre.join("，"));
  const [orientation, setOrientation] = useState(project.orientation);
  const [episodes, setEpisodes] = useState(String(project.targetEpisodes));
  const { act: start, pending } = useAct();
  const fileRef = useRef<HTMLInputElement>(null);
  const refs = project.styleRefItems ?? [];

  return (
    <main className="mx-auto grid max-w-[1500px] grid-cols-1 gap-6 px-6 py-6 lg:grid-cols-[1fr_1fr_360px]">
      <Section title="世界观" aside={<Mono className="text-[10.5px] text-ink-3">拆镜与生图时作为背景知识注入</Mono>}>
        <Textarea rows={16} value={world} onChange={(e) => setWorld(e.target.value)} placeholder="时代、地理、规则、禁忌、势力关系……写给 Agent 看的，越具体越好。" />
        <div className="mt-3 flex items-center justify-between">
          <Mono className="text-[10.5px] text-ink-3">{world.length} 字</Mono>
          <Button size="sm" disabled={pending || world === project.world} onClick={() => start(() => updateProjectWorld(project.id, { world }))}>
            保存
          </Button>
        </div>
      </Section>

      <Section title="画风" aside={<Mono className="text-[10.5px] text-ink-3">作为所有生图提示词的前缀</Mono>}>
        <Textarea rows={9} value={style} onChange={(e) => setStyle(e.target.value)} placeholder="媒介、线条、设色、光线、镜头语言偏好……" />
        <div className="mt-4">
          <Field label="画风参考图" hint={`${refs.length}/4 · 生三视图与首帧时一并作为参考`}>
            <div className="grid grid-cols-4 gap-2">
              {refs.map((r, i) => (
                <div key={r.id} className="group relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.url} alt={`REF ${i + 1}`} className="aspect-square w-full border border-line object-cover" />
                  <button
                    type="button"
                    onClick={() => start(() => removeStyleRef(project.id, r.id))}
                    className="absolute right-1 top-1 hidden rounded-sm border border-line-strong bg-paper px-1.5 font-mono text-[10px] group-hover:block"
                  >
                    移除
                  </button>
                </div>
              ))}
              {refs.length < 4 && (
                <button type="button" onClick={() => fileRef.current?.click()} className="placeholder flex aspect-square flex-col items-center justify-center gap-1 rounded-sm text-ink-2 hover:text-cinnabar">
                  <span className="font-serif text-[22px] leading-none">＋</span>
                  <span className="text-[11px]">上传</span>
                </button>
              )}
            </div>
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
                start(() => addStyleRef(project.id, fd));
                e.target.value = "";
              }}
            />
          </Field>
        </div>
        <div className="mt-3 flex items-center justify-end">
          <Button size="sm" disabled={pending || style === project.style} onClick={() => start(() => updateProjectWorld(project.id, { style }))}>
            保存
          </Button>
        </div>
      </Section>

      <div className="flex flex-col gap-6">
        <Section title="基本信息">
          <div className="flex flex-col gap-3">
            <Field label="项目名">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="题材标签" hint="逗号分隔">
              <Input value={genre} onChange={(e) => setGenre(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="画幅">
                <select value={orientation} onChange={(e) => setOrientation(e.target.value as Project["orientation"])} className="w-full rounded-sm border border-line bg-panel px-2 py-1.5 text-[13px]">
                  <option value="9:16">9:16 竖屏</option>
                  <option value="16:9">16:9 横屏</option>
                </select>
              </Field>
              <Field label="目标集数">
                <Input value={episodes} onChange={(e) => setEpisodes(e.target.value)} />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={pending}
                onClick={() => start(() => updateProjectBasics(project.id, { title, genre, orientation, targetEpisodes: Number(episodes) || project.targetEpisodes }))}
              >
                保存
              </Button>
            </div>
          </div>
        </Section>

        <Section title="提示词预览" aside={<Mono className="text-[10.5px] text-ink-3">自动拼接</Mono>}>
          <p className="text-[12.5px] leading-relaxed text-ink-2">
            <span className="text-ink">[画风]</span> {style.slice(0, 60) || "（空）"}
            {style.length > 60 ? "…" : ""}
            <br />
            <span className="text-ink">[世界观]</span> {world.slice(0, 60) || "（空）"}
            {world.length > 60 ? "…" : ""}
            <br />
            <span className="text-ink">[画风参考图]</span> ×{refs.length}
          </p>
          <p className="mt-3 border-t border-line pt-3 text-[11.5px] text-ink-3">三视图与首帧的提示词最前面会带上画风；拆镜 Agent 会同时读到世界观与画风。</p>
        </Section>
      </div>
    </main>
  );
}
