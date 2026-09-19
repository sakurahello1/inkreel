import { z } from "zod";
import { db } from "../db";
import { chat, extractJson, type ChatProviderName } from "../providers/chat";
import { EXPRESSIONS, pagesSystemPrompt, pagesUserPrompt } from "../prompts";
import { splitParagraphs } from "./storyboard";

/**
 * 拆页 Agent（说书模式）。和拆镜同一套骨架：按段落分块、schema 校验、失败回炉、名字→id 归一。
 * 区别只在产物：一页 = 一张图 + 旁白 + 台词，没有景别/运镜/时长——时长以后由配音的长度决定。
 */

const PageSchema = z.object({
  unit_index: z.number().int(),
  scene: z.string().default(""),
  characters: z.array(z.object({ name: z.string(), persona_tag: z.string().default("") })).default([]),
  props: z.array(z.string()).optional().default([]),
  narration: z.string().default(""),
  lines: z.array(z.object({ name: z.string(), line: z.string(), tone: z.string().default(""), expression: z.string().default("平静") })).default([]),
  image_prompt: z.string().default(""),
  bgm: z.string().nullable().optional().default(null),
  needs_review: z.boolean().default(false),
});

const OutputSchema = z.object({
  units: z.array(z.object({ index: z.number().int(), summary: z.string(), para_start: z.number().int().default(0), para_end: z.number().int().default(0) })),
  pages: z.array(PageSchema).min(1),
});

type Output = z.infer<typeof OutputSchema>;

const CHUNK_PARAS = 28;

export interface NormalizedPage {
  unitIndex: number;
  scene: string;
  characters: Array<{ characterId: string; personaTag: string }>;
  propIds: string[];
  narration: string;
  dialogue: Array<{ characterId: string; line: string; tone: string; expression: string }>;
  framePrompt: string;
  bgmTrackId: string | null;
  needsReview: boolean;
  reviewNote: string;
}

export async function runPagesAgent(chapterId: string, opts: { provider?: ChatProviderName; instruction?: string } = {}) {
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
    characters: project.characters.map((c) => ({ name: c.name, age: c.age, role: c.role, personality: c.personality, personas: c.personas.map((p) => ({ tag: p.tag, description: p.description })) })),
    props: project.props.map((p) => ({ name: p.name, description: p.description })),
    bgmTracks: project.bgmTracks.map((t) => ({ name: t.name, mood: t.mood, description: t.description })),
  };

  const chunks: Array<{ from: number; to: number }> = [];
  for (let i = 0; i < paragraphs.length; i += CHUNK_PARAS) chunks.push({ from: i, to: Math.min(i + CHUNK_PARAS, paragraphs.length) });

  const usage = { prompt: 0, completion: 0, total: 0 };
  let model = "";
  const units: Output["units"] = [];
  const pages: Output["pages"] = [];
  let unitOffset = 0;
  let prevTail = "";

  for (let ci = 0; ci < chunks.length; ci++) {
    const { from, to } = chunks[ci];
    const partNote =
      chunks.length > 1
        ? `本次只处理整篇的第 ${ci + 1}/${chunks.length} 段，段落编号沿用给定的全局编号，不要处理范围之外的内容。${prevTail ? `\n上一段的收尾是：${prevTail}。请自然承接，不要重复。` : ""}${ci === chunks.length - 1 ? "" : "\n这不是结尾，不要收尾、不要总结。"}`
        : "";
    const userPrompt = pagesUserPrompt({ ...common, paragraphs: paragraphs.slice(from, to), paragraphOffset: from, instruction: [opts.instruction, partNote].filter(Boolean).join("\n\n") });

    let lastError = "";
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      const msgs = [
        { role: "system" as const, content: pagesSystemPrompt(project.orientation) },
        { role: "user" as const, content: lastError ? `${userPrompt}\n\n上一次输出不合规：${lastError}\n请严格按结构重新输出完整 JSON。` : userPrompt },
      ];
      try {
        const res = await chat(msgs, { provider: opts.provider, json: true, maxTokens: 16000, timeoutMs: 20 * 60 * 1000 });
        usage.prompt += res.usage.prompt;
        usage.completion += res.usage.completion;
        usage.total += res.usage.total;
        model = res.model;
        const parsed = OutputSchema.parse(extractJson(res.text, (v) => typeof v === "object" && v !== null && Array.isArray((v as { pages?: unknown }).pages)));
        for (const u of parsed.units) units.push({ ...u, index: u.index + unitOffset });
        for (const p of parsed.pages) pages.push({ ...p, unit_index: p.unit_index + unitOffset });
        unitOffset += parsed.units.length ? Math.max(...parsed.units.map((u) => u.index)) : 0;
        prevTail = parsed.units.length ? parsed.units[parsed.units.length - 1].summary : prevTail;
        ok = true;
      } catch (e) {
        lastError = e instanceof Error ? e.message.slice(0, 600) : String(e);
        console.warn(`[pages] chunk ${ci + 1}/${chunks.length} attempt ${attempt + 1} failed:`, lastError);
      }
    }
    if (!ok) throw new Error(`第 ${ci + 1}/${chunks.length} 段拆页三次都失败：${lastError}`);
    console.log(`[pages] chunk ${ci + 1}/${chunks.length} done, 累计 ${pages.length} 页`);
  }

  return { output: normalize({ units, pages }, project.characters, paragraphs.length, project.bgmTracks, project.props), usage, model };
}

function normalize(
  out: Output,
  characters: Array<{ id: string; name: string; personas: Array<{ tag: string }> }>,
  paraCount: number,
  tracks: Array<{ id: string; name: string }>,
  props: Array<{ id: string; name: string }>,
) {
  const byName = new Map(characters.map((c) => [c.name, c]));
  const findChar = (name: string) => byName.get(name.trim()) ?? characters.find((c) => name.includes(c.name) || c.name.includes(name.trim()));
  const pages: NormalizedPage[] = [];
  for (const p of out.pages) {
    const notes: string[] = [];
    let needsReview = p.needs_review;
    const chars: NormalizedPage["characters"] = [];
    for (const c of p.characters) {
      const ch = findChar(c.name);
      if (!ch) {
        notes.push(`人物「${c.name}」不在人物表`);
        needsReview = true;
        continue;
      }
      let tag = c.persona_tag.trim();
      if (!ch.personas.some((x) => x.tag === tag)) {
        if (tag) notes.push(`${ch.name} 的 tag「${tag}」不存在`);
        tag = ch.personas[0]?.tag ?? "";
        needsReview = needsReview || !tag;
      }
      if (tag && !chars.some((x) => x.characterId === ch.id)) chars.push({ characterId: ch.id, personaTag: tag });
    }
    const dialogue: NormalizedPage["dialogue"] = [];
    for (const l of p.lines) {
      const ch = findChar(l.name);
      if (!ch) {
        notes.push(`台词说话人「${l.name}」不在人物表`);
        needsReview = true;
        continue;
      }
      const expression = (EXPRESSIONS as readonly string[]).includes(l.expression) ? l.expression : "平静";
      dialogue.push({ characterId: ch.id, line: l.line.trim(), tone: l.tone, expression });
    }
    const chars_ = (p.narration + dialogue.map((d) => d.line).join("")).length;
    if (chars_ > 160) notes.push(`这一页要念 ${chars_} 字，偏长，建议拆页`);
    if (chars_ < 20 && (p.narration || dialogue.length)) notes.push(`这一页只念 ${chars_} 字，偏短`);
    const bgmName = (p.bgm ?? "").trim();
    const bgm = bgmName && !/^(null|none|无)$/i.test(bgmName) ? tracks.find((t) => t.name === bgmName) ?? tracks.find((t) => bgmName.includes(t.name) || t.name.includes(bgmName)) ?? null : null;
    if (bgmName && !bgm && !/^(null|none|无)$/i.test(bgmName)) notes.push(`BGM「${bgmName}」不在音乐库`);
    const propIds: string[] = [];
    for (const raw of p.props ?? []) {
      const q = raw.trim();
      const hit = props.find((x) => x.name === q) ?? props.find((x) => q.includes(x.name) || x.name.includes(q));
      if (hit && !propIds.includes(hit.id)) propIds.push(hit.id);
      else if (q) notes.push(`道具「${q}」不在道具库`);
    }
    pages.push({ unitIndex: p.unit_index, scene: p.scene, characters: chars, propIds, narration: p.narration.trim(), dialogue, framePrompt: p.image_prompt, bgmTrackId: bgm?.id ?? null, needsReview, reviewNote: notes.join("；") });
  }
  const units = out.units.map((u) => ({ index: u.index, summary: u.summary, paraStart: Math.max(0, Math.min(u.para_start, paraCount - 1)), paraEnd: Math.max(0, Math.min(u.para_end, paraCount - 1)) }));
  return { units, pages };
}
