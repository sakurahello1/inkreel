import { db } from "../db";
import { ImageJob, type ImagePlan } from "../core/image-job";
import type { Writes } from "../core/job";
import { RefBuilder } from "../core/refs";
import { keyframePrompt } from "../prompts";
import { keyframeLineage } from "../lineage";
import { loadShotContext, type ShotContext } from "./shot-context";
import { enqueue } from "./runner";
import { frameSize } from "./sizes";
import { normalizeQuality } from "../providers/image-fal";

/** rest：同镜其余还没出图的关键帧，本张画完依次触发；thenVideo 由最后一张接力到视频 */
type Payload = { keyframeId: string; thenVideo?: boolean; rest?: string[] };
type Ctx = ShotContext & { keyframe: { id: string; at: number; prompt: string }; lineage: Awaited<ReturnType<typeof keyframeLineage>> };

/**
 * 镜头关键帧：同一镜头在某个时刻的画面（结尾那张就是尾帧）。
 *
 * 为什么要它：H3 只给首帧时，结束画面全看模型发挥——人物走到哪、转没转身、机位推没推到位，
 * 一条一条抽。只有尾帧时视频走首尾帧把终点钉死；有中间关键帧时走全能参考，
 * 把每一张按时间点当参考图，模型会按顺序经过它们（实测 fal 的改写器直接识别成 keyframe completion）。
 *
 * 参考图第一张是本镜首帧——它比人设图更重要，关键帧要的是「同一镜头、同一场景、同一光」，
 * 只有描述里说变的东西才变。之后才是场景/人设/道具/补充，最后画风。
 * 不放同组锚点也不放上一镜末帧：有首帧在，那两样只会添乱。
 *
 * 不动 Shot.status：关键帧是首帧的附属物，进度看 Generation 自己的状态。
 */
export class ShotKeyframeJob extends ImageJob<Payload, Ctx> {
  readonly type = "shot.keyframe";
  protected readonly kind = "keyframe";
  protected readonly folder = "frames";

  protected async load(p: Payload) {
    const kf = await db.keyframe.findUniqueOrThrow({ where: { id: String(p.keyframeId) } });
    const ctx = await loadShotContext(kf.shotId);
    if (!ctx.shot.frame) throw new Error("先出首帧，关键帧要以它为基准");
    if (!kf.prompt.trim()) throw new Error("关键帧提示词为空");
    return { ...ctx, keyframe: kf, lineage: await keyframeLineage(kf.id) };
  }

  protected projectId(ctx: Ctx) {
    return ctx.project.id;
  }

  protected async plan(ctx: Ctx): Promise<ImagePlan> {
    const { shot, project, keyframe } = ctx;
    const rb = new RefBuilder(9);
    await rb.add(shot.frame!, { fileName: "first-frame.png", label: "本镜首帧" });
    await rb.addAll(ctx.refs, (r) => ({ asset: r.asset, fileName: r.fileName, label: r.label }));
    await rb.addStyleRefs(project.styleRefs, 2);
    const { refs, names } = rb.build();
    return {
      prompt: keyframePrompt({ style: project.style, prompt: keyframe.prompt, at: keyframe.at, duration: shot.duration, refNames: names, orientation: project.orientation }),
      size: frameSize(project.orientation),
      refs,
      refNames: names,
      quality: normalizeQuality(shot.frameQuality || project.imageQuality),
    };
  }

  protected generationFields(ctx: Ctx, plan: ImagePlan) {
    return {
      shotId: ctx.shot.id,
      unitId: ctx.shot.unitId,
      keyframeId: ctx.keyframe.id,
      inputs: JSON.stringify(ctx.lineage.inputs),
      params: JSON.stringify({ size: plan.size, refs: plan.refNames, inputHash: ctx.lineage.hash, at: ctx.keyframe.at }),
    };
  }

  protected onSuccess(ctx: Ctx, out: { assetId: string; cost: number }): Writes {
    return [
      db.keyframe.update({ where: { id: ctx.keyframe.id }, data: { assetId: out.assetId, inputHash: ctx.lineage.hash } }),
      db.shot.update({ where: { id: ctx.shot.id }, data: { cost: { increment: out.cost } } }),
    ];
  }

  protected onFailure(ctx: Ctx, msg: string): Writes {
    return [db.shot.update({ where: { id: ctx.shot.id }, data: { reviewNote: `关键帧生成失败：${msg.slice(0, 300)}` } })];
  }

  private async passBaton(payload: Payload, thenVideo: boolean | undefined) {
    const [next, ...rest] = payload.rest ?? [];
    if (next) {
      await enqueue("shot.keyframe", { keyframeId: next, thenVideo, rest });
      return true;
    }
    return false;
  }

  protected async afterSuccess(ctx: Ctx, payload: Payload) {
    if (await this.passBaton(payload, payload.thenVideo)) return;
    if (!payload.thenVideo) return;
    await db.shot.update({ where: { id: ctx.shot.id }, data: { status: "video_queued", reviewNote: "" } });
    await enqueue("shot.video.submit", { shotId: ctx.shot.id });
  }

  /** 链上一张画坏了：后面的照样画，但视频不该带着坏帧自动跑——收回 thenVideo，退回首帧就绪让人看一眼 */
  protected async afterFailure(ctx: Ctx, payload: Payload) {
    await this.passBaton(payload, false);
    if (payload.thenVideo) await db.shot.update({ where: { id: ctx.shot.id }, data: { status: "frame_ready" } });
  }
}
