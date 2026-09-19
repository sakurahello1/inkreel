"use client";

import { useEffect, useRef, useState } from "react";
import { VIDEO_ROUTE_LABEL, type Chapter, type DialogueLine, type FrameMode, type Project, type Shot, type ShotCharacter } from "@/lib/types";
import { createTransitionShot, deleteShot, mergeShotWithNext, setShotBgm, setShotBgmToModel, setShotProps, setShotScene, splitShot, updatePage, updateShot } from "@/server/actions";
import { EXPRESSIONS } from "@/lib/narrated";
import { useAct } from "@/components/use-act";
import { Avatar, Button, Field, Input, Mono, Textarea, cx } from "@/components/ui";
import { SHOT_SIZES } from "./shared";

export function FrameModeToggle({ mode, onToggle }: { mode: FrameMode; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="inline-flex h-5 items-stretch overflow-hidden rounded-sm border border-line-strong font-mono text-[9.5px] tracking-wider"
      title="首帧模式：先生成首帧 / 直接文生视频"
    >
      <span className={cx("px-1.5 leading-[18px]", mode === "image" ? "bg-ink text-paper" : "text-ink-3")}>首帧</span>
      <span className={cx("px-1.5 leading-[18px]", mode === "text_only" ? "bg-ink text-paper" : "text-ink-3")}>直出</span>
    </button>
  );
}

/* ================================================================== */

type ShotForm = {
  scene: string;
  shotSize: string;
  camera: string;
  duration: string;
  emotion: string;
  action: string;
  sound: string;
  framePrompt: string;
  videoPrompt: string;
  narration: string;
  characters: ShotCharacter[];
  dialogue: DialogueLine[];
};

/** 把镜头映射成表单值。时长在表单里是字符串，保存时再夹到引擎允许的区间。 */
function formOf(s: Shot): ShotForm {
  return {
    scene: s.scene,
    shotSize: s.shotSize,
    camera: s.camera,
    duration: String(s.duration),
    emotion: s.emotion,
    action: s.action,
    sound: s.sound,
    framePrompt: s.framePrompt,
    videoPrompt: s.videoPrompt,
    narration: s.narration ?? "",
    characters: s.characters,
    dialogue: s.dialogue,
  };
}

export function ShotEditor({ shot, project, chapter }: { shot: Shot; project: Project; chapter: Chapter }) {
  const [form, setForm] = useState<ShotForm>(() => formOf(shot));
  const snap = JSON.stringify(formOf(shot));
  const lastSnap = useRef(snap);
  useEffect(() => {
    if (snap !== lastSnap.current) {
      lastSnap.current = snap;
      setForm(JSON.parse(snap));
    }
  }, [snap]);
  const dirty = JSON.stringify(form) !== snap;
  const { act, pending } = useAct();
  const set = (k: keyof ShotForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const availableChars = project.characters.filter((c) => !form.characters.some((x) => x.characterId === c.id));
  const next = chapter.shots.find((s) => s.index === shot.index + 1) ?? null;
  const narrated = project.kind === "narrated";
  const unitWord = narrated ? "页" : "镜";

  function save() {
    if (narrated) {
      act(() =>
        updatePage(project.id, chapter.id, shot.id, {
          narration: form.narration,
          dialogue: form.dialogue,
          framePrompt: form.framePrompt,
          scene: form.scene,
          characters: form.characters,
        }),
        { ok: "已保存，配音条已重排" },
      );
      return;
    }
    act(() =>
      updateShot(project.id, chapter.id, shot.id, {
        scene: form.scene,
        shotSize: form.shotSize,
        camera: form.camera,
        duration: Math.min(15, Math.max(4, Number(form.duration) || shot.duration)),
        emotion: form.emotion,
        action: form.action,
        sound: form.sound,
        framePrompt: form.framePrompt,
        videoPrompt: form.videoPrompt,
        characters: form.characters,
        dialogue: form.dialogue,
      }),
      { ok: "已保存" },
    );
  }

  return (
    <div className="anim-in border-t border-dashed border-line bg-paper px-4 pb-4 pt-3">
      {shot.reviewNote && <div className="mb-3 rounded-sm border border-cinnabar/40 bg-cinnabar-wash px-3 py-1.5 font-mono text-[11px] text-cinnabar">{shot.reviewNote}</div>}
      <div className="grid grid-cols-4 gap-3">
        <Field label="场景" className="col-span-2" hint="左边挂场景库里的空间基准图，右边是这一镜自己的时间与天气">
          <div className="flex gap-1.5">
            <select
              value={shot.sceneId ?? ""}
              onChange={(e) => act(() => setShotScene(project.id, chapter.id, shot.id, e.target.value || null))}
              className={cx(
                "w-[42%] shrink-0 rounded-sm border bg-panel px-2 py-1.5 text-[13px]",
                shot.sceneId ? "border-line" : "border-cinnabar/50 text-ink-3",
              )}
            >
              <option value="">未挂场景</option>
              {(project.scenes ?? []).map((sc) => (
                <option key={sc.id} value={sc.id}>
                  {sc.name}
                  {sc.sheetUrl ? "" : "（无基准图）"}
                </option>
              ))}
            </select>
            <Input value={form.scene} onChange={set("scene")} />
          </div>
        </Field>
        {!narrated && (
          <>
            <Field label="景别">
              <select value={form.shotSize} onChange={set("shotSize")} className="w-full rounded-sm border border-line bg-panel px-2 py-1.5 text-[13px]">
                {SHOT_SIZES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="时长" hint="4–15s">
              <Input value={form.duration} onChange={set("duration")} />
            </Field>
            <Field label="运镜" className="col-span-2">
              <Input value={form.camera} onChange={set("camera")} />
            </Field>
            <Field label="情绪" className="col-span-2">
              <Input value={form.emotion} onChange={set("emotion")} />
            </Field>
            <Field label="动作与走位" className="col-span-2">
              <Input value={form.action} onChange={set("action")} />
            </Field>
            <Field label="环境音 / 音效">
              <Input value={form.sound} onChange={set("sound")} />
            </Field>
          </>
        )}
        <Field label="BGM" hint="改动立即生效，不退回审定" className={narrated ? "col-span-2" : undefined}>
          <select
            value={shot.bgmTrackId ?? ""}
            onChange={(e) => act(() => setShotBgm(project.id, chapter.id, [shot.id], e.target.value || null))}
            className="w-full rounded-sm border border-line bg-panel px-2 py-1.5 text-[13px]"
          >
            <option value="">无</option>
            {(project.bgmTracks ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.mood ? `（${t.mood}）` : ""}
              </option>
            ))}
          </select>
          {shot.bgmTrackId && !narrated && (
            <label className="mt-1.5 flex items-start gap-1.5 text-[11.5px] text-ink-2">
              <input type="checkbox" className="mt-0.5 accent-cinnabar" checked={shot.bgmToModel !== false} onChange={(e) => act(() => setShotBgmToModel(project.id, chapter.id, [shot.id], e.target.checked))} />
              <span>
                把这一段送给视频模型
                <span className="text-ink-3">（默认关。实测模型不会把它播放进成片，只当抽象参考</span>
                {shot.frameMode === "image" ? <span className="text-amber">；且会改走全能参考，首帧降为参考图</span> : null}
                <span className="text-ink-3">）</span>
              </span>
            </label>
          )}
        </Field>

        <Field label="出场人物 · 人设" className="col-span-4">
          <div className="flex flex-wrap items-center gap-2">
            {form.characters.map((c, i) => {
              const ch = project.characters.find((x) => x.id === c.characterId);
              if (!ch) return null;
              return (
                <span key={c.characterId} className="inline-flex items-center gap-1 rounded-sm border border-line bg-panel py-0.5 pl-1 pr-1 text-[12px]">
                  <Avatar name={ch.name} size={18} />
                  {ch.name}
                  <select
                    value={c.personaTag}
                    onChange={(e) => setForm((f) => ({ ...f, characters: f.characters.map((x, j) => (j === i ? { ...x, personaTag: e.target.value } : x)) }))}
                    className="ml-1 rounded-sm border border-line bg-paper px-1 font-mono text-[10.5px]"
                  >
                    {ch.personas.map((p) => (
                      <option key={p.id} value={p.tag}>
                        {p.tag}
                        {p.sheetReady ? "" : "（无图）"}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="ml-1 px-1 text-ink-3 hover:text-cinnabar" onClick={() => setForm((f) => ({ ...f, characters: f.characters.filter((_, j) => j !== i) }))}>
                    ×
                  </button>
                </span>
              );
            })}
            {availableChars.length > 0 && (
              <select
                value=""
                onChange={(e) => {
                  const ch = project.characters.find((x) => x.id === e.target.value);
                  if (ch) setForm((f) => ({ ...f, characters: [...f.characters, { characterId: ch.id, personaTag: ch.personas[0]?.tag ?? "" }] }));
                }}
                className="rounded-sm border border-dashed border-line-strong bg-transparent px-2 py-0.5 text-[12px] text-ink-2"
              >
                <option value="">＋ 人物</option>
                {availableChars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </Field>

        <Field label="出场道具" className="col-span-4" hint="概念图会作为参考图送进首帧">
          <div className="flex flex-wrap items-center gap-2">
            {(shot.propIds ?? []).map((pid) => {
              const pr = (project.props ?? []).find((x) => x.id === pid);
              if (!pr) return null;
              return (
                <span key={pid} className="inline-flex items-center gap-1 rounded-sm border border-line bg-panel py-0.5 pl-1.5 pr-1 text-[12px]">
                  {pr.sheetUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={pr.sheetUrl} alt="" className="h-4 w-4 border border-line object-cover" />
                  ) : null}
                  {pr.name}
                  <button type="button" className="px-1 text-ink-3 hover:text-cinnabar" onClick={() => act(() => setShotProps(project.id, chapter.id, shot.id, (shot.propIds ?? []).filter((x) => x !== pid)))}>
                    ×
                  </button>
                </span>
              );
            })}
            {(project.props ?? []).some((x) => !(shot.propIds ?? []).includes(x.id)) && (
              <select
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  act(() => setShotProps(project.id, chapter.id, shot.id, [...(shot.propIds ?? []), e.target.value]));
                }}
                className="rounded-sm border border-dashed border-line-strong bg-transparent px-2 py-0.5 text-[12px] text-ink-2"
              >
                <option value="">＋ 道具</option>
                {(project.props ?? [])
                  .filter((x) => !(shot.propIds ?? []).includes(x.id))
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
            )}
            {(project.props ?? []).length === 0 && <span className="text-[11.5px] text-ink-3">道具库是空的，先去「道具库」添加</span>}
          </div>
        </Field>

        {narrated && (
          <Field label="旁白 · 说书人" className="col-span-4" hint="这一页开头念的叙述。保存后自动变成一条待配音">
            <Textarea rows={3} value={form.narration} onChange={set("narration")} placeholder="说书人的口吻，把这一页的情节讲清楚；对白留给下面的台词" />
          </Field>
        )}

        <Field label={narrated ? "台词 · 按念的顺序" : "台词"} className="col-span-4" hint={narrated ? "每句一条配音；表情给 galgame 立绘用" : undefined}>
          <div className="flex flex-col gap-1.5">
            {form.dialogue.map((d, i) => (
              <div key={i} className={cx("grid gap-2", narrated ? "grid-cols-[110px_1fr_120px_96px_28px]" : "grid-cols-[110px_1fr_160px_28px]")}>
                <select value={d.characterId} onChange={(e) => setForm((f) => ({ ...f, dialogue: f.dialogue.map((x, j) => (j === i ? { ...x, characterId: e.target.value } : x)) }))} className="rounded-sm border border-line bg-panel px-2 py-1.5 text-[13px]">
                  {project.characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <Input value={d.line} onChange={(e) => setForm((f) => ({ ...f, dialogue: f.dialogue.map((x, j) => (j === i ? { ...x, line: e.target.value } : x)) }))} />
                <Input value={d.tone} placeholder="语气" onChange={(e) => setForm((f) => ({ ...f, dialogue: f.dialogue.map((x, j) => (j === i ? { ...x, tone: e.target.value } : x)) }))} />
                {narrated && (
                  <select value={d.expression ?? ""} onChange={(e) => setForm((f) => ({ ...f, dialogue: f.dialogue.map((x, j) => (j === i ? { ...x, expression: e.target.value } : x)) }))} className="rounded-sm border border-line bg-panel px-1.5 py-1.5 text-[12px]" title="表情">
                    <option value="">表情…</option>
                    {EXPRESSIONS.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>
                )}
                <button type="button" className="text-ink-3 hover:text-cinnabar" onClick={() => setForm((f) => ({ ...f, dialogue: f.dialogue.filter((_, j) => j !== i) }))}>
                  ×
                </button>
              </div>
            ))}
            <div>
              <Button size="sm" variant="ghost" disabled={project.characters.length === 0} onClick={() => setForm((f) => ({ ...f, dialogue: [...f.dialogue, { characterId: f.characters[0]?.characterId ?? project.characters[0].id, line: "", tone: "" }] }))}>
                ＋ 台词
              </Button>
            </div>
          </div>
        </Field>

        {narrated ? (
          <Field label="画面提示词 · gpt-image-2.5" hint="这一页的静态画面；系统自动加画风前缀" className="col-span-4">
            <Textarea rows={5} value={form.framePrompt} onChange={set("framePrompt")} placeholder="场景光线 → 人物姿态表情 → 景别机位 → 横屏构图" />
          </Field>
        ) : (
          <>
            {shot.frameMode === "image" && (
              <Field label="首帧提示词 · gpt-image-2.5" hint="系统自动加画风前缀" className="col-span-2">
                <Textarea rows={6} value={form.framePrompt} onChange={set("framePrompt")} placeholder={project.orientation === "16:9" ? "场景光线 → 人物姿态表情 → 景别机位 → 横屏构图" : "场景光线 → 人物姿态表情 → 景别机位 → 竖屏构图"} />
              </Field>
            )}
            <Field
              label="视频提示词 · MiniMax H3"
              hint={shot.frameMode === "image" ? `${VIDEO_ROUTE_LABEL[shot.videoRoute ?? "i2v"]} · 关键帧在右栏首帧页加` : "直出模式（全能参考 / 文生）· 需写全场景与外貌"}
              className={shot.frameMode === "image" ? "col-span-2" : "col-span-4"}
            >
              <Textarea rows={6} value={form.videoPrompt} onChange={set("videoPrompt")} />
            </Field>
          </>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <Mono className="text-[10.5px] text-ink-3">{narrated ? "保存后旁白 / 台词会重排成待配音的条；文字没变的条保留已配好的音" : "修改字段后保存，状态会退回到上一道闸门之前"}</Mono>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => splitShot(project.id, chapter.id, shot.id))}>
            拆成两{unitWord}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending || !next}
            title={!next ? `已是最后一${unitWord}` : narrated ? `把第 ${next.index} 页并进来：旁白与台词接起来，两页的页视频都作废` : `把 #${String(next.index).padStart(2, "0")} 并进来：时长相加（≤15s），提示词与台词接起来，它的首帧变成第 ${shot.duration} 秒的关键帧；两镜的成片都作废`}
            onClick={() => { if (next && confirm(narrated ? `把第 ${next.index} 页并入第 ${shot.index} 页？两页现有页视频都作废。` : `把 #${String(next.index).padStart(2, "0")} 并入 #${String(shot.index).padStart(2, "0")}？合并后 ${shot.duration + next.duration}s，两镜现有成片都作废。`)) act(() => mergeShotWithNext(project.id, chapter.id, shot.id)); }}
          >
            与下一{unitWord}合并
          </Button>
          {!narrated && <Button
            size="sm"
            variant="ghost"
            disabled={pending || !next || !shot.videoUrl || !next.frameUrl}
            title={!next ? "已是最后一镜" : !shot.videoUrl ? "本镜还没有成片" : !next.frameUrl ? "下一镜还没有首帧" : `在本镜与 #${String(next.index).padStart(2, "0")} 之间插一个过渡镜头：首帧 = 本镜成片末帧，尾帧 = 下一镜首帧，建好直接出片（${project.minSegmentSeconds ?? 5}s，$0.0${project.minSegmentSeconds ?? 5}）`}
            onClick={() => { if (confirm(`在 #${String(shot.index).padStart(2, "0")} 之后插入过渡镜头并直接出片？`)) act(() => createTransitionShot(project.id, chapter.id, shot.id)); }}
          >
            ＋ 过渡镜头
          </Button>}
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              if (confirm(narrated ? `删除第 ${shot.index} 页？` : `删除 #${String(shot.index).padStart(2, "0")}？`)) act(() => deleteShot(project.id, chapter.id, shot.id));
            }}
          >
            删除
          </Button>
          <Button size="sm" variant={dirty ? "primary" : "outline"} disabled={!dirty || pending} onClick={save}>
            {pending ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */

