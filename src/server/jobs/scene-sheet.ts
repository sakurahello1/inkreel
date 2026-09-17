import { db } from "../db";
import { ImageJob, type ImagePlan } from "../core/image-job";
import type { Writes } from "../core/job";
import { RefBuilder } from "../core/refs";
import { normalizeQuality } from "../providers/image-fal";
import { sceneSheetPrompt } from "../prompts";
import { SCENE_SIZE } from "./sizes";

type Payload = { sceneId: string };

const include = { project: { include: { styleRefs: { include: { asset: true }, orderBy: { order: "asc" as const } } } } };
type Ctx = Awaited<ReturnType<typeof load>>;
function load(sceneId: string) {
  return db.scene.findUniqueOrThrow({ where: { id: sceneId }, include });
}

/**
 * 场景概念图：一张图里画同一个空间的两个互为反打的视角。
 *
 * 只画一个视角不够用——短剧几乎每场都在正反打之间来回切，模型看不到反方向，
 * 就只能自己发明人物背后是什么。两个视角合成一张，仍然是单张资产、单条提示词，
 * 不需要格号、不需要逐格提示词，跟已经删掉的分镜组多格图不是一回事。
 */
export class SceneSheetJob extends ImageJob<Payload, Ctx> {
  readonly type = "scene.sheet";
  protected readonly kind = "scene";
  protected readonly folder = "scenes";

  protected load(p: Payload) {
    return load(String(p.sceneId));
  }

  protected projectId(ctx: Ctx) {
    return ctx.project.id;
  }

  protected async plan(ctx: Ctx): Promise<ImagePlan> {
    const rb = new RefBuilder(9);
    await rb.addStyleRefs(ctx.project.styleRefs, 2);
    const { refs, names } = rb.build();
    const prompt =
      ctx.prompt.trim() || sceneSheetPrompt({ style: ctx.project.style, name: ctx.name, description: ctx.description, refNames: names });
    return { prompt, size: SCENE_SIZE, refs, refNames: names, quality: normalizeQuality(ctx.project.imageQuality) };
  }

  protected generationFields(ctx: Ctx, plan: ImagePlan) {
    return { params: JSON.stringify({ size: plan.size, sceneId: ctx.id, refs: plan.refNames }) };
  }

  protected onSuccess(ctx: Ctx, out: { assetId: string }): Writes {
    // 与人设图、道具图同理：不回写自动拼出来的提示词，否则改画风或改描述之后重画一律失效
    return [db.scene.update({ where: { id: ctx.id }, data: { sheetId: out.assetId, status: "ready", error: "" } })];
  }

  protected onFailure(ctx: Ctx, msg: string): Writes {
    return [db.scene.update({ where: { id: ctx.id }, data: { status: "failed", error: msg } })];
  }
}
