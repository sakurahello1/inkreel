"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { BgmService, CharacterService, ProjectService, PropService, SceneService } from "./services/asset-services";
import { ChapterService, ShotService, TimelineService, VersionService } from "./services/shot-service";
import { PrevizService } from "./services/previz-service";
import { SubtitleService } from "./services/subtitle-service";
import type { ChatProviderName } from "./providers/chat";
import type { FrameMode } from "@/lib/types";

/**
 * Next server action 门面。
 *
 * 这一层刻意保持很薄：每个函数只做「转调服务 + 失效对应页面缓存」。
 * 业务逻辑一律住在 services/ 里，那些类不依赖 Next，可以单独跑单独测。
 * 之所以还需要这个文件，是因为 Next 要求客户端组件调用的 action 必须是
 * 从带 "use server" 的模块里导出的异步函数。
 */

const projects = new ProjectService();
const characters = new CharacterService();
const props = new PropService();
const scenes = new SceneService();
const bgm = new BgmService();
const chapters = new ChapterService();
const shots = new ShotService();
const timeline = new TimelineService();
const versions = new VersionService();
const previz = new PrevizService();
const subtitles = new SubtitleService();

/* ---------------- 缓存失效目标 ---------------- */

const P = (id: string) => `/projects/${id}`;
const paths = {
  world: (p: string) => `${P(p)}/world`,
  settings: (p: string) => `${P(p)}/settings`,
  characters: (p: string) => `${P(p)}/characters`,
  props: (p: string) => `${P(p)}/props`,
  scenes: (p: string) => `${P(p)}/scenes`,
  music: (p: string) => `${P(p)}/music`,
  chapters: (p: string) => `${P(p)}/chapters`,
  chapter: (p: string, c: string) => `${P(p)}/chapters/${c}`,
  timeline: (p: string) => `${P(p)}/timeline`,
};

/* ---------------- 项目 ---------------- */

export async function createProject(form: FormData) {
  const p = await projects.create(String(form.get("title") || ""));
  revalidatePath("/");
  redirect(paths.world(p.id));
}

export async function updateProjectBasics(projectId: string, data: { title?: string; genre?: string; orientation?: string; targetEpisodes?: number }) {
  await projects.updateBasics(projectId, data);
  revalidatePath(P(projectId), "layout");
}

export async function updateVideoEngine(projectId: string, data: { videoEngine?: string; videoResolution?: string; imageQuality?: string; textOnlyRefs?: boolean }) {
  await projects.updateVideoEngine(projectId, data);
  revalidatePath(paths.settings(projectId));
}

export async function uploadShotFrame(projectId: string, chapterId: string, shotId: string, form: FormData) {
  await shots.uploadFrame(projectId, shotId, form);
  revalidatePath(paths.chapter(projectId, chapterId));
}

export async function useShotPrevLastFrame(projectId: string, chapterId: string, shotId: string) {
  const r = await shots.usePrevLastFrameAsFrame(projectId, shotId);
  revalidatePath(paths.chapter(projectId, chapterId));
  return r;
}

export async function addShotKeyframe(projectId: string, chapterId: string, shotId: string, at: number) {
  const id = await shots.addKeyframe(shotId, at);
  revalidatePath(paths.chapter(projectId, chapterId));
  return id;
}

export async function updateShotKeyframe(projectId: string, chapterId: string, keyframeId: string, data: { at?: number; prompt?: string; segmentPrompt?: string }) {
  await shots.updateKeyframe(keyframeId, data);
  revalidatePath(paths.chapter(projectId, chapterId));
}

export async function removeShotKeyframe(projectId: string, chapterId: string, keyframeId: string) {
  await shots.removeKeyframe(keyframeId);
  revalidatePath(paths.chapter(projectId, chapterId));
}

export async function generateShotKeyframe(projectId: string, chapterId: string, keyframeId: string) {
  await shots.generateKeyframe(keyframeId);
  revalidatePath(paths.chapter(projectId, chapterId));
}

export async function generateShotKeyframes(projectId: string, chapterId: string, shotId: string) {
  const n = await shots.generateKeyframes(shotId);
  revalidatePath(paths.chapter(projectId, chapterId));
  return n;
}

export async function uploadShotKeyframe(projectId: string, chapterId: string, keyframeId: string, form: FormData) {
  await shots.uploadKeyframe(projectId, keyframeId, form);
  revalidatePath(paths.chapter(projectId, chapterId));
}

export async function useShotNextFirstFrame(projectId: string, chapterId: string, shotId: string) {
  const r = await shots.useNextFirstFrameAsEnd(shotId);
  revalidatePath(paths.chapter(projectId, chapterId));
  return r;
}

export async function listKeyframeVersions(keyframeId: string) {
  return versions.listForKeyframe(keyframeId);
}

export async function addShotExtraRef(projectId: string, chapterId: string, shotId: string, form: FormData, label: string) {
  await shots.addExtraRef(projectId, shotId, form, label);
  revalidatePath(paths.chapter(projectId, chapterId));
}

export async function labelShotExtraRef(projectId: string, chapterId: string, refId: string, label: string) {
  await shots.labelExtraRef(refId, label);
  revalidatePath(paths.chapter(projectId, chapterId));
}

export async function removeShotExtraRef(projectId: string, chapterId: string, refId: string) {
  await shots.removeExtraRef(refId);
  revalidatePath(paths.chapter(projectId, chapterId));
}

export async function setShotFrameQuality(projectId: string, chapterId: string, shotId: string, quality: string) {
  await shots.setFrameQuality(shotId, quality);
  revalidatePath(paths.chapter(projectId, chapterId));
}

export async function updateProjectWorld(projectId: string, data: { world?: string; style?: string }) {
  await projects.updateWorld(projectId, data);
  revalidatePath(paths.world(projectId));
}

export async function addStyleRef(projectId: string, form: FormData) {
  await projects.addStyleRef(projectId, form);
  revalidatePath(paths.world(projectId));
}

export async function removeStyleRef(projectId: string, styleRefId: string) {
  await projects.removeStyleRef(styleRefId);
  revalidatePath(paths.world(projectId));
}

/* ---------------- 人物 ---------------- */

export async function createCharacter(projectId: string, name: string) {
  const id = await characters.create(projectId, name);
  revalidatePath(paths.characters(projectId));
  return id;
}

export async function updateCharacter(
  projectId: string,
  characterId: string,
  data: { name?: string; age?: string; role?: string; personality?: string; catchphrase?: string; relations?: string },
) {
  await characters.update(characterId, data);
  revalidatePath(paths.characters(projectId));
}

export async function deleteCharacter(projectId: string, characterId: string) {
  await characters.remove(characterId);
  revalidatePath(paths.characters(projectId));
}

export async function createPersona(projectId: string, characterId: string, data: { tag: string; description: string }) {
  const id = await characters.createPersona(characterId, data);
  revalidatePath(paths.characters(projectId));
  return id;
}

export async function updatePersona(projectId: string, personaId: string, data: { tag?: string; description?: string; prompt?: string }) {
  await characters.updatePersona(personaId, data);
  revalidatePath(paths.characters(projectId));
}

export async function deletePersona(projectId: string, personaId: string) {
  await characters.removePersona(personaId);
  revalidatePath(paths.characters(projectId));
}

export async function generatePersonaSheet(projectId: string, personaId: string) {
  await characters.generateSheet(personaId);
  revalidatePath(paths.characters(projectId));
}

export async function uploadPersonaSheet(projectId: string, personaId: string, form: FormData) {
  await characters.uploadSheet(projectId, personaId, form);
  revalidatePath(paths.characters(projectId));
}

export async function getVoiceOptions() {
  return characters.voiceOptions();
}

export async function setCharacterSystemVoice(projectId: string, characterId: string, voiceId: string, label: string) {
  await characters.useSystemVoice(characterId, voiceId, label);
  revalidatePath(paths.characters(projectId));
}

export async function uploadCharacterVoice(projectId: string, characterId: string, form: FormData) {
  await characters.uploadVoice(projectId, characterId, form);
  revalidatePath(paths.characters(projectId));
}

/* ---------------- 道具 ---------------- */

export async function createProp(projectId: string, data: { name: string; description: string }) {
  const id = await props.create(projectId, data);
  revalidatePath(paths.props(projectId));
  return id;
}

export async function updateProp(projectId: string, propId: string, data: { name?: string; description?: string; prompt?: string }) {
  await props.update(propId, data);
  revalidatePath(paths.props(projectId));
}

export async function deleteProp(projectId: string, propId: string) {
  await props.remove(propId);
  revalidatePath(paths.props(projectId));
}

export async function generatePropSheet(projectId: string, propId: string) {
  await props.generateSheet(propId);
  revalidatePath(paths.props(projectId));
}

export async function uploadPropSheet(projectId: string, propId: string, form: FormData) {
  await props.uploadSheet(projectId, propId, form);
  revalidatePath(paths.props(projectId));
}

/* ---------------- 场景库 ---------------- */

export async function createScene(projectId: string, data: { name: string; description: string }) {
  const id = await scenes.create(projectId, data);
  revalidatePath(paths.scenes(projectId));
  return id;
}

export async function updateScene(projectId: string, sceneId: string, data: { name?: string; description?: string; prompt?: string }) {
  await scenes.update(sceneId, data);
  revalidatePath(paths.scenes(projectId));
}

export async function deleteScene(projectId: string, sceneId: string) {
  await scenes.remove(sceneId);
  revalidatePath(paths.scenes(projectId));
}

export async function generateSceneSheet(projectId: string, sceneId: string) {
  await scenes.generateSheet(sceneId);
  revalidatePath(paths.scenes(projectId));
}

export async function uploadSceneSheet(projectId: string, sceneId: string, form: FormData) {
  await scenes.uploadSheet(projectId, sceneId, form);
  revalidatePath(paths.scenes(projectId));
}

export async function setShotUsePrevLastFrame(projectId: string, chapterId: string, shotId: string, on: boolean) {
  await shots.setUsePrevLastFrame(shotId, on);
  revalidatePath(paths.chapter(projectId, chapterId));
}

export async function setShotScene(projectId: string, chapterId: string, shotId: string, sceneId: string | null) {
  await shots.setScene(shotId, sceneId);
  revalidatePath(paths.chapter(projectId, chapterId));
}

export async function setShotProps(projectId: string, chapterId: string, shotId: string, propIds: string[]) {
  await shots.setProps(shotId, propIds);
  revalidatePath(paths.chapter(projectId, chapterId));
}

/* ---------------- 章节与分镜组 ---------------- */

export async function createChapter(projectId: string, title: string) {
  const c = await chapters.create(projectId, title);
  revalidatePath(paths.chapters(projectId));
  redirect(paths.chapter(projectId, c.id));
}

export async function updateChapter(projectId: string, chapterId: string, data: { title?: string; sourceText?: string }) {
  await chapters.update(chapterId, data);
  revalidatePath(paths.chapter(projectId, chapterId));
}

export async function runStoryboard(projectId: string, chapterId: string, opts: { provider?: ChatProviderName; instruction?: string; sourceText?: string }) {
  await chapters.runStoryboard(chapterId, opts);
  revalidatePath(paths.chapter(projectId, chapterId));
}

/* ---------------- 镜头 ---------------- */

export async function updateShot(
  projectId: string,
  chapterId: string,
  shotId: string,
  data: {
    scene?: string;
    shotSize?: string;
    camera?: string;
    duration?: number;
    emotion?: string;
    action?: string;
    sound?: string;
    framePrompt?: string;
    videoPrompt?: string;
    characters?: Array<{ characterId: string; personaTag: string }>;
    dialogue?: Array<{ characterId: string; line: string; tone: string }>;
  },
) {
  await shots.update(shotId, data);
  revalidatePath(paths.chapter(projectId, chapterId));
}

export async function setFrameMode(projectId: string, chapterId: string, shotIds: string[], mode: FrameMode) {
  await shots.setFrameMode(shotIds, mode);
  revalidatePath(paths.chapter(projectId, chapterId));
}

export async function approveStoryboard(projectId: string, chapterId: string, shotIds: string[]) {
  await shots.approveStoryboard(shotIds);
  revalidatePath(paths.chapter(projectId, chapterId));
}

export async function generateFrames(projectId: string, chapterId: string, shotIds: string[]) {
  const n = await shots.generateFrames(shotIds);
  revalidatePath(paths.chapter(projectId, chapterId));
  return n;
}

export async function approveFrames(projectId: string, chapterId: string, shotIds: string[]) {
  await shots.approveFrames(shotIds);
  revalidatePath(paths.chapter(projectId, chapterId));
}

export async function generateVideos(projectId: string, chapterId: string, shotIds: string[]) {
  const n = await shots.generateVideos(shotIds);
  revalidatePath(paths.chapter(projectId, chapterId));
  return n;
}

export async function generateVideoVersion(projectId: string, chapterId: string, shotId: string, keepCurrent: boolean) {
  await shots.generateVideoVersion(shotId, keepCurrent);
  revalidatePath(paths.chapter(projectId, chapterId));
}

export async function regenerateVideo(projectId: string, chapterId: string, shotId: string, instruction: string) {
  await shots.regenerateVideo(shotId, instruction);
  revalidatePath(paths.chapter(projectId, chapterId));
}

export async function acceptVideos(projectId: string, chapterId: string, shotIds: string[]) {
  await shots.acceptVideos(shotIds);
  revalidatePath(paths.chapter(projectId, chapterId));
}

export async function revertShot(projectId: string, chapterId: string, shotId: string) {
  await shots.revert(shotId);
  revalidatePath(paths.chapter(projectId, chapterId));
}

export async function deleteShot(projectId: string, chapterId: string, shotId: string) {
  await shots.remove(chapterId, shotId);
  revalidatePath(paths.chapter(projectId, chapterId));
}

export async function addShotAfter(projectId: string, chapterId: string, afterShotId: string | null) {
  const id = await shots.addAfter(chapterId, afterShotId);
  revalidatePath(paths.chapter(projectId, chapterId));
  return id;
}

/* ---------------- 预演 ---------------- */

export async function createPreviz(projectId: string, chapterId: string, opts: { shotIds?: string[]; slotSeconds?: number; resolution?: string }) {
  const r = await previz.create(chapterId, opts);
  revalidatePath(paths.chapter(projectId, chapterId));
  return r;
}

export async function listPreviz(chapterId: string) {
  return previz.list(chapterId);
}

export async function estimatePreviz(shotCount: number, slotSeconds: number, resolution: string) {
  return previz.estimate(shotCount, slotSeconds, resolution);
}

export async function adoptPrevizFrame(projectId: string, chapterId: string, generationId: string, shotId: string, t: number) {
  const r = await previz.adoptFrame(generationId, shotId, t);
  revalidatePath(paths.chapter(projectId, chapterId));
  return r;
}

export async function discardPreviz(projectId: string, chapterId: string, generationId: string) {
  await previz.discard(generationId);
  revalidatePath(paths.chapter(projectId, chapterId));
}

export async function createTransitionShot(projectId: string, chapterId: string, afterShotId: string) {
  const id = await shots.createTransition(chapterId, afterShotId);
  revalidatePath(paths.chapter(projectId, chapterId));
  return id;
}

export async function mergeShotWithNext(projectId: string, chapterId: string, shotId: string) {
  const r = await shots.mergeWithNext(chapterId, shotId);
  revalidatePath(paths.chapter(projectId, chapterId));
  return r;
}

export async function splitShot(projectId: string, chapterId: string, shotId: string) {
  await shots.split(chapterId, shotId);
  revalidatePath(paths.chapter(projectId, chapterId));
}

export async function rewriteShot(projectId: string, chapterId: string, shotId: string, instruction: string, provider: ChatProviderName = "chat") {
  await shots.rewrite(shotId, instruction, provider);
  revalidatePath(paths.chapter(projectId, chapterId));
}

export async function shotSummaryForAgent(shotId: string) {
  return shots.summaryForAgent(shotId);
}

/* ---------------- 时间线与导出 ---------------- */

export async function updateClip(
  projectId: string,
  chapterId: string,
  shotId: string,
  data: { clipIn?: number; clipOut?: number | null; clipEnabled?: boolean; clipSubtitle?: string; fadeIn?: number; fadeOut?: number },
) {
  await timeline.updateClip(shotId, data);
  revalidatePath(paths.timeline(projectId));
}

export async function moveClip(projectId: string, chapterId: string, shotId: string, dir: -1 | 1) {
  await timeline.moveClip(chapterId, shotId, dir);
  revalidatePath(paths.timeline(projectId));
}

export async function updateChapterTimeline(projectId: string, chapterId: string, data: { bgmVolume?: number; subtitles?: boolean }) {
  await chapters.updateTimeline(chapterId, data);
  revalidatePath(paths.timeline(projectId));
}

/** 把整章台词对到真正说话的时间上（Whisper 字级时间戳）。返回每镜识别出的话，念错的能看出来 */
export async function alignChapterSubtitles(projectId: string, chapterId: string, force = false) {
  const r = await subtitles.alignChapter(chapterId, { force });
  revalidatePath(paths.timeline(projectId));
  return r;
}

export async function exportChapter(projectId: string, chapterId: string) {
  await chapters.export(chapterId);
  revalidatePath(paths.timeline(projectId));
}

/* ---------------- 音乐库 ---------------- */

export async function addBgmTrack(projectId: string, form: FormData) {
  const id = await bgm.add(projectId, form);
  revalidatePath(paths.music(projectId));
  return id;
}

export async function updateBgmTrack(projectId: string, trackId: string, data: { name?: string; mood?: string; description?: string; volume?: number }) {
  await bgm.update(trackId, data);
  revalidatePath(paths.music(projectId));
  revalidatePath(paths.timeline(projectId));
}

export async function deleteBgmTrack(projectId: string, trackId: string) {
  await bgm.remove(trackId);
  revalidatePath(paths.music(projectId));
  revalidatePath(paths.timeline(projectId));
}

export async function setShotBgmToModel(projectId: string, chapterId: string, shotIds: string[], on: boolean) {
  await bgm.setSendToModel(chapterId, shotIds, on);
  revalidatePath(paths.chapter(projectId, chapterId));
}

export async function setShotBgm(projectId: string, chapterId: string, shotIds: string[], trackId: string | null) {
  await bgm.assign(chapterId, shotIds, trackId);
  revalidatePath(paths.chapter(projectId, chapterId));
  revalidatePath(paths.timeline(projectId));
}

/* ---------------- 版本与血缘 ---------------- */

export async function useGenerationResult(projectId: string, chapterId: string, generationId: string) {
  await versions.use(generationId);
  revalidatePath(paths.chapter(projectId, chapterId));
}

export async function labelVersion(projectId: string, chapterId: string, generationId: string, label: string) {
  await versions.label(generationId, label);
  revalidatePath(paths.chapter(projectId, chapterId));
}

export async function discardVersion(projectId: string, chapterId: string, generationId: string) {
  await versions.discard(generationId);
  revalidatePath(paths.chapter(projectId, chapterId));
}

export async function listVersions(shotId: string, kind: "frame" | "video") {
  return versions.listForShot(shotId, kind);
}

export async function rerunFrom(projectId: string, chapterId: string, shotId: string, from: "frame" | "video") {
  await versions.rerunFrom(shotId, from);
  revalidatePath(paths.chapter(projectId, chapterId));
}
