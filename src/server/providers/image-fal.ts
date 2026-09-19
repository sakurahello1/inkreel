import type { ImageRef, ImageResult } from "./image";

/**
 * fal.ai 上的 gpt-image-2.5（flare）。
 *
 * 为什么另开一个后端：中转站的 gpt-image-2 一张首帧约 $0.058，fal 的 flare low 档
 * 2560x1440 只要 $0.00615，便宜十倍，实测画质不输甚至更好，还快一倍。
 * 参考图走 image_urls（≤16 张，接受 data URI），尺寸接受任意 {width,height}，
 * 质量六档，接口形状跟我们已有的 generateImageWithRefs 一一对得上。
 *
 * 计价是真美元（中转站那边是 1 元充 1 美元额度）。
 */

const FAL_IMAGE_MODEL = process.env.FAL_IMAGE_MODEL || "openai/gpt-image-2.5/flare";
const TIMEOUT_MS = Number(process.env.IMAGE_TIMEOUT_MS || 8 * 60 * 1000);

export type FalQuality = "auto" | "low" | "medium" | "high" | "xhigh" | "max";
export type ImageQuality = FalQuality;
export const IMAGE_QUALITIES: ImageQuality[] = ["low", "medium", "high", "xhigh", "max"];

function key() {
  const k = process.env.FAL_KEY;
  if (!k) throw new Error("缺少 FAL_KEY");
  return k;
}

function parseSize(size: string) {
  const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(size.trim());
  if (!m) throw new Error(`尺寸格式不对：${size}`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

/** 连接层抖动（fetch failed / 超时）重试三次；fal 返回了状态码就不重试 */
async function post(path: string, body: Record<string, unknown>) {
  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      return await fetch(`https://fal.run/${path}`, {
        method: "POST",
        headers: { Authorization: `Key ${key()}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      lastErr = err;
      console.warn(`[fal image] attempt ${i + 1} failed: ${err instanceof Error ? err.message : String(err)}`);
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function call(path: string, body: Record<string, unknown>): Promise<ImageResult> {
  const res = await post(path, body);
  const raw = await res.text();
  if (!res.ok) throw new Error(`fal image ${res.status}: ${raw.slice(0, 400)}`);
  const data = JSON.parse(raw);
  const item = data.images?.[0];
  if (!item?.url) throw new Error(`fal image: 响应无图: ${raw.slice(0, 200)}`);
  // 结果已经生成、也已经付费了：下载这一步网络抖动就多试几次，别让钱白花
  let buffer: Buffer | null = null;
  let r: Response | null = null;
  let lastErr: unknown;
  for (let i = 0; i < 4 && !buffer; i++) {
    try {
      r = await fetch(item.url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
      if (!r.ok) throw new Error(`fal image: 下载结果失败 ${r.status}`);
      buffer = Buffer.from(await r.arrayBuffer());
    } catch (err) {
      lastErr = err;
      console.warn(`[fal image] download attempt ${i + 1} failed: ${err instanceof Error ? err.message : String(err)}`);
      await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
    }
  }
  if (!buffer || !r) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  const mime = String(item.content_type || r.headers.get("content-type") || "image/png").split(";")[0];
  return { buffer, mime, usage: undefined };
}

/** 文生图 */
export function falGenerateImage(opts: { prompt: string; size: string; quality?: FalQuality }): Promise<ImageResult> {
  return call(`${FAL_IMAGE_MODEL}/text-to-image`, {
    prompt: opts.prompt,
    image_size: parseSize(opts.size),
    quality: opts.quality ?? defaultQuality(),
    output_format: "png",
    num_images: 1,
  });
}

/** 带参考图 */
export function falGenerateImageWithRefs(opts: { prompt: string; size: string; refs: ImageRef[]; quality?: FalQuality }): Promise<ImageResult> {
  if (opts.refs.length === 0) return falGenerateImage(opts);
  return call(`${FAL_IMAGE_MODEL}/edit`, {
    prompt: opts.prompt,
    image_urls: opts.refs.slice(0, 16).map((r) => `data:${r.mime};base64,${r.buffer.toString("base64")}`),
    image_size: parseSize(opts.size),
    quality: opts.quality ?? defaultQuality(),
    output_format: "png",
    num_images: 1,
  });
}

/** 兜底档位（项目没设时）。实测 low 档 2K 首帧已经不输中转站的 gpt-image-2 */
export function defaultQuality(): FalQuality {
  return (process.env.FAL_IMAGE_QUALITY || "low") as FalQuality;
}

/** 把项目/镜头上存的字符串收敛成合法档位 */
export function normalizeQuality(q?: string | null): FalQuality {
  return q && (IMAGE_QUALITIES as string[]).includes(q) ? (q as FalQuality) : defaultQuality();
}

/**
 * fal 官方价目（美元/张），按用户给的表。不在表里的尺寸按最接近的像素数估。
 */
const PRICE: Array<{ px: number; low: number; medium: number; high: number; xhigh: number; max: number }> = [
  { px: 1024 * 768, low: 0.00402, medium: 0.00903, high: 0.03612, xhigh: 0.0642, max: 0.14445 },
  { px: 1024 * 1024, low: 0.00588, medium: 0.01317, high: 0.05268, xhigh: 0.09366, max: 0.21072 },
  { px: 1024 * 1536, low: 0.00474, medium: 0.01029, high: 0.04116, xhigh: 0.07377, max: 0.16464 },
  { px: 1920 * 1080, low: 0.00441, medium: 0.01029, high: 0.0396, xhigh: 0.07041, max: 0.1584 },
  { px: 2560 * 1440, low: 0.00615, medium: 0.01434, high: 0.05529, xhigh: 0.09828, max: 0.2211 },
  { px: 3840 * 2160, low: 0.01113, medium: 0.02595, high: 0.10008, xhigh: 0.1779, max: 0.40026 },
];

export function falEstimateImageCost(size: string, quality: FalQuality = defaultQuality()) {
  const { width, height } = parseSize(size);
  const px = width * height;
  const row = PRICE.reduce((best, r) => (Math.abs(r.px - px) < Math.abs(best.px - px) ? r : best), PRICE[0]);
  const q = quality === "auto" ? "high" : quality;
  return row[q];
}
