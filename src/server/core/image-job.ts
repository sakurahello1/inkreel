import { db } from "../db";
import { saveAsset } from "../storage";
import { estimateImageCost, generateImageWithRefs, imageBackend, type ImageRef } from "../providers/image";
import { defaultQuality, type ImageQuality } from "../providers/image-fal";
import { Job, errText, type JobContext, type Writes } from "./job";

/**
 * 出图任务的模板方法基类。
 *
 * 人物三视图、道具概念图、镜头首帧这三个任务，流程完全一样：
 *
 *   装载实体 → 装配参考图 → 拼提示词 → 建生成记录 →
 *   调 gpt-image-2 → 存产物 → 事务里同时更新实体与生成记录 →
 *   出错则事务里同时把两边标失败 → 抛出让队列记账
 *
 * 以前这套流程在四个地方各抄了一遍，改一处就要记得改四处（加血缘指纹时就是
 * 这样漏掉过）。现在流程只写一次，子类只填「不一样的那几块」。
 */
export interface ImagePlan {
  prompt: string;
  size: string;
  refs: ImageRef[];
  refNames: string[];
  /** 推理等级（fal gpt-image-2.5）。不传用项目默认 */
  quality?: ImageQuality;
}

export abstract class ImageJob<P, C> extends Job<P> {
  /** Generation.kind */
  protected abstract readonly kind: string;
  /** 存储目录：sheets | props | units | frames */
  protected abstract readonly folder: string;

  /** 记进 Generation.model 的名字。切了后端要如实记，不然版本历史里分不清哪张是谁出的 */
  protected modelFor(plan: ImagePlan) {
    if (imageBackend() === "fal") return `fal:${process.env.FAL_IMAGE_MODEL || "openai/gpt-image-2.5/flare"}@${plan.quality ?? defaultQuality()}`;
    return process.env.IMAGE_MODEL || "gpt-image-2";
  }

  /** 装载这次要处理的实体与它的上下文 */
  protected abstract load(payload: P): Promise<C>;
  /** 所属项目 id，产物挂在它名下 */
  protected abstract projectId(ctx: C): string;
  /** 参考图、尺寸、提示词 */
  protected abstract plan(ctx: C): Promise<ImagePlan>;
  /** 建生成记录时除 kind/model/prompt/status 之外的字段 */
  protected abstract generationFields(ctx: C, plan: ImagePlan): Record<string, unknown>;
  /** 成功时对实体的写操作，与生成记录的更新放在同一个事务里 */
  protected abstract onSuccess(ctx: C, out: { assetId: string; cost: number; plan: ImagePlan }): Writes;
  /** 失败时对实体的写操作 */
  protected abstract onFailure(ctx: C, msg: string): Writes;
  /** 成功并提交之后的副作用，例如级联触发下游任务。默认什么都不做 */
  protected async afterSuccess(_ctx: C, _payload: P): Promise<void> {}
  /**
   * 失败并提交之后的副作用。默认什么都不做。
   * 存在的理由：串行链条上一环画坏了，也得把后面的放行，否则它们会永远卡在「生成中」——
   * 没有任务在跑，也没有东西会来救它们。
   */
  protected async afterFailure(_ctx: C, _payload: P): Promise<void> {}

  async run(payload: P, _jobCtx: JobContext) {
    const ctx = await this.load(payload);
    const plan = await this.plan(ctx);

    const gen = await db.generation.create({
      data: {
        kind: this.kind,
        provider: imageBackend(),
        model: this.modelFor(plan),
        prompt: plan.prompt,
        status: "running",
        ...this.generationFields(ctx, plan),
      } as never,
    });

    try {
      const result = await generateImageWithRefs({ prompt: plan.prompt, size: plan.size, refs: plan.refs, quality: plan.quality });
      const asset = await saveAsset({
        buffer: result.buffer,
        mime: result.mime,
        kind: "image",
        projectId: this.projectId(ctx),
        folder: this.folder,
      });
      const cost = estimateImageCost(result.usage, plan.size, plan.quality);
      await db.$transaction([
        ...this.onSuccess(ctx, { assetId: asset.id, cost, plan }),
        db.generation.update({ where: { id: gen.id }, data: { status: "success", resultId: asset.id, cost, finishedAt: new Date() } }),
      ]);
      await this.afterSuccess(ctx, payload);
    } catch (err) {
      const { short, long } = errText(err);
      await db.$transaction([
        ...this.onFailure(ctx, short),
        db.generation.update({ where: { id: gen.id }, data: { status: "failed", error: long, finishedAt: new Date() } }),
      ]);
      await this.afterFailure(ctx, payload);
      throw err;
    }
  }
}
