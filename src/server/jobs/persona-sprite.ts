import { db } from "../db";
import { enqueue } from "./index";
import { ImageJob, type ImagePlan } from "../core/image-job";
import type { Writes } from "../core/job";
import { RefBuilder } from "../core/refs";
import { normalizeQuality } from "../providers/image-fal";
import { toSprite } from "../providers/fal-matte";
import { spritePrompt } from "../prompts";

type Payload = { spriteId: string; rest?: string[] };

/** 七分身立绘：竖幅 2:3 */
export const SPRITE_SIZE = process.env.SPRITE_SIZE || "1024x1536";

const include = {
  persona: {
    include: {
      sheet: true,
      character: { include: { project: { include: { styleRefs: { include: { asset: true }, orderBy: { order: "asc" as const } } } } } },
    },
  },
};

type Ctx = Awaited<ReturnType<typeof load>>;
function load(spriteId: string) {
  return db.sprite.findUniqueOrThrow({ where: { id: spriteId }, include });
}

/**
 * galgame 立绘：某个人设在某个表情下的透明背景站姿图。
 * 身份靠这个人设的三视图锚住；同一人设的一批表情串行出（rest 传下去），
 * 免得八个表情同时开工把并发都占满。
 */
export class PersonaSpriteJob extends ImageJob<Payload, Ctx> {
  readonly type = "persona.sprite";
  protected readonly kind = "sprite";
  protected readonly folder = "sprites";

  protected load(p: Payload) {
    return load(String(p.spriteId));
  }

  protected projectId(ctx: Ctx) {
    return ctx.persona.character.project.id;
  }

  protected async plan(ctx: Ctx): Promise<ImagePlan> {
    const persona = ctx.persona;
    const project = persona.character.project;
    if (!persona.sheet) throw new Error(`「${persona.character.name}·${persona.tag}」还没有三视图，先生成三视图再出立绘`);
    const rb = new RefBuilder(4);
    await rb.add(persona.sheet, { fileName: `persona-${persona.tag}.png`, label: `${persona.character.name}·${persona.tag}` });
    await rb.addStyleRefs(project.styleRefs, 1);
    const { refs, names } = rb.build();
    const prompt = ctx.prompt.trim() || spritePrompt({ style: project.style, name: persona.character.name, description: persona.description, expression: ctx.expression, refNames: names });
    return { prompt, size: SPRITE_SIZE, refs, refNames: names, quality: normalizeQuality(project.imageQuality) };
  }

  /** 模型没给透明就抠图；再裁掉透明边 */
  protected async transform(buffer: Buffer, mime: string) {
    return { buffer: await toSprite(buffer, mime), mime: "image/png" };
  }

  protected generationFields(ctx: Ctx, plan: ImagePlan) {
    return {
      personaId: ctx.personaId,
      characterId: ctx.persona.characterId,
      params: JSON.stringify({ size: plan.size, refs: plan.refNames, expression: ctx.expression, sprite: ctx.id }),
    };
  }

  protected onSuccess(ctx: Ctx, out: { assetId: string }): Writes {
    return [db.sprite.update({ where: { id: ctx.id }, data: { assetId: out.assetId, status: "ready", error: "" } })];
  }

  protected onFailure(ctx: Ctx, msg: string): Writes {
    return [db.sprite.update({ where: { id: ctx.id }, data: { status: "failed", error: msg } })];
  }

  protected async afterSuccess(_ctx: Ctx, payload: Payload) {
    await this.passBaton(payload);
  }

  protected async afterFailure(_ctx: Ctx, payload: Payload) {
    await this.passBaton(payload);
  }

  private async passBaton(p: Payload) {
    const [next, ...rest] = p.rest ?? [];
    if (next) await enqueue("persona.sprite", { spriteId: next, rest });
  }
}
