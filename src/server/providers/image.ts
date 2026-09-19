/**
 * gpt-image-2 封装：文生图 + 带参考图的编辑接口。
 * 参考图走 multipart 的 image[] 字段，最多 16 张。
 */

/**
 * 出图超时。原来写死 5 分钟，实测大画布（场景基准图 3072x1536）在接口变慢时会撞上，
 * 而超时是最亏的失败方式——钱照付，图拿不到。宁可多等三分钟。
 */
import { falEstimateImageCost, falGenerateImage, falGenerateImageWithRefs, type ImageQuality } from "./image-fal";

const IMAGE_TIMEOUT_MS = Number(process.env.IMAGE_TIMEOUT_MS || 8 * 60 * 1000);

/**
 * 图片后端：relay（中转站的 OpenAI 兼容接口）| fal（fal.ai 的 gpt-image-2.5 flare）。
 * 四个出图任务都只认这个文件导出的 generateImageWithRefs / estimateImageCost，
 * 切后端只改这一个环境变量，任务代码一行不动。
 */
export type ImageBackend = "relay" | "fal";
export function imageBackend(): ImageBackend {
  return (process.env.IMAGE_PROVIDER || "relay") === "fal" ? "fal" : "relay";
}

export interface ImageRef {
  buffer: Buffer;
  mime: string;
  name?: string;
}

export interface ImageResult {
  buffer: Buffer;
  mime: string;
  usage?: { input: number; output: number };
}

/** 中转站的 gpt-image-2 只有三档，fal 的 xhigh/max 归到 high，auto 不传 */
function relayQuality(q?: ImageQuality) {
  if (!q || q === "auto") return undefined;
  return q === "xhigh" || q === "max" ? "high" : q;
}

function cfg() {
  const baseUrl = (process.env.IMAGE_BASE_URL || "").replace(/\/$/, "");
  const apiKey = process.env.IMAGE_API_KEY || "";
  const model = process.env.IMAGE_MODEL || "gpt-image-2";
  if (!baseUrl || !apiKey) throw new Error("缺少 IMAGE_BASE_URL / IMAGE_API_KEY");
  return { baseUrl, apiKey, model };
}

async function parseImageResponse(res: Response): Promise<ImageResult> {
  const raw = await res.text();
  if (!res.ok) throw new Error(`image ${res.status}: ${raw.slice(0, 400)}`);
  const data = JSON.parse(raw);
  const item = data.data?.[0];
  if (!item) throw new Error(`image: 响应无 data: ${raw.slice(0, 200)}`);
  let buffer: Buffer;
  let mime = "image/png";
  if (item.b64_json) {
    buffer = Buffer.from(item.b64_json, "base64");
  } else if (item.url) {
    const r = await fetch(item.url);
    if (!r.ok) throw new Error(`image: 下载结果失败 ${r.status}`);
    mime = (r.headers.get("content-type") || "image/png").split(";")[0];
    buffer = Buffer.from(await r.arrayBuffer());
  } else {
    throw new Error("image: 响应既无 b64_json 也无 url");
  }
  // gpt-image 默认 png；若 output_format 指定了 jpeg/webp，这里按魔数兜底
  if (buffer[0] === 0xff && buffer[1] === 0xd8) mime = "image/jpeg";
  else if (buffer.subarray(0, 4).toString("ascii") === "RIFF") mime = "image/webp";
  else if (buffer[0] === 0x89 && buffer[1] === 0x50) mime = "image/png";
  const u = data.usage;
  return { buffer, mime, usage: u ? { input: u.input_tokens ?? u.prompt_tokens ?? 0, output: u.output_tokens ?? u.completion_tokens ?? 0 } : undefined };
}

/** 纯文生图 */
export async function generateImage(opts: { prompt: string; size: string; quality?: ImageQuality }): Promise<ImageResult> {
  if (imageBackend() === "fal") return falGenerateImage(opts);
  const c = cfg();
  const body: Record<string, unknown> = { model: c.model, prompt: opts.prompt, size: opts.size, n: 1 };
  const rq = relayQuality(opts.quality);
  if (rq) body.quality = rq;
  const res = await fetch(`${c.baseUrl}/v1/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
  });
  return parseImageResponse(res);
}

/** 带参考图的生成（images/edits）。refs 为空时自动退化为文生图。 */
export async function generateImageWithRefs(opts: {
  prompt: string;
  size: string;
  refs: ImageRef[];
  quality?: ImageQuality;
  /** 要透明背景（只有 fal 的 gpt-image-2.5 认；中转站忽略） */
  transparent?: boolean;
}): Promise<ImageResult> {
  if (imageBackend() === "fal") return falGenerateImageWithRefs(opts);
  if (opts.refs.length === 0) return generateImage(opts);
  const c = cfg();
  const form = new FormData();
  form.set("model", c.model);
  form.set("prompt", opts.prompt);
  form.set("size", opts.size);
  form.set("n", "1");
  const rq = relayQuality(opts.quality);
  if (rq) form.set("quality", rq);
  opts.refs.slice(0, 16).forEach((r, i) => {
    const ext = r.mime === "image/jpeg" ? "jpg" : r.mime === "image/webp" ? "webp" : "png";
    form.append("image[]", new Blob([new Uint8Array(r.buffer)], { type: r.mime }), r.name ?? `ref-${i + 1}.${ext}`);
  });
  const res = await fetch(`${c.baseUrl}/v1/images/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
  });
  return parseImageResponse(res);
}

/**
 * 出图成本估算（USD，仅用于展示）。
 * relay：按 gpt-image-2 官方 token 价粗估；fal：没有 usage，按官方价目表查尺寸×档位。
 */
export function estimateImageCost(usage?: { input: number; output: number }, size?: string, quality?: ImageQuality) {
  if (imageBackend() === "fal" && size) return falEstimateImageCost(size, quality);
  if (!usage) return 0.04;
  return Math.round((usage.input * 0.000005 + usage.output * 0.00004) * 1000) / 1000;
}
