import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { STORAGE_DIR } from "@/server/storage";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
};

const CACHE = "private, max-age=31536000, immutable";

/**
 * 必须支持 HTTP Range：没有 206 的话浏览器认为视频不可 seek（seekable 为 [0,0]），
 * 进度条拖不动、也没法跳到指定时码，而且每次播放都要整段下载。
 */
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await ctx.params;
  const rel = parts.join("/");
  const abs = path.resolve(STORAGE_DIR, rel);
  if (!abs.startsWith(STORAGE_DIR)) return new NextResponse("forbidden", { status: 403 });

  let size: number;
  try {
    const st = await fs.stat(abs);
    if (!st.isFile()) return new NextResponse("not found", { status: 404 });
    size = st.size;
  } catch {
    return new NextResponse("not found", { status: 404 });
  }

  const ext = abs.split(".").pop()?.toLowerCase() ?? "";
  const type = MIME[ext] ?? "application/octet-stream";
  const range = req.headers.get("range");

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m) {
      const hasStart = m[1] !== "";
      const hasEnd = m[2] !== "";
      let start = hasStart ? Number(m[1]) : 0;
      let end = hasEnd ? Number(m[2]) : size - 1;
      // bytes=-N 表示最后 N 字节
      if (!hasStart && hasEnd) {
        start = Math.max(0, size - Number(m[2]));
        end = size - 1;
      }
      if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < size) {
        end = Math.min(end, size - 1);
        const len = end - start + 1;
        const fh = await fs.open(abs, "r");
        try {
          const buf = Buffer.allocUnsafe(len);
          await fh.read(buf, 0, len, start);
          return new NextResponse(buf, {
            status: 206,
            headers: {
              "content-type": type,
              "content-length": String(len),
              "content-range": `bytes ${start}-${end}/${size}`,
              "accept-ranges": "bytes",
              "cache-control": CACHE,
            },
          });
        } finally {
          await fh.close();
        }
      }
      return new NextResponse("range not satisfiable", { status: 416, headers: { "content-range": `bytes */${size}` } });
    }
  }

  const buf = await fs.readFile(abs);
  return new NextResponse(buf, {
    headers: {
      "content-type": type,
      "content-length": String(size),
      "accept-ranges": "bytes",
      "cache-control": CACHE,
    },
  });
}

export async function HEAD(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await ctx.params;
  const abs = path.resolve(STORAGE_DIR, parts.join("/"));
  if (!abs.startsWith(STORAGE_DIR)) return new NextResponse(null, { status: 403 });
  try {
    const st = await fs.stat(abs);
    const ext = abs.split(".").pop()?.toLowerCase() ?? "";
    return new NextResponse(null, {
      headers: {
        "content-type": MIME[ext] ?? "application/octet-stream",
        "content-length": String(st.size),
        "accept-ranges": "bytes",
        "cache-control": CACHE,
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
