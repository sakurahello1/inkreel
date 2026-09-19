import { promises as fs } from "node:fs";
import { enqueue } from "../jobs";
import { db, parseJson } from "../db";
import { hash } from "../lineage";
import { absPath, assetUrl } from "../storage";
import { Service } from "./base";

/* ------------------------------------------------------------------ *
 * 说书模式：页 → 条（utterance）→ 配音 → 页视频
 * ------------------------------------------------------------------ */

export { PAGE_GAP, PAGE_LEAD, PAGE_TAIL } from "@/lib/narrated";

/** 一页的图和全部配音都齐了就渲染页视频。配音任务和出图任务谁最后到齐谁触发 */
export async function maybeRenderPage(shotId: string) {
  const shot = await db.shot.findUniqueOrThrow({ where: { id: shotId }, include: { utterances: true, chapter: { include: { project: { select: { kind: true } } } } } });
  if (shot.chapter.project.kind !== "narrated") return false;
  if (!shot.frameId) return false;
  if (!shot.utterances.length || shot.utterances.some((x) => x.status !== "ready" || !x.assetId)) return false;
  if (shot.status === "video_queued" || shot.status === "video_generating") return false;
  await db.shot.update({ where: { id: shotId }, data: { status: "video_queued" } });
  await enqueue("page.render", { shotId });
  return true;
}

export const TTS_MODEL = process.env.MINIMAX_TTS_MODEL || "speech-2.8-hd";
/** speech-2.8-hd $100 / 百万字；turbo $60 */
export const ttsCost = (chars: number) => Math.round(((chars * (TTS_MODEL.includes("turbo") ? 60 : 100)) / 1_000_000) * 10000) / 10000;

type DialogueItem = { characterId: string; line: string; tone?: string; expression?: string };

/**
 * 把一页的旁白 + 台词摊成要念的条。文本没变的条保留（连同已配好的音频），变了的重建。
 * 页编辑保存后调用；拆页之后也调用。
 */
export async function syncUtterances(shotId: string) {
  const shot = await db.shot.findUniqueOrThrow({ where: { id: shotId }, include: { utterances: { orderBy: { order: "asc" } } } });
  const want: Array<{ kind: "narration" | "line"; characterId: string | null; text: string; tone: string }> = [];
  if (shot.narration.trim()) want.push({ kind: "narration", characterId: null, text: shot.narration.trim(), tone: "" });
  for (const d of parseJson<DialogueItem[]>(shot.dialogue, [])) if (d.line.trim()) want.push({ kind: "line", characterId: d.characterId, text: d.line.trim(), tone: d.tone ?? "" });

  const pool = [...shot.utterances];
  const keep = new Set<string>();
  for (let i = 0; i < want.length; i++) {
    const w = want[i];
    const idx = pool.findIndex((u) => u.kind === w.kind && (u.characterId ?? null) === w.characterId && u.text === w.text);
    if (idx >= 0) {
      const u = pool.splice(idx, 1)[0];
      keep.add(u.id);
      if (u.order !== i || u.tone !== w.tone) await db.utterance.update({ where: { id: u.id }, data: { order: i, tone: w.tone } });
    } else {
      const row = await db.utterance.create({ data: { shotId, order: i, kind: w.kind, characterId: w.characterId, text: w.text, tone: w.tone } });
      keep.add(row.id);
    }
  }
  if (pool.length) await db.utterance.deleteMany({ where: { id: { in: pool.map((u) => u.id) } } });
  return want.length;
}

/** 一条配音的输入指纹：文本 + 音色 + 语速 + 情绪 + 模型 */
export const utteranceHash = (u: { text: string; voiceId: string; speed: number; emotion: string }) => hash(["tts", u.text, u.voiceId, u.speed, u.emotion, TTS_MODEL]);

export interface RoleStatus {
  key: string; // "narrator" | characterId
  name: string;
  description: string;
  lines: number;
  sampleLine: string;
  voiceId: string | null;
  voiceLabel: string;
  confirmed: boolean;
  candidates: Array<{ voiceId: string; name: string; reason: string; sampleUrl: string | null }>;
}

export class NarratedService extends Service {
  /* ---------------- 拆页 ---------------- */

  async runPages(chapterId: string, opts: { provider?: string; instruction?: string; sourceText?: string }) {
    if (opts.sourceText !== undefined) await this.db.chapter.update({ where: { id: chapterId }, data: { sourceText: opts.sourceText } });
    await this.db.chapter.update({ where: { id: chapterId }, data: { agentStatus: "running", agentError: "" } });
    await enqueue("chapter.pages", { chapterId, provider: opts.provider ?? "chat", instruction: opts.instruction ?? "" });
  }

  updateSettings(projectId: string, data: { presentStyle?: string; kenBurns?: number }) {
    return this.db.project.update({ where: { id: projectId }, data });
  }

  /* ---------------- 页 ---------------- */

  /** 编辑一页的旁白 / 台词 / 画面提示词。保存后重排它的条 */
  async updatePage(shotId: string, data: { narration?: string; dialogue?: DialogueItem[]; framePrompt?: string; scene?: string; characters?: Array<{ characterId: string; personaTag: string }> }) {
    const { dialogue, characters, ...rest } = data;
    await this.db.shot.update({
      where: { id: shotId },
      data: { ...rest, ...(dialogue ? { dialogue: JSON.stringify(dialogue) } : {}), ...(characters ? { characters: JSON.stringify(characters) } : {}), needsReview: false },
    });
    await syncUtterances(shotId);
  }

  updateUtterance(id: string, data: { emotion?: string; speed?: number; voiceId?: string }) {
    return this.db.utterance.update({ where: { id }, data });
  }

  /* ---------------- 选角 ---------------- */

  /** 项目里所有开口的角色 + 旁白，各自选角状态。UI 与闸门都看它 */
  async castingStatus(projectId: string): Promise<{ roles: RoleStatus[]; ready: boolean; running: boolean }> {
    const project = await this.db.project.findUniqueOrThrow({ where: { id: projectId }, include: { characters: { orderBy: { order: "asc" } } } });
    const utts = await this.db.utterance.findMany({ where: { shot: { chapter: { projectId } } }, orderBy: [{ shot: { index: "asc" } }, { order: "asc" }], select: { kind: true, characterId: true, text: true } });
    const roles: RoleStatus[] = [];
    const sampleOf = (list: string[]) => (list.find((t) => t.length >= 12 && t.length <= 40) ?? list[0] ?? "").slice(0, 40);
    const narr = utts.filter((u) => u.kind === "narration").map((u) => u.text);
    const candView = async (raw: string) => {
      const c = parseJson<Array<{ voiceId: string; name: string; reason: string; sampleAssetId?: string | null }>>(raw, []);
      const ids = c.map((x) => x.sampleAssetId).filter((x): x is string => Boolean(x));
      const assets = ids.length ? await this.db.asset.findMany({ where: { id: { in: ids } } }) : [];
      return c.map((x) => ({ voiceId: x.voiceId, name: x.name, reason: x.reason, sampleUrl: assetUrl(assets.find((a) => a.id === x.sampleAssetId)?.path) }));
    };
    if (narr.length) {
      roles.push({
        key: "narrator",
        name: "旁白",
        description: "叙述者：清晰、耐听、不抢戏",
        lines: narr.length,
        sampleLine: sampleOf(narr),
        voiceId: project.narratorVoiceId,
        voiceLabel: project.narratorVoiceLabel,
        confirmed: Boolean(project.narratorVoiceId && project.narratorConfirmedAt),
        candidates: await candView(project.narratorCandidates),
      });
    }
    for (const ch of project.characters) {
      const lines = utts.filter((u) => u.kind === "line" && u.characterId === ch.id).map((u) => u.text);
      if (!lines.length) continue;
      roles.push({
        key: ch.id,
        name: ch.name,
        description: [ch.age, ch.role, ch.personality].filter(Boolean).join("；"),
        lines: lines.length,
        sampleLine: sampleOf(lines),
        voiceId: ch.voiceSource === "minimax_system" ? ch.voiceId : null,
        voiceLabel: ch.voiceLabel,
        confirmed: Boolean(ch.voiceSource === "minimax_system" && ch.voiceId && ch.voiceConfirmedAt),
        candidates: await candView(ch.voiceCandidates),
      });
    }
    const running = Boolean(await this.db.generation.findFirst({ where: { kind: "cast", projectId, status: "running" } }));
    return { roles, ready: roles.length > 0 && roles.every((r) => r.confirmed), running };
  }

  /** 让 Agent 给每个角色挑候选并合成试听。跑完后人工在选角页确认 */
  async runCasting(projectId: string, provider?: string) {
    const st = await this.castingStatus(projectId);
    if (!st.roles.length) throw new Error("还没有可配音的内容：先拆页");
    if (st.running) throw new Error("选角正在进行");
    await enqueue("project.cast", { projectId, provider: provider ?? "chat" });
  }

  /** 人工确认某个角色用哪个音色 */
  async confirmVoice(projectId: string, roleKey: string, voiceId: string, label: string) {
    const now = new Date();
    if (roleKey === "narrator") {
      await this.db.project.update({ where: { id: projectId }, data: { narratorVoiceId: voiceId, narratorVoiceLabel: label, narratorConfirmedAt: now } });
      return;
    }
    const ch = await this.db.character.findUniqueOrThrow({ where: { id: roleKey } });
    const cand = parseJson<Array<{ voiceId: string; sampleAssetId?: string | null }>>(ch.voiceCandidates, []).find((c) => c.voiceId === voiceId);
    await this.db.character.update({
      where: { id: roleKey },
      data: { voiceSource: "minimax_system", voiceId, voiceLabel: `MiniMax · ${label}`, voiceConfirmedAt: now, voiceStatus: cand?.sampleAssetId ? "ready" : ch.voiceStatus, ...(cand?.sampleAssetId ? { voiceSampleId: cand.sampleAssetId, voiceError: "" } : {}) },
    });
  }

  async unconfirmVoice(projectId: string, roleKey: string) {
    if (roleKey === "narrator") await this.db.project.update({ where: { id: projectId }, data: { narratorConfirmedAt: null } });
    else await this.db.character.update({ where: { id: roleKey }, data: { voiceConfirmedAt: null } });
  }

  /* ---------------- 配音 ---------------- */

  /**
   * 给一章配音：闸门（选角全部确认）→ 找出需要（重）配的条 → 串行入队。
   * 每条配好后，任务自己判断所属页是否齐了、齐了就渲染页视频。
   */
  async generateChapterVoices(chapterId: string, opts: { force?: boolean; shotIds?: string[] } = {}) {
    const chapter = await this.db.chapter.findUniqueOrThrow({ where: { id: chapterId }, include: { project: { include: { characters: true } } } });
    const st = await this.castingStatus(chapter.projectId);
    if (!st.ready) throw new Error(`选角未完成：${st.roles.filter((r) => !r.confirmed).map((r) => r.name).join("、")} 还没确认音色`);
    const utts = await this.db.utterance.findMany({
      where: { shot: { chapterId, ...(opts.shotIds?.length ? { id: { in: opts.shotIds } } : {}) } },
      include: { shot: true },
      orderBy: [{ shot: { index: "asc" } }, { order: "asc" }],
    });
    const project = chapter.project;
    const ids: string[] = [];
    for (const u of utts) {
      const ch = u.characterId ? project.characters.find((c) => c.id === u.characterId) : null;
      const voiceId = u.voiceId || (u.kind === "narration" ? project.narratorVoiceId ?? "" : ch?.voiceId ?? "");
      const speed = u.speed !== 1 ? u.speed : ch?.voiceSpeed ?? 1;
      const emotion = u.emotion || ch?.voiceEmotion || "";
      if (!voiceId) continue;
      const h = utteranceHash({ text: u.text, voiceId, speed, emotion });
      if (!opts.force && u.status === "ready" && u.assetId && u.inputHash === h) continue;
      await this.db.utterance.update({ where: { id: u.id }, data: { status: "generating", error: "" } });
      ids.push(u.id);
    }
    if (!ids.length) return 0;
    const [head, ...rest] = ids;
    await enqueue("utterance.tts", { utteranceId: head, rest });
    return ids.length;
  }

  /** 单条重配（比如改了语气） */
  async generateUtterance(id: string) {
    await this.db.utterance.update({ where: { id }, data: { status: "generating", error: "" } });
    await enqueue("utterance.tts", { utteranceId: id, rest: [] });
  }

  /** 渲染页视频（图 + 配音）。配音齐了才能渲染 */
  async renderPages(chapterId: string, shotIds?: string[]) {
    const shots = await this.db.shot.findMany({ where: { chapterId, ...(shotIds?.length ? { id: { in: shotIds } } : {}) }, include: { utterances: true }, orderBy: { index: "asc" } });
    let n = 0;
    for (const s of shots) {
      if (!s.frameId) continue;
      if (s.utterances.some((u) => u.status !== "ready" || !u.assetId)) continue;
      await this.db.shot.update({ where: { id: s.id }, data: { status: "video_queued", reviewNote: "" } });
      await enqueue("page.render", { shotId: s.id });
      n += 1;
    }
    return n;
  }

  /** 删掉某条的音频文件（弃用重来时） */
  async dropAudio(assetId: string) {
    const a = await this.db.asset.findUnique({ where: { id: assetId } });
    if (!a) return;
    const used = await this.db.utterance.count({ where: { assetId } });
    if (used) return;
    await this.db.asset.delete({ where: { id: assetId } }).catch(() => {});
    await fs.rm(absPath(a.path), { force: true }).catch(() => {});
  }
}
