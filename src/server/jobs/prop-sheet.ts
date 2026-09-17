import { db } from "../db";
import { ImageJob, type ImagePlan } from "../core/image-job";
import type { Writes } from "../core/job";
import { RefBuilder } from "../core/refs";
import { normalizeQuality } from "../providers/image-fal";
import { propSheetPrompt } from "../prompts";
import { PROP_SIZE } from "./sizes";

type Payload = { propId: string };

const include = { project: { include: { styleRefs: { include: { asset: true }, orderBy: { order: "asc" as const } } } } };
type Ctx = Awaited<ReturnType<typeof load>>;
function load(propId: string) {
  return db.prop.findUniqueOrThrow({ where: { id: propId }, include });
}

/** 道具概念图：单体、白底、多角度，供后续分镜组图与首帧引用。 */
export class PropSheetJob extends ImageJob<Payload, Ctx> {
  readonly type = "prop.sheet";
  protected readonly kind = "prop";
  protected readonly folder = "props";

  protected load(p: Payload) {
    return load(String(p.propId));
  }

  protected projectId(ctx: Ctx) {
    return ctx.project.id;
  }

  protected async plan(ctx: Ctx): Promise<ImagePlan> {
    const rb = new RefBuilder(9);
    await rb.addStyleRefs(ctx.project.styleRefs, 2);
    const { refs, names } = rb.build();
    const prompt = ctx.prompt.trim() || propSheetPrompt({ style: ctx.project.style, name: ctx.name, description: ctx.description, refNames: names });
    return { prompt, size: PROP_SIZE, refs, refNames: names, quality: normalizeQuality(ctx.project.imageQuality) };
  }

  protected generationFields(ctx: Ctx, plan: ImagePlan) {
    return { params: JSON.stringify({ size: plan.size, propId: ctx.id, refs: plan.refNames }) };
  }

  protected onSuccess(ctx: Ctx, out: { assetId: string; plan: ImagePlan }): Writes {
    return [
      db.prop.update({
        where: { id: ctx.id },
        // 刻意不回写自动拼出来的提示词。一旦存档，以后重画就一律用这份旧文案，
        // 改画风、改人物描述全部失效。
        // 用户手写的 prompt 由 plan() 负责优先，不需要在这里帮它落库。
        data: { sheetId: out.assetId, status: "ready", error: "" },
      }),
    ];
  }

  protected onFailure(ctx: Ctx, msg: string): Writes {
    return [db.prop.update({ where: { id: ctx.id }, data: { status: "failed", error: msg } })];
  }
}
