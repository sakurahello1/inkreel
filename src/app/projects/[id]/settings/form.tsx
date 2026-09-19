"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { IMAGE_QUALITY_OPTIONS, imagePrice, type Project } from "@/lib/types";
import { PRESENT_STYLES } from "@/lib/narrated";
import { updateNarratedSettings, updateVideoEngine } from "@/server/actions";
import { useAct } from "@/components/use-act";
import { Button, Field, Input, Mono, Section, cx } from "@/components/ui";

const ENGINES = [
  {
    id: "h3",
    label: "MiniMax H3",
    resolutions: ["768P", "1080P", "2K"],
    min: 4,
    max: 15,
    base: 0.0986,
    mult: { "768P": 1, "1080P": 2, "2K": 2, "4K": 2.6667 } as Record<string, number>,
    discount: true,
    note: "4–15 秒。首帧模式走首尾帧接口；直出模式可带人物三视图与声音样本。有时段折扣：0–9 点约三分之一价，18–22 点八折。平均出片约 3 分钟。",
  },
  {
    id: "omni",
    label: "Omni 1.1",
    resolutions: ["720P", "1080P", "4K"],
    min: 3,
    max: 10,
    base: 0.0987,
    mult: { "720P": 1, "1080P": 1.6667, "4K": 2.5 } as Record<string, number>,
    discount: false,
    note: "3–10 秒。只收 1 张首帧，不支持人物参考图与参考音频，所以直出镜头没有人物锚定。无时段折扣。平均出片约 1.8 分钟，比 H3 快近一倍。",
    warn: "实测 Omni 会无视「不要配乐」的指令，自带一层背景音乐。若同时用音乐库混音会变成两层音乐，建议二选一：用 Omni 就别再配 BGM，或导出时丢掉原音轨只保留我们的配乐（会一并丢掉人声）。",
  },
];

export function ProjectSettings({ project }: { project: Project }) {
  const { act, pending } = useAct();
  const [engine, setEngine] = useState(project.videoEngine ?? "h3");
  const [resolution, setResolution] = useState(project.videoResolution ?? "768P");
  const [quality, setQuality] = useState(project.imageQuality ?? "low");
  const cur = ENGINES.find((e) => e.id === engine)!;
  const dirty = engine !== (project.videoEngine ?? "h3") || resolution !== (project.videoResolution ?? "768P");

  const shots = useMemo(() => project.chapters.flatMap((c) => c.shots), [project.chapters]);
  const seconds = shots.reduce((a, s) => a + Math.min(cur.max, Math.max(cur.min, s.duration)), 0);
  const hour = new Date().getHours();
  const disc = cur.discount ? (hour < 9 ? 0.3 : hour >= 22 ? 0.5 : hour >= 18 ? 0.8 : 1) : 1;
  const perSec = cur.base * (cur.mult[resolution] ?? 1) * disc;
  const narrated = project.kind === "narrated";
  const [presentStyle, setPresentStyle] = useState(project.presentStyle ?? "subtitle");
  const [kenBurns, setKenBurns] = useState(project.kenBurns ?? 0.06);
  const narratedDirty = presentStyle !== (project.presentStyle ?? "subtitle") || kenBurns !== (project.kenBurns ?? 0.06);
  const speakingChars = project.characters.filter((c) => c.voice?.confirmed);

  if (narrated) {
    const utts = shots.flatMap((s) => s.utterances ?? []);
    const chars = utts.reduce((a, u) => a + u.text.length, 0);
    const pages = shots.length;
    return (
      <main className="mx-auto grid max-w-[1500px] grid-cols-1 gap-6 px-6 py-6 lg:grid-cols-[1fr_360px]">
        <Section title="说书 · 展示方式" aside={<Mono className="text-[10.5px] text-ink-3">改动后要重新渲染页视频</Mono>}>
          <div className="flex flex-col gap-3">
            {PRESENT_STYLES.map((s) => {
              const soon = false;
              return (
                <label key={s.id} className={cx("flex gap-3 rounded-sm border p-3", soon ? "cursor-not-allowed opacity-60" : "cursor-pointer", presentStyle === s.id ? "border-cinnabar bg-paper" : "border-line")}>
                  <input type="radio" name="presentStyle" className="mt-1 accent-cinnabar" disabled={soon} checked={presentStyle === s.id} onChange={() => setPresentStyle(s.id)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between">
                      <span className="font-serif text-[14px] font-bold">{s.label}</span>
                      {soon && <Mono className="text-[10.5px] text-ink-3">第二期</Mono>}
                    </div>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-ink-2">{s.note}</p>
                  </div>
                </label>
              );
            })}
            <Field label="页图缓推（Ken Burns）" hint="0 = 静止；0.06 = 整页缓缓推近 6%，让静态图有点呼吸">
              <div className="flex items-center gap-3">
                <input type="range" min={0} max={0.15} step={0.01} value={kenBurns} onChange={(e) => setKenBurns(Number(e.target.value))} className="flex-1 accent-cinnabar" />
                <Mono className="w-12 text-right text-[11.5px]">{kenBurns.toFixed(2)}</Mono>
              </div>
            </Field>
            {presentStyle === "galgame" && (
              <p className="border border-dashed border-line px-2.5 py-1.5 text-[11px] leading-relaxed text-ink-3">
                对话框式：说话人的立绘在「人物库」每个人设下生成（透明背景七分身，每个表情一张）；章节页工具条的「立绘」按本章台词自动补齐。没有立绘的人物只出对话框和名牌。改了展示方式要重新「渲染页」。
              </p>
            )}
            <div className="flex items-center justify-between border-t border-line pt-3">
              <Mono className="text-[10.5px] text-ink-3">页节奏：页首 0.5s · 条间 0.45s · 页尾 0.8s</Mono>
              <Button variant={narratedDirty ? "primary" : "outline"} size="sm" disabled={!narratedDirty || pending} onClick={() => act(() => updateNarratedSettings(project.id, { presentStyle, kenBurns }))}>
                保存
              </Button>
            </div>
          </div>
        </Section>

        <div className="flex flex-col gap-6">
          <Section title="声音" aside={<Link href={`/projects/${project.id}/casting`} className="font-mono text-[10.5px] text-cinnabar hover:underline">去选角 →</Link>}>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
              <dt className="text-ink-3">旁白</dt>
              <dd>{project.narratorConfirmed ? <span>{(project.narratorVoiceLabel || project.narratorVoiceId || "").replace(/^MiniMax · /, "")}</span> : <span className="text-amber">未确认</span>}</dd>
              {speakingChars.map((c) => (
                <div key={c.id} className="contents">
                  <dt className="text-ink-3">{c.name}</dt>
                  <dd>{(c.voice?.label || c.voice?.voiceId || "").replace(/^MiniMax · /, "")}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-3">MiniMax speech-2.8-hd · $100 / 百万字。每个开口的角色和旁白都要在选角页人工确认音色，配音按钮才会亮。</p>
          </Section>

          <Section title="出图推理等级" aside={<Mono className="text-[10.5px] text-ink-3">gpt-image-2.5 · fal</Mono>}>
            <div className="flex flex-col gap-2">
              {IMAGE_QUALITY_OPTIONS.map((q) => (
                <label key={q} className={cx("flex cursor-pointer items-center justify-between rounded-sm border px-3 py-1.5", quality === q ? "border-cinnabar bg-paper" : "border-line")}>
                  <span className="flex items-center gap-2">
                    <input type="radio" name="quality" className="accent-cinnabar" checked={quality === q} onChange={() => setQuality(q)} />
                    <span className="font-mono text-[12px]">{q}</span>
                  </span>
                  <Mono className="text-[10.5px] text-ink-3">${imagePrice(q).toFixed(3)} /张</Mono>
                </label>
              ))}
              <div className="flex justify-end border-t border-line pt-2">
                <Button variant={quality !== (project.imageQuality ?? "low") ? "primary" : "outline"} size="sm" disabled={quality === (project.imageQuality ?? "low") || pending} onClick={() => act(() => updateVideoEngine(project.id, { imageQuality: quality }))}>
                  保存
                </Button>
              </div>
            </div>
          </Section>

          <Section title="全片成本估算">
            <dl className="grid grid-cols-2 gap-y-2 font-mono text-[12px]">
              <dt className="text-ink-3">页</dt>
              <dd>{pages}</dd>
              <dt className="text-ink-3">配音字数</dt>
              <dd>{chars}</dd>
              <dt className="text-ink-3">出图</dt>
              <dd>$ {(pages * imagePrice(quality)).toFixed(2)}</dd>
              <dt className="text-ink-3">配音</dt>
              <dd>$ {((chars * 100) / 1_000_000).toFixed(2)}</dd>
              <dt className="text-ink-3">合计</dt>
              <dd className="text-cinnabar">$ {(pages * imagePrice(quality) + (chars * 100) / 1_000_000).toFixed(2)}</dd>
            </dl>
            <p className="mt-3 border-t border-line pt-3 text-[11.5px] leading-relaxed text-ink-2">页视频是本机 ffmpeg 合成的，不花钱。选角试听每个角色 3 段样音，几分钱。</p>
          </Section>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto grid max-w-[1500px] grid-cols-1 gap-6 px-6 py-6 lg:grid-cols-[1fr_360px]">
      <Section title="视频引擎" aside={<Mono className="text-[10.5px] text-ink-3">改动只影响之后提交的生成</Mono>}>
        <div className="flex flex-col gap-3">
          {ENGINES.map((e) => (
            <label key={e.id} className={cx("flex cursor-pointer gap-3 rounded-sm border p-3", engine === e.id ? "border-cinnabar bg-paper" : "border-line")}>
              <input
                type="radio"
                name="engine"
                className="mt-1 accent-cinnabar"
                checked={engine === e.id}
                onChange={() => {
                  setEngine(e.id);
                  if (!e.resolutions.includes(resolution)) setResolution(e.resolutions[0]);
                }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between">
                  <span className="font-serif text-[14px] font-bold">{e.label}</span>
                  <Mono className="text-[10.5px] text-ink-3">
                    {e.min}–{e.max}s · {e.resolutions.join(" / ")}
                  </Mono>
                </div>
                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-2">{e.note}</p>
                {"warn" in e && (
                  <p className="mt-1.5 rounded-sm border border-amber/40 bg-amber-wash px-2 py-1 text-[11px] leading-relaxed text-amber">
                    {(e as { warn: string }).warn}
                  </p>
                )}
                {engine === e.id && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {e.resolutions.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setResolution(r)}
                        className={cx("rounded-sm border px-2 py-0.5 font-mono text-[11px]", resolution === r ? "border-cinnabar bg-cinnabar text-paper" : "border-line bg-panel text-ink-2 hover:border-line-strong")}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </label>
          ))}
          <label className="flex cursor-pointer items-start gap-2 border-t border-line pt-3 text-[11.5px]" title="直出（text_only）镜头：关着走 Turbo 文生，只靠提示词；开着把场景图与出场人设图当参考送进 H3 Max 全能参考，人物与场景更像，但视频 $0.02/s（Turbo 的两倍）">
            <input type="checkbox" className="mt-0.5 accent-cinnabar" checked={Boolean(project.textOnlyRefs)} disabled={pending} onChange={(e) => act(() => updateVideoEngine(project.id, { textOnlyRefs: e.target.checked }))} />
            <span>
              直出镜头带参考图
              <Mono className="ml-1.5 text-[10px] text-ink-3">{project.textOnlyRefs ? "开：场景 / 人设图送进 H3 Max 全能参考 · $0.02/s" : "关：Turbo 文生 · $0.01/s · 只靠提示词"}</Mono>
            </span>
          </label>
          <div className="flex items-center justify-between border-t border-line pt-3">
            <Mono className="text-[10.5px] text-ink-3">
              当前 {perSec.toFixed(4)} /秒{cur.discount && disc < 1 ? `（已含 ${disc} 折时段优惠）` : ""}
            </Mono>
            <Button variant={dirty ? "primary" : "outline"} size="sm" disabled={!dirty || pending} onClick={() => act(() => updateVideoEngine(project.id, { videoEngine: engine, videoResolution: resolution }))}>
              保存
            </Button>
          </div>
        </div>
      </Section>

      <div className="flex flex-col gap-6">
        <Section title="出图推理等级" aside={<Mono className="text-[10.5px] text-ink-3">gpt-image-2.5 · fal</Mono>}>
          <div className="flex flex-col gap-2">
            {IMAGE_QUALITY_OPTIONS.map((q) => (
              <label key={q} className={cx("flex cursor-pointer items-center justify-between rounded-sm border px-3 py-1.5", quality === q ? "border-cinnabar bg-paper" : "border-line")}>
                <span className="flex items-center gap-2">
                  <input type="radio" name="quality" className="accent-cinnabar" checked={quality === q} onChange={() => setQuality(q)} />
                  <span className="font-mono text-[12px]">{q}</span>
                </span>
                <Mono className="text-[10.5px] text-ink-3">${imagePrice(q).toFixed(3)} /张 · 首帧 2K</Mono>
              </label>
            ))}
            <p className="text-[11px] leading-relaxed text-ink-3">
              人设、道具、场景图和首帧都默认用这一档；分镜页里每一镜的首帧可以单独覆盖。实测 low 档 2K 首帧已不输中转站的 gpt-image-2，一张 $0.006。
            </p>
            <div className="flex justify-end border-t border-line pt-2">
              <Button variant={quality !== (project.imageQuality ?? "low") ? "primary" : "outline"} size="sm" disabled={quality === (project.imageQuality ?? "low") || pending} onClick={() => act(() => updateVideoEngine(project.id, { imageQuality: quality }))}>
                保存
              </Button>
            </div>
          </div>
        </Section>

        <Section title="全片成本估算">
          <dl className="grid grid-cols-2 gap-y-2 font-mono text-[12px]">
            <dt className="text-ink-3">镜头</dt>
            <dd>{shots.length}</dd>
            <dt className="text-ink-3">总时长</dt>
            <dd>{seconds} 秒</dd>
            <dt className="text-ink-3">每秒</dt>
            <dd>$ {perSec.toFixed(4)}</dd>
            <dt className="text-ink-3">合计</dt>
            <dd className="text-cinnabar">$ {(seconds * perSec).toFixed(2)}</dd>
          </dl>
          {cur.discount && (
            <p className="mt-3 border-t border-line pt-3 text-[11.5px] leading-relaxed text-ink-2">
              H3 分时段计价，同样这批镜头：
              <br />
              0–9 点 $ {(seconds * cur.base * (cur.mult[resolution] ?? 1) * 0.3).toFixed(2)}
              　18–22 点 $ {(seconds * cur.base * (cur.mult[resolution] ?? 1) * 0.8).toFixed(2)}
              <br />
              白天原价 $ {(seconds * cur.base * (cur.mult[resolution] ?? 1)).toFixed(2)}。批量出片放在凌晨最划算。
            </p>
          )}
        </Section>
        <Section title="拆镜偏好">
          <div className="flex flex-col gap-3">
            <Field label="单镜目标时长" hint="秒">
              <Input readOnly value={`${cur.min} – ${cur.max}（引擎上限）`} />
            </Field>
            <Field label="每个分镜组">
              <Input readOnly value="2–4 镜，同场景同时间同光线" />
            </Field>
          </div>
        </Section>
      </div>
    </main>
  );
}
