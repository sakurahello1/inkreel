import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { db } from "./db";
import { probe } from "./ffmpeg";

export const STORAGE_DIR = path.resolve(process.cwd(), process.env.STORAGE_DIR || "./storage");

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "video/mp4": "mp4",
};

export function assetUrl(rel: string | null | undefined) {
  if (!rel) return null;
  return `/api/files/${rel.split(path.sep).join("/")}`;
}

export function absPath(rel: string) {
  return path.join(STORAGE_DIR, rel);
}

export async function readAsset(rel: string) {
  return fs.readFile(absPath(rel));
}

export async function toDataUrl(rel: string, mime: string) {
  const buf = await readAsset(rel);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/**
 * 缩过的 data URL：长边不超过 maxSide 的 JPEG。
 * fal 的全能参考按图片 token 计费，2560 的三视图一张要收好几分钱，当参考图 1024 足够认人。
 */
export async function toDataUrlResized(rel: string, maxSide = 1024, opts: { leftHalf?: boolean } = {}) {
  let img = sharp(await readAsset(rel));
  if (opts.leftHalf) {
    // 场景图是左右两格的正反打拼图：整张送进视频模型，它会把空镜也画成分格。只送左边那一格
    const meta = await img.metadata();
    if (meta.width && meta.height && meta.width >= meta.height * 1.6) img = img.extract({ left: 0, top: 0, width: Math.floor(meta.width / 2), height: meta.height });
  }
  const buf = await img.resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

/** 把二进制写入 storage 并登记 Asset。图片会自动探测宽高。 */
export async function saveAsset(opts: {
  buffer: Buffer;
  mime: string;
  kind: "image" | "audio" | "video";
  projectId?: string | null;
  folder?: string;
  duration?: number | null;
}) {
  const ext = EXT[opts.mime] ?? "bin";
  const folder = opts.folder ?? opts.kind;
  const rel = path.posix.join(folder, `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}.${ext}`);
  const abs = absPath(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, opts.buffer);

  let width: number | null = null;
  let height: number | null = null;
  let duration = opts.duration ?? null;
  if (opts.kind === "image") {
    try {
      const meta = await sharp(opts.buffer).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
    } catch {
      /* ignore */
    }
  } else if (opts.kind === "video" || (opts.kind === "audio" && duration == null)) {
    try {
      const info = await probe(abs);
      duration = info.duration || duration;
      if (info.width) width = info.width;
      if (info.height) height = info.height;
    } catch {
      /* ffprobe 不可用时忽略 */
    }
  }

  return db.asset.create({
    data: {
      projectId: opts.projectId ?? null,
      kind: opts.kind,
      path: rel,
      mime: opts.mime,
      bytes: opts.buffer.length,
      width,
      height,
      duration,
    },
  });
}

/** 下载远程文件并落盘登记。 */
export async function saveAssetFromUrl(url: string, opts: { kind: "image" | "audio" | "video"; projectId?: string | null; folder?: string }) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`);
  const mime = (res.headers.get("content-type") || "").split(";")[0] || guessMime(url, opts.kind);
  const buffer = Buffer.from(await res.arrayBuffer());
  return saveAsset({ buffer, mime, kind: opts.kind, projectId: opts.projectId, folder: opts.folder });
}

function guessMime(url: string, kind: string) {
  const u = url.toLowerCase().split("?")[0];
  if (u.endsWith(".png")) return "image/png";
  if (u.endsWith(".jpg") || u.endsWith(".jpeg")) return "image/jpeg";
  if (u.endsWith(".webp")) return "image/webp";
  if (u.endsWith(".mp3")) return "audio/mpeg";
  if (u.endsWith(".wav")) return "audio/wav";
  if (u.endsWith(".mp4")) return "video/mp4";
  return kind === "image" ? "image/png" : kind === "audio" ? "audio/mpeg" : "video/mp4";
}
