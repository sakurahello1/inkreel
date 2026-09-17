import { db, parseJson } from "../db";
import { Job, errText } from "../core/job";
import { saveAssetFromUrl, toDataUrlResized } from "../storage";
import { createVideoTask, estimateVideoCost, queryVideoTask, videoBackend, videoModelFor } from "../providers/video";
import { previzPrompt } from "../prompts";
import type { RefImage } from "@/lib/keyframes";
import { enqueue } from "./runner";
import { VIDEO_MAX_WAIT_MS, VIDEO_POLL_MS } from "./sizes";

/** 一个预演任务：Generation(kind=previz) 在服务层建好、把分镜格子写进 params，这里只负责拼参考图和提示词并提交 */
type SubmitPayload = { generationId: string };
type PollPayload = { generationId: string; startedAt?: number };

export interface PrevizSlot {
  shotId: string;
  /** 镜头号（显示用） */
  index: number;
  start: number;
  end: number;
  text: string;
}
export interface PrevizParams {
  slots: PrevizSlot[];
  slotSeconds: number;
  duration: number;
  resolution: string;
  /** 第几批 / 共几批（一章太长时会切成多条预演） */
  batch: number;
  batches: number;
  refs?: string[];
  inputHash?: string;
}

/** 参考图上限：fal 12 个文件含音频，中转站 9 张图；留点余量 */
const MAX_REFS = 9;

/**
 * 分镜预演提交。以视频为中心的首帧方案：不再让 gpt-image 画首帧，而是把人设三视图、场景图、道具图
 * 一起送进视频模型的全能参考，让它把这一批镜头按顺序快速闪一遍——出来的每一帧都是视频模型自己的
 * 画风与人物，之后从里面截帧当首帧，出片时风格、长相天然一致。
 */
export class PrevizSubmitJob extends Job<SubmitPayload> {
  readonly type = "chapter.previz.submit";

  async run(payload: SubmitPayload) {
    const gen = await db.generation.findUniqueOrThrow({ where: { id: String(payload.generationId) } });
    if (!gen.chapterId) throw new Error("预演记录没有章节");
    const p = parseJson<PrevizParams>(gen.params, { slots: [], slotSeconds: 0.75, duration: 15, resolution: "768P", batch: 1, batches: 1 });
    const chapter = await db.chapter.findUniqueOrThrow({
      where: { id: gen.chapterId },
      include: {
        project: { include: { characters: { include: { personas: { include: { sheet: true } } } }, props: { include: { sheet: true } }, scenes: { include: { sheet: true } } } },
        shots: { where: { id: { in: p.slots.map((s) => s.shotId) } } },
      },
    });
    const project = chapter.project;

    // 参考图：出场次数多的人设优先，再场景，再道具。图片与说法一起 push，Image N 的编号不会错位
    const images: string[] = [];
    const refs: RefImage[] = [];
    const count = new Map<string, number>();
    const props = new Set<string>();
    const scenes = new Set<string>();
    for (const s of chapter.shots) {
      for (const c of parseJson<Array<{ characterId: string; personaTag: string }>>(s.characters, [])) {
        const k = `${c.characterId}|${c.personaTag}`;
        count.set(k, (count.get(k) ?? 0) + 1);
      }
      for (const pid of parseJson<string[]>(s.props, [])) props.add(pid);
      if (s.sceneId) scenes.add(s.sceneId);
    }
    const personas = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [k] of personas) {
      const [cid, tag] = k.split("|");
      const ch = project.characters.find((x) => x.id === cid);
      const persona = ch?.personas.find((x) => x.tag === tag) ?? ch?.personas.find((x) => x.sheet);
      if (!ch || !persona?.sheet || images.length >= MAX_REFS) continue;
      images.push(await toDataUrlResized(persona.sheet.path));
      refs.push({ name: `${ch.name}·${persona.tag}的人设三视图（同一人的正面、侧面、背面）`, timeline: false });
    }
    for (const sid of [...scenes].slice(0, 2)) {
      const sc = project.scenes.find((x) => x.id === sid);
      if (!sc?.sheet || images.length >= MAX_REFS) continue;
      // 场景图是两格正反打的拼图，只送左边那一格：整张送进去，模型会把空镜也画成左右分格（提示词里说了也拦不住）
      images.push(await toDataUrlResized(sc.sheet.path, 1024, { leftHalf: true }));
      refs.push({ name: `场景「${sc.name}」的空间参考`, timeline: false });
    }
    for (const pid of [...props].slice(0, 2)) {
      const pr = project.props.find((x) => x.id === pid);
      if (!pr?.sheet || images.length >= MAX_REFS) continue;
      images.push(await toDataUrlResized(pr.sheet.path));
      refs.push({ name: `道具「${pr.name}」的样子`, timeline: false });
    }

    const prompt = previzPrompt({ slots: p.slots, duration: p.duration, slotSeconds: p.slotSeconds, refs, orientation: project.orientation });
    await db.generation.update({
      where: { id: gen.id },
      data: { prompt, model: videoModelFor("ref", "h3"), provider: videoBackend(), status: "running", progress: "提交中", params: JSON.stringify({ ...p, refs: refs.map((r) => r.name) }) },
    });

    try {
      const { taskId } = await createVideoTask({
        engine: "h3",
        variant: images.length ? "ref" : "t2v",
        prompt,
        duration: p.duration,
        resolution: p.resolution,
        aspectRatio: project.orientation,
        images,
      });
      await db.generation.update({ where: { id: gen.id }, data: { externalTaskId: taskId, progress: "已提交" } });
      await enqueue("chapter.previz.poll", { generationId: gen.id, startedAt: Date.now() }, { delayMs: VIDEO_POLL_MS });
    } catch (err) {
      const { long } = errText(err);
      await db.generation.update({ where: { id: gen.id }, data: { status: "failed", error: long, finishedAt: new Date() } });
      throw err;
    }
  }
}

export class PrevizPollJob extends Job<PollPayload> {
  readonly type = "chapter.previz.poll";

  async run(payload: PollPayload) {
    const gen = await db.generation.findUniqueOrThrow({ where: { id: String(payload.generationId) } });
    if (!gen.externalTaskId || !gen.chapterId) return;
    // Generation.chapterId 只是个字符串字段，没有关系，项目 id 得另查
    const chapter = await db.chapter.findUniqueOrThrow({ where: { id: gen.chapterId }, select: { projectId: true } });
    const started = Number(payload.startedAt) || Date.now();
    const p = parseJson<PrevizParams>(gen.params, { slots: [], slotSeconds: 0.75, duration: 15, resolution: "768P", batch: 1, batches: 1 });

    let st;
    try {
      st = await queryVideoTask(gen.externalTaskId);
    } catch (err) {
      await enqueue("chapter.previz.poll", { generationId: gen.id, startedAt: started }, { delayMs: VIDEO_POLL_MS * 2 });
      await db.generation.update({ where: { id: gen.id }, data: { progress: `查询失败，重试中：${errText(err).raw.slice(0, 100)}` } });
      return;
    }

    if (!st.isFinal) {
      if (Date.now() - started > VIDEO_MAX_WAIT_MS) {
        await db.generation.update({ where: { id: gen.id }, data: { status: "failed", error: "超过 90 分钟仍未完成，停止轮询", finishedAt: new Date() } });
        return;
      }
      await db.generation.update({ where: { id: gen.id }, data: { progress: st.progress || st.state } });
      await enqueue("chapter.previz.poll", { generationId: gen.id, startedAt: started }, { delayMs: VIDEO_POLL_MS });
      return;
    }

    if (st.state === "success" && st.resultUrl) {
      const asset = await saveAssetFromUrl(st.resultUrl, { kind: "video", projectId: chapter.projectId, folder: "previz" });
      const cost = st.cost > 0 ? st.cost : estimateVideoCost(p.duration, "h3", p.resolution, "ref");
      await db.generation.update({ where: { id: gen.id }, data: { status: "success", resultId: asset.id, cost, progress: "100%", finishedAt: new Date() } });
    } else {
      await db.generation.update({ where: { id: gen.id }, data: { status: "failed", error: st.error || "任务失败", finishedAt: new Date() } });
    }
  }
}
