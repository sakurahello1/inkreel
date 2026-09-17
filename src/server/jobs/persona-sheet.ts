import { db } from "../db";
import { ImageJob, type ImagePlan } from "../core/image-job";
import type { Writes } from "../core/job";
import { RefBuilder } from "../core/refs";
import { normalizeQuality } from "../providers/image-fal";
import { sheetPrompt } from "../prompts";
import { SHEET_SIZE } from "./sizes";

type Payload = { personaId: string };

const include = {
  character: {
    include: {
      project: { include: { styleRefs: { include: { asset: true }, orderBy: { order: "asc" as const } } } },
      personas: { include: { sheet: true }, orderBy: { order: "asc" as const } },
    },
  },
};

type Ctx = Awaited<ReturnType<typeof load>>;
function load(personaId: string) {
  return db.persona.findUniqueOrThrow({ where: { id: personaId }, include });
}

/** 人物三视图。同一人物已有的其它人设图会作为参考，保证同一个人跨 tag 长得像同一个人。 */
export class PersonaSheetJob extends ImageJob<Payload, Ctx> {
  readonly type = "persona.sheet";
  protected readonly kind = "sheet";
  protected readonly folder = "sheets";

  protected load(p: Payload) {
    return load(String(p.personaId));
  }

  protected projectId(ctx: Ctx) {
    return ctx.character.project.id;
  }

  protected async plan(ctx: Ctx): Promise<ImagePlan> {
    const project = ctx.character.project;
    const siblings = ctx.character.personas.filter((p) => p.id !== ctx.id && p.sheet);

    // 画风参考图是三视图的硬前提，不是可选项。
    // 没有它，纯色背景会让模型退回「角色设定稿」的平涂画法，而且十几张资产之间
    // 谁也不锚着谁，画风各飘各的。宁可在这里挡住，也不要出一批要重画的图。
    if (project.styleRefs.length === 0) {
      throw new Error("这个项目还没有画风参考图。请先到「世界观」页上传一张，再生成三视图。");
    }

    const rb = new RefBuilder(9);
    // 画风图必须排在人设图后面：提示词按位序绑定身份，排前面会让模型拿画风图里的脸去对人物
    await rb.addAll(siblings.slice(0, 2), (sib) => ({
      asset: sib.sheet,
      fileName: `persona-${sib.tag}.png`,
      label: `${ctx.character.name}·${sib.tag}`,
    }));
    await rb.addStyleRefs(project.styleRefs, 2);
    const { refs, names } = rb.build();

    const prompt =
      ctx.prompt.trim() ||
      sheetPrompt({ style: project.style, name: ctx.character.name, description: ctx.description, refNames: names });

    return { prompt, size: SHEET_SIZE, refs, refNames: names, quality: normalizeQuality(project.imageQuality) };
  }

  protected generationFields(ctx: Ctx, plan: ImagePlan) {
    return {
      personaId: ctx.id,
      characterId: ctx.character.id,
      params: JSON.stringify({ size: plan.size, refs: plan.refNames }),
    };
  }

  protected onSuccess(ctx: Ctx, out: { assetId: string; plan: ImagePlan }): Writes {
    return [
      db.persona.update({
        where: { id: ctx.id },
        // 刻意不回写自动拼出来的提示词。一旦存档，以后重画就一律用这份旧文案，
        // 改画风、改人物描述全部失效。
        // 用户手写的 prompt 由 plan() 负责优先，不需要在这里帮它落库。
        data: { sheetId: out.assetId, status: "ready", error: "" },
      }),
    ];
  }

  protected onFailure(ctx: Ctx, msg: string): Writes {
    return [db.persona.update({ where: { id: ctx.id }, data: { status: "failed", error: msg } })];
  }
}
