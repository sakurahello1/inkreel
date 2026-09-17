import type { VideoCreateInput, VideoStatus } from "./video";

/**
 * fal.ai 上的 MiniMax H3 Max Turbo（fal 后训练的加速版）。
 *
 * 为什么换：中转站的 H3 走 RQ2 渠道，平均 12 分钟一条、今晚实测 21 分钟，
 * 渠道还会整段关闭，两条里错一条台词。fal 这边实测三条全对、21–40 秒一条、
 * 1080P 带音轨、认 16:9 首帧、画风不漂。
 *
 * 用队列接口（queue.fal.run）而不是同步接口：提交→轮询→取结果，
 * 跟已有的 VideoSubmitJob / VideoPollJob 结构一一对应，不用改任务代码。
 *
 * 计价是真美元。促销价（到 2026-09-14）：768P $0.01/秒、1080P $0.02/秒；之后约 ×4。
 */

const MODEL = process.env.FAL_VIDEO_MODEL || "minimax/h3-max-turbo";
/** 全能参考只有 H3 Max（非 Turbo）有：reference_image_urls ≤12，提示词里按 Image N 指代。促销价是 Turbo 的两倍 */
const REF_MODEL = process.env.FAL_VIDEO_REF_MODEL || "minimax/h3-max";
const QUEUE = "https://queue.fal.run";
export const FAL_MIN_DURATION = 5;

function key() {
  const k = process.env.FAL_KEY;
  if (!k) throw new Error("缺少 FAL_KEY");
  return k;
}

/** fal 的 H3 只有三档，2K/4K 归到 1080P */
function falResolution(r?: string) {
  if (r === "480P" || r === "768P" || r === "1080P") return r;
  return "1080P";
}

/**
 * 端点按变体决定：ref 走 H3 Max 的 reference-to-video（多图 + 音频 + 视频参考，按时间点排关键帧就靠它）；
 * 其余有首帧走 Turbo 的 image-to-video（首尾帧都在这），没有走 text-to-video。
 */
function endpointFor(input: VideoCreateInput) {
  if (input.variant === "ref") return `${REF_MODEL}/reference-to-video`;
  return input.images?.length ? `${MODEL}/image-to-video` : `${MODEL}/text-to-video`;
}

export function falVideoModel(variant?: string) {
  return `fal:${variant === "ref" ? REF_MODEL : MODEL}`;
}

export function falBuildRequest(input: VideoCreateInput) {
  const body: Record<string, unknown> = {
    prompt: input.prompt,
    // fal 的 H3 下限是 5 秒（中转站是 4），传 4 会被 422 拒掉
    duration: Math.min(15, Math.max(FAL_MIN_DURATION, Math.round(input.duration))),
    resolution: falResolution(input.resolution),
    // balanced 约 1 秒、quality 约 30 秒的提示词扩写；实测 balanced 三条全对，先用它
    prompt_expansion_mode: process.env.FAL_PROMPT_EXPANSION || "balanced",
  };
  if (input.variant === "ref") {
    // 全能参考：图 / 音 / 视频三类合计不超过 12 个；画幅没有首帧可跟，必须传
    if (input.images?.length) body.reference_image_urls = input.images.slice(0, 9);
    if (input.audios?.length) body.reference_audio_urls = input.audios.slice(0, 3);
    if (input.videos?.length) body.reference_video_urls = input.videos.slice(0, 3);
    if (!body.reference_image_urls && !body.reference_video_urls) throw new Error("全能参考模式至少需要 1 张图或 1 段参考视频");
    body.aspect_ratio = input.aspectRatio && input.aspectRatio !== "adaptive" ? input.aspectRatio : "16:9";
    return { endpoint: endpointFor(input), body };
  }
  if (input.images?.[0]) body.image_url = input.images[0];
  if (input.images?.[1]) body.end_image_url = input.images[1];
  // 文生模式画幅由 aspect_ratio 决定；有首帧时画布跟首帧走，不用传
  if (!input.images?.length && input.aspectRatio && input.aspectRatio !== "adaptive") body.aspect_ratio = input.aspectRatio;
  return { endpoint: endpointFor(input), body };
}

export async function falCreateVideoTask(input: VideoCreateInput): Promise<{ taskId: string; raw: unknown }> {
  const { endpoint, body } = falBuildRequest(input);
  const res = await fetch(`${QUEUE}/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Key ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(2 * 60 * 1000),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`fal video create ${res.status}: ${raw.slice(0, 400)}`);
  const data = JSON.parse(raw);
  if (!data.request_id) throw new Error(`fal video create: 响应无 request_id: ${raw.slice(0, 300)}`);
  // 轮询需要知道端点，把它编进 taskId 一起存
  return { taskId: `${endpoint}::${data.request_id}`, raw: data };
}

export async function falQueryVideoTask(taskId: string): Promise<VideoStatus> {
  const [endpoint, requestId] = taskId.split("::");
  if (!endpoint || !requestId) throw new Error(`fal taskId 格式不对：${taskId}`);
  // 状态与结果是两个 URL，都以模型名（去掉子路径）为前缀
  const base = `${QUEUE}/${endpoint.split("/").slice(0, 2).join("/")}/requests/${requestId}`;
  const sres = await fetch(`${base}/status`, { headers: { Authorization: `Key ${key()}` }, signal: AbortSignal.timeout(60 * 1000) });
  const sraw = await sres.text();
  if (!sres.ok) throw new Error(`fal video status ${sres.status}: ${sraw.slice(0, 300)}`);
  const st = JSON.parse(sraw);
  const status = String(st.status ?? "");
  const pos = st.queue_position !== undefined ? `队列第 ${st.queue_position} 位` : "";

  if (status === "IN_QUEUE") return { taskId, state: "pending", isFinal: false, progress: pos, resultUrl: "", error: "", cost: 0, raw: st };
  if (status === "IN_PROGRESS") return { taskId, state: "running", isFinal: false, progress: "生成中", resultUrl: "", error: "", cost: 0, raw: st };
  if (status !== "COMPLETED") return { taskId, state: "failed", isFinal: true, progress: "", resultUrl: "", error: `未知状态 ${status}: ${sraw.slice(0, 200)}`, cost: 0, raw: st };

  const rres = await fetch(base, { headers: { Authorization: `Key ${key()}` }, signal: AbortSignal.timeout(60 * 1000) });
  const rraw = await rres.text();
  if (!rres.ok) return { taskId, state: "failed", isFinal: true, progress: "", resultUrl: "", error: `取结果 ${rres.status}: ${rraw.slice(0, 300)}`, cost: 0, raw: st };
  const r = JSON.parse(rraw);
  const url = r.video?.url;
  if (!url) return { taskId, state: "failed", isFinal: true, progress: "", resultUrl: "", error: `结果无视频: ${rraw.slice(0, 300)}`, cost: 0, raw: r };
  return { taskId, state: "success", isFinal: true, progress: "100", resultUrl: url, error: "", cost: 0, raw: r };
}

/** fal 促销价（美元/秒）。到 2026-09-14；之后按 ×4 估。全能参考走 H3 Max，是 Turbo 的两倍 */
export function falEstimateVideoCost(seconds: number, resolution?: string, variant?: string) {
  const d = Math.min(15, Math.max(FAL_MIN_DURATION, Math.round(seconds)));
  const promo = Date.now() < Date.parse("2026-09-15T00:00:00+08:00");
  const per = falResolution(resolution) === "1080P" ? 0.02 : falResolution(resolution) === "768P" ? 0.01 : 0.00625;
  return Math.round(d * per * (promo ? 1 : 4) * (variant === "ref" ? 2 : 1) * 1000) / 1000;
}
