import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { db } from "../db";
import { absPath } from "../storage";
import { extractLastFrame } from "../ffmpeg";
import { ImageJob, type ImagePlan } from "../core/image-job";
import type { Writes } from "../core/job";
import { RefBuilder } from "../core/refs";
import { framePrompt } from "../prompts";
import { frameLineage, orderKeyframes } from "../lineage";
import { loadShotContext, type ShotContext } from "./shot-context";
import { maybeRenderPage } from "../services/narrated-service";
import { enqueue } from "./runner";
import { frameSize } from "./sizes";
import { normalizeQuality } from "../providers/image-fal";

/** rest：同组还没出图的镜头，本镜画完再依次触发，好让它们都能引用到锚点 */
type Payload = { shotId: string; thenVideo?: boolean; rest?: string[] };
type Ctx = ShotContext & { lineage: Awaited<ReturnType<typeof frameLineage>> };

/**
 * 镜头首帧：按镜头自己的画面提示词直接出一张竖屏画面。
 * 参考图依次是出场人设、道具概念图、同组锚点首帧，最后是画风参考图。
 */
export class ShotFrameJob extends ImageJob<Payload, Ctx> {
  readonly type = "shot.frame";
  protected readonly kind = "frame";
  protected readonly folder = "frames";

  protected async load(p: Payload) {
    const ctx = await loadShotContext(String(p.shotId));
    return { ...ctx, lineage: await frameLineage(ctx.shot.id) };
  }

  protected projectId(ctx: Ctx) {
    return ctx.project.id;
  }

  protected async plan(ctx: Ctx): Promise<ImagePlan> {
    const { shot, project } = ctx;
    const rb = new RefBuilder(9);

    await rb.addAll(ctx.refs, (r) => ({ asset: r.asset, fileName: r.fileName, label: r.label }));

    // 承接上一镜：把上一镜成片的最后一帧截下来当参考图，保证时间上的延续性。
    // 有它就不再放同组锚点——末帧是真实成片的结束状态，比锚点精确，两张一起给会打架。
    const prev = ctx.lineage.prev;
    if (prev) {
      const v = await db.asset.findUnique({ where: { id: prev.videoId } });
      if (v) {
        const tmp = path.join(os.tmpdir(), `last-${prev.videoId}.png`);
        try {
          await extractLastFrame(absPath(v.path), tmp);
          rb.addBuffer(await fs.readFile(tmp), "image/png", { fileName: "prev-last-frame.png", label: `上一镜末帧 #${String(prev.index).padStart(2, "0")}` });
        } finally {
          await fs.rm(tmp, { force: true }).catch(() => {});
        }
      }
    }
    // 同组锚点排在身份图之后、画风图之前：它只管场景连续性，不参与位序绑定的身份
    const anchor = ctx.lineage.anchor;
    if (anchor) {
      const a = await db.asset.findUnique({ where: { id: anchor.frameId } });
      if (a) await rb.add(a, { fileName: "anchor.png", label: `同组锚点 #${String(anchor.index).padStart(2, "0")}` });
    }

    await rb.addStyleRefs(project.styleRefs, 2);
    const { refs, names } = rb.build();

    return {
      prompt: framePrompt({ style: project.style, framePrompt: shot.framePrompt, refNames: names, orientation: project.orientation }),
      size: frameSize(project.orientation),
      refs,
      refNames: names,
      // 镜头自己设了档位就用它，没设跟项目默认
      quality: normalizeQuality(shot.frameQuality || project.imageQuality),
    };
  }

  protected generationFields(ctx: Ctx, plan: ImagePlan) {
    return {
      shotId: ctx.shot.id,
      unitId: ctx.shot.unitId,
      inputs: JSON.stringify(ctx.lineage.inputs),
      params: JSON.stringify({ size: plan.size, refs: plan.refNames, inputHash: ctx.lineage.hash }),
    };
  }

  protected onSuccess(ctx: Ctx, out: { assetId: string; cost: number }): Writes {
    return [
      db.shot.update({
        where: { id: ctx.shot.id },
        data: { frameId: out.assetId, frameMode: "image", status: "frame_ready", frameInputHash: ctx.lineage.hash, cost: { increment: out.cost }, reviewNote: "" },
      }),
    ];
  }

  protected onFailure(ctx: Ctx, msg: string): Writes {
    return [db.shot.update({ where: { id: ctx.shot.id }, data: { status: "storyboard_approved", reviewNote: `首帧生成失败：${msg.slice(0, 300)}` } })];
  }

  /** 同组下一镜：必须等这一张落库，它才引用得到锚点，所以只能串行往下传 */
  private async passBaton(payload: Payload) {
    const [next, ...rest] = payload.rest ?? [];
    if (next) await enqueue("shot.frame", { shotId: next, thenVideo: payload.thenVideo, rest });
  }

  /** 本镜画坏了也要放行后面的，否则它们会一直卡在「生成中」等一个永远不会来的任务 */
  protected async afterFailure(_ctx: Ctx, payload: Payload) {
    await this.passBaton(payload);
  }

  protected async afterSuccess(ctx: Ctx, payload: Payload) {
    await this.passBaton(payload);

    // 说书：这一页的配音要是早就齐了，图一到就渲染页视频
    if (ctx.project.kind === "narrated") {
      await maybeRenderPage(ctx.shot.id);
      return;
    }

    // 写了提示词的关键帧：它们以首帧为基准，首帧一换就过期，顺手串行重画；要出视频的话由最后一张接着触发
    const kfs = orderKeyframes(ctx.shot.keyframes.filter((k) => k.prompt.trim())).map((k) => k.id);
    if (kfs.length) {
      const [head, ...rest] = kfs;
      await enqueue("shot.keyframe", { keyframeId: head, thenVideo: payload.thenVideo, rest });
      return;
    }
    if (!payload.thenVideo) return;
    await db.shot.update({ where: { id: ctx.shot.id }, data: { status: "video_queued", reviewNote: "" } });
    await enqueue("shot.video.submit", { shotId: ctx.shot.id });
  }
}
