import { db, parseJson } from "./db";
import { assetUrl } from "./storage";
import { splitParagraphs } from "./agent/storyboard";
import { chapterFreshnessIn, loadLineageContext, frameLineageIn, videoLineageIn, videoRouteOf, orderKeyframes, type Freshness } from "./lineage";
import { estimateVideoCost, minSegmentSeconds } from "./providers/video";
import type { Chapter, Character, GenStatus, Project, Prop, Scene, Shot, ShotStatus } from "@/lib/types";

function fmt(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const characterInclude = {
  personas: { include: { sheet: true }, orderBy: { order: "asc" as const } },
  voiceSample: true,
};

type CharRow = NonNullable<Awaited<ReturnType<typeof db.character.findFirst<{ include: typeof characterInclude }>>>>;

function characterView(c: CharRow): Character {
  return {
    id: c.id,
    name: c.name,
    age: c.age,
    role: c.role,
    personality: c.personality,
    catchphrase: c.catchphrase,
    relations: c.relations,
    personas: c.personas.map((p) => ({
      id: p.id,
      tag: p.tag,
      description: p.description,
      prompt: p.prompt,
      sheetReady: Boolean(p.sheet),
      sheetUrl: assetUrl(p.sheet?.path),
      status: p.status as Character["personas"][number]["status"],
      error: p.error,
    })),
    voice: {
      source: c.voiceSource as Character["voice"]["source"],
      label: c.voiceLabel,
      voiceId: c.voiceId,
      sampleReady: Boolean(c.voiceSample),
      sampleUrl: assetUrl(c.voiceSample?.path),
      status: c.voiceStatus as Character["voice"]["status"],
      error: c.voiceError,
    },
  };
}

const shotInclude = {
  frame: true,
  keyframes: { include: { asset: true } },
  video: true,
  bgmTrack: true,
  extraRefs: { include: { asset: true }, orderBy: { order: "asc" as const } },
  generations: { orderBy: { createdAt: "desc" as const }, take: 8 },
};

const propInclude = { sheet: true };
type PropRow = { id: string; name: string; description: string; prompt: string; sheet: { path: string } | null; status: string; error: string };
function propView(p: PropRow): Prop {
  return { id: p.id, name: p.name, description: p.description, prompt: p.prompt, sheetUrl: assetUrl(p.sheet?.path), status: p.status as GenStatus, error: p.error };
}

const sceneInclude = { sheet: true };
type SceneRow = PropRow;
function sceneView(s: SceneRow): Scene {
  return { id: s.id, name: s.name, description: s.description, prompt: s.prompt, sheetUrl: assetUrl(s.sheet?.path), status: s.status as GenStatus, error: s.error };
}

const bgmInclude = { asset: true };
type BgmRow = { id: string; name: string; mood: string; description: string; volume: number; asset: { path: string; duration: number | null } };
function bgmView(t: BgmRow) {
  return { id: t.id, name: t.name, mood: t.mood, description: t.description, volume: t.volume, url: assetUrl(t.asset.path) ?? "", duration: t.asset.duration };
}

type ShotRow = NonNullable<Awaited<ReturnType<typeof db.shot.findFirst<{ include: typeof shotInclude }>>>>;

function shotView(s: ShotRow, extra?: { freshness?: Freshness; lineage?: Shot["lineage"] }): Shot {
  return {
    id: s.id,
    index: s.index,
    unitId: s.unitId ?? "",
    scene: s.scene,
    shotSize: s.shotSize as Shot["shotSize"],
    camera: s.camera,
    duration: s.duration,
    characters: parseJson(s.characters, []),
    dialogue: parseJson(s.dialogue, []),
    emotion: s.emotion,
    action: s.action,
    sound: s.sound,
    framePrompt: s.framePrompt,
    videoPrompt: s.videoPrompt,
    frameMode: s.frameMode as Shot["frameMode"],
    status: s.status as ShotStatus,
    needsReview: s.needsReview,
    reviewNote: s.reviewNote,
    rewriting: s.rewriting,
    cost: s.cost,
    frameUrl: assetUrl(s.frame?.path),
    previzGenerationId: s.previzGenerationId,
    previzTime: s.previzTime,
    keyframes: orderKeyframes(s.keyframes).map((k) => ({ id: k.id, at: k.at, prompt: k.prompt, segmentPrompt: k.segmentPrompt, url: assetUrl(k.asset?.path), freshness: extra?.freshness?.keyframes[k.id] })),
    videoRoute: videoRouteOf(s),
    videoUrl: assetUrl(s.video?.path),
    videoDuration: s.video?.duration ?? null,
    bgmTrackId: s.bgmTrackId,
    bgmTrackName: s.bgmTrack?.name ?? null,
    bgmToModel: s.bgmToModel,
    propIds: parseJson<string[]>(s.props, []),
    sceneId: s.sceneId,
    usePrevLastFrame: s.usePrevLastFrame,
    frameQuality: s.frameQuality,
    extraRefs: s.extraRefs.map((r) => ({ id: r.id, label: r.label, url: assetUrl(r.asset.path) })),
    clip: {
      order: s.clipOrder, in: s.clipIn, out: s.clipOut, enabled: s.clipEnabled, subtitle: s.clipSubtitle, fadeIn: s.fadeIn, fadeOut: s.fadeOut,
      cues: parseJson<Array<{ text: string; start: number; end: number }>>(s.subtitleCues, []),
      asrText: s.asrText.includes("|") ? s.asrText.slice(s.asrText.indexOf("|") + 1) : s.asrText,
      asrFresh: Boolean(s.videoId) && s.asrText.startsWith(`${s.videoId}|`),
    },
    freshness: extra?.freshness,
    lineage: extra?.lineage,
    generations: s.generations.map((g) => ({
      id: g.id,
      kind: g.kind,
      keyframeId: g.keyframeId,
      model: g.model,
      status: g.status,
      progress: g.progress,
      error: g.error,
      cost: g.cost,
      createdAt: fmt(g.createdAt),
    })),
  };
}

export async function listProjects(): Promise<Project[]> {
  const rows = await db.project.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      styleRefs: true,
      bgmTracks: { include: bgmInclude, orderBy: { order: "asc" } },
      props: { include: propInclude, orderBy: { order: "asc" } },
      scenes: { include: sceneInclude, orderBy: { order: "asc" } },
      characters: { include: characterInclude, orderBy: { order: "asc" } },
      chapters: { include: { shots: { select: { status: true, duration: true, cost: true } } }, orderBy: { index: "asc" } },
    },
  });
  return rows.map((p) => ({
    id: p.id,
    title: p.title,
    genre: p.genre ? p.genre.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [],
    orientation: p.orientation as Project["orientation"],
    targetEpisodes: p.targetEpisodes,
    world: p.world,
    style: p.style,
    styleRefs: p.styleRefs.length,
    videoEngine: p.videoEngine,
    videoResolution: p.videoResolution,
    imageQuality: p.imageQuality,
    textOnlyRefs: p.textOnlyRefs,
    minSegmentSeconds: minSegmentSeconds(),
    videoPerSecond: Math.round((estimateVideoCost(10, "h3", p.videoResolution || "768P", "i2v") / 10) * 1000) / 1000,
    bgmTracks: p.bgmTracks.map(bgmView),
    props: p.props.map(propView),
    scenes: p.scenes.map(sceneView),
    characters: p.characters.map(characterView),
    chapters: p.chapters.map((c) => ({
      id: c.id,
      index: c.index,
      title: c.title,
      sourceText: [],
      units: [],
      shots: c.shots.map((s) => ({ status: s.status, duration: s.duration, cost: s.cost }) as unknown as Shot),
      updatedAt: fmt(c.updatedAt),
    })),
    updatedAt: fmt(p.updatedAt),
  }));
}

export async function getProjectView(id: string): Promise<Project | null> {
  const p = await db.project.findUnique({
    where: { id },
    include: {
      styleRefs: { include: { asset: true }, orderBy: { order: "asc" } },
      bgmTracks: { include: bgmInclude, orderBy: { order: "asc" } },
      props: { include: propInclude, orderBy: { order: "asc" } },
      scenes: { include: sceneInclude, orderBy: { order: "asc" } },
      characters: { include: characterInclude, orderBy: { order: "asc" } },
      chapters: {
        include: { export: true, units: { orderBy: { index: "asc" as const } }, shots: { include: shotInclude, orderBy: { index: "asc" } } },
        orderBy: { index: "asc" },
      },
    },
  });
  if (!p) return null;
  return {
    id: p.id,
    title: p.title,
    genre: p.genre ? p.genre.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [],
    orientation: p.orientation as Project["orientation"],
    targetEpisodes: p.targetEpisodes,
    world: p.world,
    style: p.style,
    styleRefs: p.styleRefs.length,
    videoEngine: p.videoEngine,
    videoResolution: p.videoResolution,
    imageQuality: p.imageQuality,
    textOnlyRefs: p.textOnlyRefs,
    minSegmentSeconds: minSegmentSeconds(),
    videoPerSecond: Math.round((estimateVideoCost(10, "h3", p.videoResolution || "768P", "i2v") / 10) * 1000) / 1000,
    styleRefItems: p.styleRefs.map((r) => ({ id: r.id, url: assetUrl(r.asset.path) ?? "" })),
    bgmTracks: p.bgmTracks.map(bgmView),
    props: p.props.map(propView),
    scenes: p.scenes.map(sceneView),
    characters: p.characters.map(characterView),
    chapters: await Promise.all(p.chapters.map(async (c) => chapterView(c, await chapterExtras(c.id)))),
    updatedAt: fmt(p.updatedAt),
  };
}

type ChapterRow = {
  id: string;
  index: number;
  title: string;
  sourceText: string;
  agentStatus: string;
  agentError: string;
  updatedAt: Date;
  bgmVolume: number;
  subtitles: boolean;
  exportStatus: string;
  exportError: string;
  export?: { path: string; duration: number | null } | null;
  units: Array<{ id: string; index: number; summary: string; paraStart: number; paraEnd: number }>;
  shots: ShotRow[];
};

function chapterView(c: ChapterRow, fx?: { fresh: Record<string, Freshness>; lineage: Record<string, Shot["lineage"]> }): Chapter {
  return {
    id: c.id,
    index: c.index,
    title: c.title,
    sourceText: splitParagraphs(c.sourceText),
    units: c.units.map((u) => ({
      id: u.id,
      index: u.index,
      summary: u.summary,
      sourceRange: [u.paraStart, u.paraEnd] as [number, number],
    })),
    shots: c.shots.map((s) => shotView(s, { freshness: fx?.fresh[s.id], lineage: fx?.lineage[s.id] })),
    updatedAt: fmt(c.updatedAt),
    agentStatus: c.agentStatus as Chapter["agentStatus"],
    agentError: c.agentError,
    timeline: {
      bgmVolume: c.bgmVolume,
      subtitles: c.subtitles,
      exportUrl: assetUrl(c.export?.path),
      exportStatus: c.exportStatus as NonNullable<Chapter["timeline"]>["exportStatus"],
      exportError: c.exportError,
      exportDuration: c.export?.duration ?? null,
    },
  };
}

/** 算出整章每一镜的新鲜度与血缘，一次加载，避免逐镜重查项目图 */
async function chapterExtras(chapterId: string) {
  const ctx = await loadLineageContext(chapterId);
  const fresh = chapterFreshnessIn(ctx);
  const lineage: Record<string, Shot["lineage"]> = {};
  for (const s of ctx.shots) {
    lineage[s.id] = {
      frame: frameLineageIn(ctx, s.id).inputs,
      video: videoLineageIn(ctx, s.id).inputs,
    };
  }
  return { fresh, lineage };
}

export async function getChapterView(projectId: string, chapterId: string): Promise<Chapter | null> {
  const c = await db.chapter.findFirst({
    where: { id: chapterId, projectId },
    include: { export: true, units: { orderBy: { index: "asc" as const } }, shots: { include: shotInclude, orderBy: { index: "asc" } } },
  });
  return c ? chapterView(c, await chapterExtras(c.id)) : null;
}

export async function monthlySpend() {
  const since = new Date();
  since.setDate(1);
  since.setHours(0, 0, 0, 0);
  const rows = await db.generation.groupBy({ by: ["kind"], where: { createdAt: { gte: since }, status: "success" }, _sum: { cost: true } });
  const by: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    by[r.kind] = r._sum.cost ?? 0;
    total += r._sum.cost ?? 0;
  }
  return { total, by };
}
