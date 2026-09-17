import { z } from "zod";
import { db } from "../db";
import { chat, extractJson, type ChatProviderName } from "../providers/chat";
import { SHOT_SIZES, shotRewriteSystemPrompt, shotRewriteUserPrompt, storyboardSystemPrompt, storyboardUserPrompt } from "../prompts";
import { ENGINES, type VideoEngine } from "../providers/video";
import { parseJson } from "../db";

/** 一个分镜组最多几镜。分组只决定叙事划分与配乐的连续段落，出图上不再有硬限制 */
const MAX_UNIT_SHOTS = 4;

/** 当前视频引擎允许的单镜时长区间 */
function engineRange(engine?: string | null) {
  const e = ENGINES[(engine as VideoEngine) || "h3"] ?? ENGINES.h3;
  return { min: e.minDuration, max: e.maxDuration };
}

const ShotSchema = z.object({
  unit_index: z.number().int(),
  props: z.array(z.string()).optional().default([]),
  scene: z.string().default(""),
  shot_size: z.string().default("中景"),
  camera: z.string().default(""),
  duration: z.number().int().min(2).max(30),
  characters: z.array(z.object({ name: z.string(), persona_tag: z.string().default("") })).default([]),
  dialogue: z.array(z.object({ name: z.string(), line: z.string(), tone: z.string().default("") })).default([]),
  emotion: z.string().default(""),
  action: z.string().default(""),
  sound: z.string().default(""),
  frame_mode: z.enum(["image", "text_only"]).default("image"),
  frame_prompt: z.string().default(""),
  video_prompt: z.string().default(""),
  bgm: z.string().nullable().optional().default(null),
  needs_review: z.boolean().default(false),
});

const OutputSchema = z.object({
  units: z.array(z.object({ index: z.number().int(), summary: z.string(), para_start: z.number().int().default(0), para_end: z.number().int().default(0) })),
  shots: z.array(ShotSchema).min(1),
});

export type StoryboardOutput = z.infer<typeof OutputSchema>;

/**
 * 一个镜头对应的小说原文：它所属分镜组覆盖的那几段。拆镜时 Agent 给每组标了段落区间，
 * 出视频时把这段原文一起送给模型，让它有还原的依据，而不是只看二手的镜头描述。
 */
export function unitSourceText(sourceText: string, unit: { paraStart: number; paraEnd: number } | null | undefined, maxChars = 1200) {
  if (!unit) return "";
  const paras = splitParagraphs(sourceText).slice(unit.paraStart, unit.paraEnd + 1);
  const text = paras.join("\n");
  return text.length > maxChars ? text.slice(0, maxChars) + "…" : text;
}

export function splitParagraphs(text: string) {
  return text
    .split(/\r?\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 长文案分段：一次生成三十个镜头的完整提示词输出量太大，容易超时，分段后每次调用都小而快 */
const CHUNK_PARAS = 28;

/** 调模型拆镜，做 schema 校验与一次回炉。返回校验后的结构。 */
export async function runStoryboardAgent(chapterId: string, opts: { provider?: ChatProviderName; instruction?: string; targetSeconds?: number } = {}) {
  const chapter = await db.chapter.findUniqueOrThrow({
    where: { id: chapterId },
    include: { project: { include: { characters: { include: { personas: { orderBy: { order: "asc" } } }, orderBy: { order: "asc" } }, bgmTracks: { orderBy: { order: "asc" } }, props: { orderBy: { order: "asc" } } } } },
  });
  const paragraphs = splitParagraphs(chapter.sourceText);
  if (paragraphs.length === 0) throw new Error("原文为空");

  const project = chapter.project;
  const common = {
    world: project.world,
    style: project.style,
    characters: project.characters.map((c) => ({
      name: c.name,
      age: c.age,
      role: c.role,
      personality: c.personality,
      personas: c.personas.map((p) => ({ tag: p.tag, description: p.description })),
      hasVoice: c.voiceStatus === "ready",
    })),
    props: project.props.map((p) => ({ name: p.name, description: p.description })),
    bgmTracks: project.bgmTracks.map((t) => ({ name: t.name, mood: t.mood, description: t.description })),
    duration: engineRange(project.videoEngine),
  };

  // 按段落切块，块与块之间带上一块的收尾摘要保持连贯
  const chunks: Array<{ from: number; to: number }> = [];
  for (let i = 0; i < paragraphs.length; i += CHUNK_PARAS) chunks.push({ from: i, to: Math.min(i + CHUNK_PARAS, paragraphs.length) });

  const usage = { prompt: 0, completion: 0, total: 0 };
  let model = "";
  const allUnits: StoryboardOutput["units"] = [];
  const allShots: StoryboardOutput["shots"] = [];
  let unitOffset = 0;
  let prevTail = "";

  for (let ci = 0; ci < chunks.length; ci++) {
    const { from, to } = chunks[ci];
    // 段落编号保持全局，便于原文高亮对齐
    const slice = paragraphs.slice(from, to).map((t, i) => ({ text: t, index: from + i }));
    // 按段落占比给每块分配时长预算，避免模型一段一镜把片长撑爆
    const budget = opts.targetSeconds ? Math.round((opts.targetSeconds * (to - from)) / paragraphs.length) : 0;
    const budgetNote = budget
      ? `\n\n【本段时长预算】约 ${budget} 秒，大约 ${Math.max(2, Math.round(budget / 7))} 个镜头。
文案里有大量单句短段，**必须把语义连贯的相邻段落合并进同一个镜头**，绝不要一段一镜。
镜头数超了就再合并，宁可一个镜头承载两三句话，也不要把片长撑爆。`
      : "";
    const partNote =
      (chunks.length > 1
        ? `本次只处理整篇文案的第 ${ci + 1}/${chunks.length} 段，段落编号沿用给定的全局编号，不要处理范围之外的内容。${
            prevTail ? `\n上一段的收尾是：${prevTail}。请自然承接，不要重复已经拍过的内容。` : ""
          }${ci === chunks.length - 1 ? "" : "\n这不是全片结尾，不要收尾、不要总结。"}`
        : "") + budgetNote;
    const userPrompt = storyboardUserPrompt({
      ...common,
      paragraphs: slice.map((x) => x.text),
      paragraphOffset: from,
      instruction: [opts.instruction, partNote].filter(Boolean).join("\n\n"),
    });

    let lastError = "";
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      const msgs = [
        { role: "system" as const, content: storyboardSystemPrompt(project.orientation) },
        { role: "user" as const, content: lastError ? `${userPrompt}\n\n上一次输出不合规：${lastError}\n请严格按结构重新输出完整 JSON。` : userPrompt },
      ];
      try {
        const res = await chat(msgs, { provider: opts.provider, json: true, maxTokens: 16000, timeoutMs: 20 * 60 * 1000 });
        usage.prompt += res.usage.prompt;
        usage.completion += res.usage.completion;
        usage.total += res.usage.total;
        model = res.model;
        // 只认带 units/shots 的那个对象，避开模型可能先吐的前言 JSON
        const parsed = OutputSchema.parse(
          extractJson(res.text, (v) => typeof v === "object" && v !== null && Array.isArray((v as { shots?: unknown }).shots)),
        );
        for (const u of parsed.units) allUnits.push({ ...u, index: u.index + unitOffset });
        for (const sh of parsed.shots) allShots.push({ ...sh, unit_index: sh.unit_index + unitOffset });
        unitOffset += parsed.units.length ? Math.max(...parsed.units.map((u) => u.index)) : 0;
        prevTail = parsed.units.length ? parsed.units[parsed.units.length - 1].summary : prevTail;
        ok = true;
      } catch (e) {
        lastError = e instanceof Error ? e.message.slice(0, 600) : String(e);
        console.warn(`[storyboard] chunk ${ci + 1}/${chunks.length} attempt ${attempt + 1} failed:`, lastError);
      }
    }
    if (!ok) throw new Error(`第 ${ci + 1}/${chunks.length} 段拆镜三次都失败：${lastError}`);
    console.log(`[storyboard] chunk ${ci + 1}/${chunks.length} done, 累计 ${allShots.length} 镜`);
  }

  const merged = { units: allUnits, shots: allShots };
  return {
    output: normalize(merged, project.characters, paragraphs.length, project.bgmTracks, project.props, engineRange(project.videoEngine)),
    usage,
    model,
    paragraphs,
  };
}

type CharWithPersonas = { id: string; name: string; personas: Array<{ id: string; tag: string }> };
type TrackRef = { id: string; name: string };
type PropRef = { id: string; name: string };

function matchProps(names: string[] | undefined, props: PropRef[]) {
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const raw of names ?? []) {
    const q = raw.trim();
    if (!q) continue;
    const hit = props.find((p) => p.name === q) ?? props.find((p) => q.includes(p.name) || p.name.includes(q));
    if (hit) {
      if (!ids.includes(hit.id)) ids.push(hit.id);
    } else unknown.push(q);
  }
  return { ids, unknown };
}

function matchTrack(name: string | null | undefined, tracks: TrackRef[]) {
  const q = (name ?? "").trim();
  if (!q || /^(null|none|无|不需要)$/i.test(q)) return { id: null as string | null, unknown: false };
  const exact = tracks.find((t) => t.name === q) ?? tracks.find((t) => t.name.toLowerCase() === q.toLowerCase());
  if (exact) return { id: exact.id, unknown: false };
  const loose = tracks.find((t) => q.includes(t.name) || t.name.includes(q));
  return loose ? { id: loose.id, unknown: false } : { id: null, unknown: true };
}

export interface NormalizedShot {
  unitIndex: number;
  scene: string;
  shotSize: string;
  camera: string;
  duration: number;
  characters: Array<{ characterId: string; personaTag: string }>;
  dialogue: Array<{ characterId: string; line: string; tone: string }>;
  emotion: string;
  action: string;
  sound: string;
  frameMode: "image" | "text_only";
  framePrompt: string;
  videoPrompt: string;
  bgmTrackId: string | null;
  propIds: string[];
  needsReview: boolean;
  reviewNote: string;
}

/** 名字 → id、tag 校验、时长夹取、超长拆分标记 */
function normalize(out: StoryboardOutput, characters: CharWithPersonas[], paraCount: number, tracks: TrackRef[] = [], props: PropRef[] = [], range = { min: 4, max: 15 }) {
  const byName = new Map(characters.map((c) => [c.name, c]));
  const shots: NormalizedShot[] = [];
  for (const s of out.shots) {
    const notes: string[] = [];
    let needsReview = s.needs_review;
    const chars: NormalizedShot["characters"] = [];
    for (const c of s.characters) {
      const ch = byName.get(c.name.trim());
      if (!ch) {
        notes.push(`人物「${c.name}」不在人物表`);
        needsReview = true;
        continue;
      }
      let tag = c.persona_tag.trim();
      if (!ch.personas.some((p) => p.tag === tag)) {
        notes.push(`${ch.name} 的 tag「${tag}」不存在`);
        needsReview = true;
        tag = ch.personas[0]?.tag ?? "";
      }
      if (tag) chars.push({ characterId: ch.id, personaTag: tag });
    }
    const dialogue: NormalizedShot["dialogue"] = [];
    for (const d of s.dialogue) {
      const ch = byName.get(d.name.trim());
      if (!ch) {
        notes.push(`台词说话人「${d.name}」不在人物表`);
        needsReview = true;
        continue;
      }
      dialogue.push({ characterId: ch.id, line: d.line, tone: d.tone });
    }
    let duration = s.duration;
    if (duration > range.max) {
      notes.push(`时长 ${duration}s 超过引擎上限，已夹到 ${range.max}s，建议拆分`);
      duration = range.max;
      needsReview = true;
    }
    if (duration < range.min) duration = range.min;
    // 兜底而非规则：时长交给模型判断，这里只拦明显念不完的极端值。
    // 中文正常语速约 4–5 字/秒，超过 5.5 字/秒基本一定吞字。
    const lineChars = dialogue.reduce((a, d) => a + d.line.length, 0);
    if (lineChars > duration * 5.5) {
      notes.push(`台词 ${lineChars} 字压在 ${duration}s 里，约 ${(lineChars / duration).toFixed(1)} 字/秒，明显偏快，模型很可能吞字改词`);
      needsReview = true;
    }
    const shotSize = (SHOT_SIZES as readonly string[]).includes(s.shot_size) ? s.shot_size : "中景";
    const bgm = matchTrack(s.bgm, tracks);
    if (bgm.unknown) notes.push(`BGM「${s.bgm}」不在音乐库，已置空`);
    const prop = matchProps(s.props, props);
    if (prop.unknown.length) {
      notes.push(`道具${prop.unknown.map((x) => `「${x}」`).join("")}不在道具库，已忽略`);
      needsReview = true;
    }
    shots.push({
      unitIndex: s.unit_index,
      scene: s.scene,
      shotSize,
      camera: s.camera,
      duration,
      characters: chars,
      dialogue,
      emotion: s.emotion,
      action: s.action,
      sound: s.sound,
      frameMode: s.frame_mode,
      framePrompt: s.frame_mode === "image" ? s.frame_prompt : "",
      videoPrompt: s.video_prompt,
      bgmTrackId: bgm.id,
      propIds: prop.ids,
      needsReview,
      reviewNote: notes.join("；"),
    });
  }
  const units = out.units.map((u) => ({
    index: u.index,
    summary: u.summary,
    paraStart: Math.max(0, Math.min(paraCount - 1, u.para_start)),
    paraEnd: Math.max(0, Math.min(paraCount - 1, u.para_end)),
  }));
  return regroup(units, shots);
}

type UnitOut = { index: number; summary: string; paraStart: number; paraEnd: number };

/**
 * 分镜组后处理：模型不一定守得住每组的镜头数上限，
 * 超员的组自动切成「组名（续 N）」，并重排组号。
 */
function regroup(units: UnitOut[], shots: NormalizedShot[]) {
  const outUnits: UnitOut[] = [];
  const byUnit = new Map<number, NormalizedShot[]>();
  for (const s of shots) {
    const list = byUnit.get(s.unitIndex) ?? [];
    list.push(s);
    byUnit.set(s.unitIndex, list);
  }
  const seen = new Set<number>();
  let next = 1;
  for (const u of [...units].sort((a, b) => a.index - b.index)) {
    const list = byUnit.get(u.index) ?? [];
    seen.add(u.index);
    if (list.length === 0) {
      outUnits.push({ ...u, index: next });
      next += 1;
      continue;
    }
    for (let i = 0; i < list.length; i += MAX_UNIT_SHOTS) {
      const chunk = list.slice(i, i + MAX_UNIT_SHOTS);
      const part = Math.floor(i / MAX_UNIT_SHOTS);
      outUnits.push({ ...u, index: next, summary: part === 0 ? u.summary : `${u.summary}（续 ${part + 1}）` });
      chunk.forEach((s, k) => {
        s.unitIndex = next;
        if (part > 0 && k === 0) s.reviewNote = [s.reviewNote, `原分镜组超过 ${MAX_UNIT_SHOTS} 镜，已自动切分`].filter(Boolean).join("；");
      });
      next += 1;
    }
  }
  // 归属到不存在的组号的镜头，兜底新建组
  const orphans = shots.filter((s) => !seen.has(s.unitIndex) && !outUnits.some((u) => u.index === s.unitIndex));
  for (let i = 0; i < orphans.length; i += MAX_UNIT_SHOTS) {
    const chunk = orphans.slice(i, i + MAX_UNIT_SHOTS);
    outUnits.push({ index: next, summary: "未归类", paraStart: 0, paraEnd: 0 });
    chunk.forEach((s) => {
      s.unitIndex = next;
    });
    next += 1;
  }
  return { units: outUnits, shots };
}

/** 只改写一个镜头。返回 normalize 后的单镜。 */
export async function runShotRewrite(shotId: string, opts: { provider?: ChatProviderName; instruction: string }) {
  const shot = await db.shot.findUniqueOrThrow({
    where: { id: shotId },
    include: {
      unit: true,
      bgmTrack: true,
      chapter: {
        include: {
          units: { orderBy: { index: "asc" } },
          shots: { orderBy: { index: "asc" } },
          project: { include: { characters: { include: { personas: { orderBy: { order: "asc" } } }, orderBy: { order: "asc" } }, bgmTracks: { orderBy: { order: "asc" } }, props: { orderBy: { order: "asc" } } } },
        },
      },
    },
  });
  const project = shot.chapter.project;
  const nameOf = (id: string) => project.characters.find((c) => c.id === id)?.name ?? id;
  const context = shot.chapter.shots
    .map((x) => {
      const dlg = parseJson<Array<{ characterId: string; line: string }>>(x.dialogue, [])
        .map((d) => `${nameOf(d.characterId)}：「${d.line}」`)
        .join(" / ");
      return `#${String(x.index).padStart(2, "0")}${x.id === shot.id ? "（待改写）" : ""} · ${x.shotSize} · ${x.duration}s · ${x.action}${dlg ? " · " + dlg : ""}`;
    })
    .join("\n");
  const unitIndex = shot.unit?.index ?? 1;
  const target = JSON.stringify(
    {
      unit_index: unitIndex,
      scene: shot.scene,
      shot_size: shot.shotSize,
      camera: shot.camera,
      duration: shot.duration,
      characters: parseJson<Array<{ characterId: string; personaTag: string }>>(shot.characters, []).map((c) => ({ name: nameOf(c.characterId), persona_tag: c.personaTag })),
      dialogue: parseJson<Array<{ characterId: string; line: string; tone: string }>>(shot.dialogue, []).map((d) => ({ name: nameOf(d.characterId), line: d.line, tone: d.tone })),
      emotion: shot.emotion,
      action: shot.action,
      sound: shot.sound,
      frame_mode: shot.frameMode,
      frame_prompt: shot.framePrompt,
      video_prompt: shot.videoPrompt,
      bgm: shot.bgmTrack?.name ?? null,
      needs_review: false,
    },
    null,
    2,
  );
  const messages = [
    { role: "system" as const, content: shotRewriteSystemPrompt() },
    {
      role: "user" as const,
      content: shotRewriteUserPrompt({
        world: project.world,
        style: project.style,
        characters: project.characters.map((c) => ({ name: c.name, personas: c.personas.map((p) => ({ tag: p.tag, description: p.description })) })),
        context,
        target,
        instruction: opts.instruction,
        props: project.props.map((p) => ({ name: p.name, description: p.description })),
        bgmTracks: project.bgmTracks.map((t) => ({ name: t.name, mood: t.mood, description: t.description })),
        duration: engineRange(project.videoEngine),
      }),
    },
  ];
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const msgs = lastError ? [...messages, { role: "user" as const, content: `上一次输出不合规：${lastError}\n请只输出一个合规的镜头 JSON 对象。` }] : messages;
    const res = await chat(msgs, { provider: opts.provider, json: true, maxTokens: 6000 });
    try {
      const raw = extractJson<unknown>(res.text, (v) => typeof v === "object" && v !== null && "video_prompt" in (v as Record<string, unknown>));
      const r = raw as { shot?: unknown; shots?: unknown[] };
      const obj = Array.isArray(raw) ? raw[0] : (r.shot ?? r.shots?.[0] ?? raw);
      const parsed = ShotSchema.parse(obj);
      const out = normalize({ units: [], shots: [{ ...parsed, unit_index: unitIndex }] }, project.characters, shot.chapter.units.length, project.bgmTracks, project.props, engineRange(project.videoEngine));
      return { shot: out.shots[0], usage: res.usage, model: res.model };
    } catch (e) {
      lastError = `${e instanceof Error ? e.message.slice(0, 500) : String(e)}（开头：${res.text.trim().slice(0, 200).replace(/\s+/g, " ")}）`;
    }
  }
  throw new Error(`逐镜改写两次都不合规：${lastError}`);
}
