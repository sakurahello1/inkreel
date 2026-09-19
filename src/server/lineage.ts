import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db, parseJson } from "./db";
import { keyframeLabel, orderKeyframes, videoRouteOf, type VideoRoute } from "@/lib/keyframes";
import { PAGE_GAP, PAGE_LEAD, PAGE_TAIL } from "@/lib/narrated";

/**
 * 输入指纹：把「生成某个产物时用到的全部输入」压成一个短哈希。
 *
 * 出图那一刻把指纹存进 Shot.frameInputHash / Shot.videoInputHash，
 * 之后任何时候重算一遍，不一致就说明上游变过，当前产物已经过期。
 *
 * 这样做的好处是不需要「上游改动 → 逐级标记下游」的传播逻辑：
 * 传播逻辑一旦漏一条路径就会长期沉默地错下去，而重算指纹永远反映当下真相。
 */
export function hash(parts: Array<string | number | null | undefined>) {
  return crypto.createHash("sha1").update(parts.map((x) => String(x ?? "")).join(" ")).digest("hex").slice(0, 16);
}

/** 血缘条目：本次实际喂进模型的一个输入 */
export interface LineageInput {
  /** 资产 id；纯文本输入没有资产则留空 */
  assetId?: string;
  /** scene | persona | prop | extra | style | frame | keyframe | anchor | prev_video | bgm */
  role: string;
  label: string;
}

type ShotChar = { characterId: string; personaTag: string };

/* ------------------------------------------------------------------ *
 * 上下文：整章算一次就够。逐镜重查项目图会让 32 镜的章节花掉 700ms。
 * ------------------------------------------------------------------ */

const ctxInclude = {
  project: {
    include: {
      characters: { include: { personas: { include: { sheet: true } } } },
      props: { include: { sheet: true } },
      scenes: { include: { sheet: true } },
      styleRefs: { include: { asset: true }, orderBy: { order: "asc" as const } },
    },
  },
  units: { include: { shots: { orderBy: { index: "asc" as const } } }, orderBy: { index: "asc" as const } },
  shots: { include: { bgmTrack: true, extraRefs: { include: { asset: true }, orderBy: { order: "asc" as const } }, keyframes: true, utterances: { orderBy: { order: "asc" as const } } }, orderBy: { index: "asc" as const } },
};

/** 说书的页视频指纹：页图 + 各条音频 + 节奏参数 + 画幅。渲染时存进 Shot.videoInputHash */
export function pageRenderHash(shot: { frameId: string | null; utterances: Array<{ assetId: string | null }> }, project: { kenBurns: number; orientation: string }) {
  return hash(["page", shot.frameId, ...shot.utterances.map((u) => u.assetId), PAGE_LEAD, PAGE_GAP, PAGE_TAIL, project.kenBurns, project.orientation]);
}

export type LineageContext = Prisma.ChapterGetPayload<{ include: typeof ctxInclude }>;

export function loadLineageContext(chapterId: string) {
  return db.chapter.findUniqueOrThrow({ where: { id: chapterId }, include: ctxInclude });
}

/* ------------------------------------------------------------------ *
 * 纯函数部分：给定上下文，算出各级的输入与指纹
 * ------------------------------------------------------------------ */

type ShotLike = { characters: string; props: string; sceneId: string | null; extraRefs?: Array<{ asset: { id: string }; label: string }> };

/** 一个镜头挂着的场景图、人设图、道具图、画风参考，顺序与任务里喂图的顺序一致 */
function refAssets(ctx: LineageContext, shot: ShotLike): LineageInput[] {
  const project = ctx.project;
  const out: LineageInput[] = [];
  const seen = new Set<string>();
  const sc = shot.sceneId ? project.scenes.find((x) => x.id === shot.sceneId) : undefined;
  if (sc?.sheet) {
    seen.add(sc.sheet.id);
    out.push({ assetId: sc.sheet.id, role: "scene", label: "场景" });
  }
  for (const c of parseJson<ShotChar[]>(shot.characters, [])) {
    const ch = project.characters.find((x) => x.id === c.characterId);
    const persona = ch?.personas.find((p) => p.tag === c.personaTag) ?? ch?.personas.find((p) => p.sheet);
    if (ch && persona?.sheet && !seen.has(persona.sheet.id)) {
      seen.add(persona.sheet.id);
      out.push({ assetId: persona.sheet.id, role: "persona", label: `${ch.name}·${persona.tag}` });
    }
  }
  for (const pid of parseJson<string[]>(shot.props, [])) {
    const pr = project.props.find((x) => x.id === pid);
    if (pr?.sheet && !seen.has(pr.sheet.id)) {
      seen.add(pr.sheet.id);
      out.push({ assetId: pr.sheet.id, role: "prop", label: `道具·${pr.name}` });
    }
  }
  // 创作者手动补充的参考图：资产 id 进指纹，换图就过期
  for (const r of shot.extraRefs ?? []) {
    if (seen.has(r.asset.id)) continue;
    seen.add(r.asset.id);
    out.push({ assetId: r.asset.id, role: "extra", label: `补充·${r.label}` });
  }
  for (const sr of project.styleRefs.slice(0, 2)) out.push({ assetId: sr.asset.id, role: "style", label: "画风参考" });
  return out;
}

const sig = (inputs: LineageInput[]) => inputs.map((i) => `${i.role}:${i.assetId ?? i.label}`);

/**
 * 同组锚点：本组里第一个已经出了首帧的镜头。
 *
 * 它的作用是场景连续性——同一场戏里课桌怎么排、黑板写什么、窗户在哪边、光从哪来，
 * 这些每张首帧都会各自发挥一遍，跨剪辑点就穿帮。全组都锚在同一张上（而不是各锚上一张）
 * 是刻意的：链式参考会让偏移逐镜累积，第三镜早就飘走了。
 */
export function frameAnchorIn(ctx: LineageContext, shot: { id: string; unitId: string | null; index: number }) {
  if (!shot.unitId) return null;
  const unit = ctx.units.find((u) => u.id === shot.unitId);
  // 只许往前找。往后找会让「组内第一镜」锚到它后面那一镜，而生成时第一镜最先跑、
  // 那会儿后面还没出图，跑完重算指纹就永远对不上——32 张图会一直显示过期、一直被重跑。
  const a = unit?.shots.find((s) => s.frameId && s.index < shot.index);
  return a?.frameId ? { shotId: a.id, index: a.index, frameId: a.frameId } : null;
}

/**
 * 承接上一镜：本镜前一镜（按 index）当前采用的成片。开着承接开关时，
 * 出首帧会把它的最后一帧截下来当参考图。指纹记的是那条成片的资产 id——
 * 上一镜换了版本，本镜首帧就该过期。
 */
export function prevVideoIn(ctx: LineageContext, shot: { id: string; index: number; usePrevLastFrame: boolean }) {
  if (!shot.usePrevLastFrame) return null;
  const prev = ctx.shots.filter((s) => s.index < shot.index && s.videoId).sort((a, b) => b.index - a.index)[0];
  return prev?.videoId ? { shotId: prev.id, index: prev.index, videoId: prev.videoId } : null;
}

/** 首帧：上一镜末帧 / 同组锚点 + 人设/道具/画风 + 首帧提示词 */
export function frameLineageIn(ctx: LineageContext, shotId: string) {
  const shot = ctx.shots.find((s) => s.id === shotId);
  if (!shot) throw new Error(`镜头不存在：${shotId}`);
  const inputs: LineageInput[] = [...refAssets(ctx, shot)];
  const prev = prevVideoIn(ctx, shot);
  if (prev) {
    inputs.push({ assetId: prev.videoId, role: "prev_video", label: `上一镜末帧 #${String(prev.index).padStart(2, "0")}` });
  } else {
    // 承接上一镜时它比同组锚点更精确（是真实成片的结束状态），两者取其一
    const anchor = frameAnchorIn(ctx, shot);
    if (anchor) inputs.push({ assetId: anchor.frameId, role: "anchor", label: `同组锚点 #${String(anchor.index).padStart(2, "0")}` });
  }
  return {
    inputs,
    hash: hash(["frame", shot.framePrompt, ctx.project.style, shot.frameMode, shot.frameQuality || ctx.project.imageQuality, ...sig(inputs)]),
  };
}

type KeyframeLike = { id: string; at: number; prompt: string; assetId: string | null };

export { orderKeyframes, keyframeLabel, videoRouteOf, type VideoRoute };

/**
 * 关键帧：本镜首帧是最重要的参考（同一镜头另一时刻的画面，场景光线服装都得跟它），
 * 再加人设/道具/场景/补充图与画风。指纹里含首帧资产 id——首帧重画了，关键帧就过期。
 */
export function keyframeLineageIn(ctx: LineageContext, shotId: string, keyframeId: string) {
  const shot = ctx.shots.find((s) => s.id === shotId);
  if (!shot) throw new Error(`镜头不存在：${shotId}`);
  const kf = shot.keyframes.find((k) => k.id === keyframeId);
  if (!kf) throw new Error(`关键帧不存在：${keyframeId}`);
  const inputs: LineageInput[] = [];
  if (shot.frameId) inputs.push({ assetId: shot.frameId, role: "frame", label: "本镜首帧" });
  inputs.push(...refAssets(ctx, shot));
  return {
    inputs,
    // 时间点不进这一帧的指纹：画面本身不因为挪了半秒而作废（上传的图更是）；它进视频指纹就够了
    hash: hash(["keyframe", kf.prompt, ctx.project.style, shot.frameQuality || ctx.project.imageQuality, ...sig(inputs)]),
  };
}

/** 视频：首帧（+ 关键帧）+ 视频提示词 + 时长/引擎/分辨率 + BGM 设置 */
export function videoLineageIn(ctx: LineageContext, shotId: string) {
  const shot = ctx.shots.find((s) => s.id === shotId);
  if (!shot) throw new Error(`镜头不存在：${shotId}`);
  const inputs: LineageInput[] = [];
  // 说书：页视频 = 页图 + 这一页的配音，没有视频提示词与关键帧那套
  if (ctx.project.kind === "narrated") {
    if (shot.frameId) inputs.push({ assetId: shot.frameId, role: "frame", label: "页图" });
    for (const u of shot.utterances) if (u.assetId) inputs.push({ assetId: u.assetId, role: "voice", label: u.kind === "narration" ? "旁白" : `台词 ${u.order + 1}` });
    return { inputs, hash: pageRenderHash(shot, ctx.project) };
  }
  if (shot.frameMode === "image" && shot.frameId) inputs.push({ assetId: shot.frameId, role: "frame", label: "首帧" });
  // 关键帧只在首帧模式下起作用；时间点与各段提示词也进指纹——挪了秒数或改了段提示词，视频就该重出
  const route = videoRouteOf(shot);
  const kfs = route === "i2v" ? [] : orderKeyframes(shot.keyframes.filter((k) => k.assetId));
  for (const k of kfs) inputs.push({ assetId: k.assetId!, role: "keyframe", label: keyframeLabel(k, shot.duration) });
  if (shot.frameMode === "text_only") inputs.push(...refAssets(ctx, shot).filter((x) => x.role !== "style"));
  if (shot.bgmToModel && shot.bgmTrack) inputs.push({ assetId: shot.bgmTrack.assetId, role: "bgm", label: shot.bgmTrack.name });
  return {
    inputs,
    hash: hash([
      "video",
      shot.videoPrompt,
      shot.duration,
      shot.frameMode,
      ctx.project.videoEngine,
      ctx.project.videoResolution,
      shot.bgmToModel ? shot.bgmTrackId : "",
      route,
      // 原文段落也送进了视频模型，但不进指纹：原文在拆镜之后基本不动，进了指纹只会让全片成片一夜之间全标过期
      ...kfs.map((k) => `${k.at}|${k.segmentPrompt}`),
      ...sig(inputs),
    ]),
  };
}

/* ------------------------------------------------------------------ *
 * 单点入口：任务处理器里一次只算一个，自己加载上下文
 * ------------------------------------------------------------------ */

export async function frameLineage(shotId: string) {
  const s = await db.shot.findUniqueOrThrow({ where: { id: shotId }, select: { chapterId: true } });
  const ctx = await loadLineageContext(s.chapterId);
  const shot = ctx.shots.find((x) => x.id === shotId)!;
  const prev = prevVideoIn(ctx, shot);
  return { ...frameLineageIn(ctx, shotId), anchor: prev ? null : frameAnchorIn(ctx, shot), prev };
}

export async function keyframeLineage(keyframeId: string) {
  const k = await db.keyframe.findUniqueOrThrow({ where: { id: keyframeId }, select: { shotId: true, shot: { select: { chapterId: true } } } });
  return keyframeLineageIn(await loadLineageContext(k.shot.chapterId), k.shotId, keyframeId);
}

export async function videoLineage(shotId: string) {
  const s = await db.shot.findUniqueOrThrow({ where: { id: shotId }, select: { chapterId: true } });
  return videoLineageIn(await loadLineageContext(s.chapterId), shotId);
}

/* ------------------------------------------------------------------ *
 * 新鲜度
 * ------------------------------------------------------------------ */

/** none 没有产物 | fresh 与当前输入一致 | stale 自身输入已变 */
export type Level = "none" | "fresh" | "stale";
export interface Freshness {
  frame: Level;
  video: Level;
  /** 每个关键帧自己的新鲜度，按 id */
  keyframes: Record<string, Level>;
}

export function chapterFreshnessIn(ctx: LineageContext): Record<string, Freshness> {
  const out: Record<string, Freshness> = {};
  for (const s of ctx.shots) {
    out[s.id] = {
      frame: !s.frameId ? "none" : s.frameInputHash === frameLineageIn(ctx, s.id).hash ? "fresh" : "stale",
      keyframes: Object.fromEntries(s.keyframes.map((k) => [k.id, !k.assetId ? "none" : k.inputHash === keyframeLineageIn(ctx, s.id, k.id).hash ? "fresh" : "stale"])),
      video: !s.videoId ? "none" : s.videoInputHash === videoLineageIn(ctx, s.id).hash ? "fresh" : "stale",
    };
  }
  return out;
}

export async function chapterFreshness(chapterId: string) {
  return chapterFreshnessIn(await loadLineageContext(chapterId));
}
