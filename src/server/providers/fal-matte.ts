import sharp from "sharp";

/**
 * 立绘要的是真透明背景。gpt-image-2.5 在 fal 上接受 background=transparent，但不保证每次都给；
 * 没给的就丢给 birefnet 抠一遍。抠完再把四周的透明边裁掉，叠到画面上时定位才准。
 */

const TIMEOUT_MS = Number(process.env.IMAGE_TIMEOUT_MS || 8 * 60 * 1000);
const MATTE_MODEL = process.env.FAL_MATTE_MODEL || "fal-ai/birefnet/v2";

function key() {
  const k = process.env.FAL_KEY;
  if (!k) throw new Error("缺少 FAL_KEY");
  return k;
}

/** 有 alpha 通道且真的有透明像素（不是全不透明的 RGBA） */
export async function hasRealAlpha(buffer: Buffer) {
  const meta = await sharp(buffer).metadata();
  if (!meta.hasAlpha) return false;
  const st = await sharp(buffer).stats();
  const a = st.channels[3];
  if (!a) return false;
  return a.min < 16 && a.mean < 248;
}

/** birefnet 抠图：返回带 alpha 的 PNG */
export async function falRemoveBackground(buffer: Buffer, mime: string): Promise<Buffer> {
  const body = {
    image_url: `data:${mime};base64,${buffer.toString("base64")}`,
    model: "General Use (Light)",
    operating_resolution: "1024x1024",
    output_format: "png",
    refine_foreground: true,
  };
  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`https://fal.run/${MATTE_MODEL}`, {
        method: "POST",
        headers: { Authorization: `Key ${key()}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const raw = await res.text();
      if (!res.ok) throw new Error(`fal matte ${res.status}: ${raw.slice(0, 300)}`);
      const url = JSON.parse(raw)?.image?.url;
      if (!url) throw new Error(`fal matte: 响应无图 ${raw.slice(0, 200)}`);
      const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
      if (!r.ok) throw new Error(`fal matte: 下载失败 ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (err) {
      lastErr = err;
      console.warn(`[fal matte] attempt ${i + 1} failed: ${err instanceof Error ? err.message : String(err)}`);
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** 裁掉四周全透明的边，留一点点余量 */
export async function trimTransparent(buffer: Buffer): Promise<Buffer> {
  try {
    return await sharp(buffer).trim({ threshold: 8 }).png().toBuffer();
  } catch {
    return buffer;
  }
}

/**
 * 立绘后处理：一律抠图 → 裁边。
 * 实测 gpt-image 的「透明背景」会顺手画一圈聚光灯式的深色底（角上透明、人物周围不透明），
 * 只看有没有 alpha 判不出来；干脆先压平到白底再让 birefnet 抠一遍，人物边缘反而更干净。
 */
export async function toSprite(buffer: Buffer, mime: string): Promise<Buffer> {
  void mime;
  const flat = await sharp(buffer).flatten({ background: "#ffffff" }).png().toBuffer();
  const cut = await falRemoveBackground(flat, "image/png");
  return trimTransparent(cut);
}
