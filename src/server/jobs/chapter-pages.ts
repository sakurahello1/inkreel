import { db } from "../db";
import { Job, errText } from "../core/job";
import { runPagesAgent } from "../agent/pages";
import type { ChatProviderName } from "../providers/chat";
import { syncUtterances } from "../services/narrated-service";
import { estimatePageSeconds } from "@/lib/narrated";

type Payload = { chapterId: string; provider?: string; instruction?: string };

function chatCost(provider: unknown, usage: { prompt: number; completion: number }) {
  return provider === "deepseek" ? 0.001 : usage.prompt * 0.0000025 + usage.completion * 0.00001;
}

/**
 * 拆页（说书模式）：整章覆盖式重建为「页」。页复用 Shot 表：frameMode 固定 image，
 * 画面提示词进 framePrompt，旁白进 narration，台词进 dialogue；时长先占位，配音出来后按音频长度重算。
 * 每页的旁白 / 台词随后拆成 Utterance，一条一条配音。
 */
export class ChapterPagesJob extends Job<Payload> {
  readonly type = "chapter.pages";

  async run(p: Payload) {
    const id = String(p.chapterId);
    const gen = await db.generation.create({
      data: { kind: "storyboard", chapterId: id, provider: String(p.provider ?? "chat"), model: "", prompt: String(p.instruction ?? ""), status: "running", params: JSON.stringify({ mode: "pages" }) },
    });
    try {
      const { output, usage, model } = await runPagesAgent(id, { provider: p.provider as ChatProviderName | undefined, instruction: p.instruction ? String(p.instruction) : undefined });
      const shotIds: string[] = [];
      // 页的场景文字与场景库按名字对上：出图时才能把场景基准图当参考送进去
      const chapter = await db.chapter.findUniqueOrThrow({ where: { id }, include: { project: { include: { scenes: true } } } });
      const matchScene = (text: string) => {
        const head = text.split(/\s*[·・]\s*/)[0].trim();
        return chapter.project.scenes.find((sc) => sc.name && (text.includes(sc.name) || (head && sc.name.includes(head))))?.id ?? null;
      };
      await db.$transaction(async (tx) => {
        await tx.shot.deleteMany({ where: { chapterId: id } });
        await tx.unit.deleteMany({ where: { chapterId: id } });
        const unitIds = new Map<number, string>();
        for (const u of output.units) {
          const row = await tx.unit.create({ data: { chapterId: id, index: u.index, summary: u.summary, paraStart: u.paraStart, paraEnd: u.paraEnd } });
          unitIds.set(u.index, row.id);
        }
        let i = 0;
        for (const pg of output.pages) {
          i += 1;
          const row = await tx.shot.create({
            data: {
              chapterId: id,
              unitId: unitIds.get(pg.unitIndex) ?? null,
              index: i,
              scene: pg.scene,
              sceneId: matchScene(pg.scene),
              shotSize: "中景",
              duration: estimatePageSeconds(pg.narration, pg.dialogue.map((d) => d.line)),
              characters: JSON.stringify(pg.characters),
              props: JSON.stringify(pg.propIds),
              dialogue: JSON.stringify(pg.dialogue),
              narration: pg.narration,
              frameMode: "image",
              framePrompt: pg.framePrompt,
              videoPrompt: "",
              bgmTrackId: pg.bgmTrackId,
              bgmToModel: false,
              needsReview: pg.needsReview,
              reviewNote: pg.reviewNote,
              status: "draft",
            },
          });
          shotIds.push(row.id);
        }
        await tx.chapter.update({ where: { id }, data: { agentStatus: "idle", agentError: "" } });
        await tx.generation.update({ where: { id: gen.id }, data: { status: "success", model, cost: chatCost(p.provider, usage), params: JSON.stringify({ mode: "pages", ...usage }), finishedAt: new Date() } });
      });
      for (const sid of shotIds) await syncUtterances(sid);
    } catch (err) {
      const { long, raw } = errText(err);
      await db.$transaction([
        db.chapter.update({ where: { id }, data: { agentStatus: "failed", agentError: raw.slice(0, 800) } }),
        db.generation.update({ where: { id: gen.id }, data: { status: "failed", error: long, finishedAt: new Date() } }),
      ]);
      throw err;
    }
  }
}
