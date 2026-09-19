/**
 * ffmpeg 合成：多段竖屏视频拼接 + 裁剪 + 淡入淡出 + ASS 字幕烧录 + BGM 混音。
 * 依赖系统 ffmpeg / ffprobe（Linux：apt install ffmpeg；带 libass）。
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

export function runBin(bin: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 200000) stderr = stderr.slice(-100000);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${bin} 超时`));
    }, opts.timeoutMs ?? 30 * 60 * 1000);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`无法启动 ${bin}：${err.message}（请确认已安装并在 PATH 中，或设置 FFMPEG_PATH / FFPROBE_PATH）`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${bin} 退出码 ${code}：${stderr.slice(-1500)}`));
    });
  });
}

export interface MediaInfo {
  duration: number;
  hasAudio: boolean;
  hasVideo: boolean;
  width: number;
  height: number;
}

export async function probe(file: string): Promise<MediaInfo> {
  const { stdout } = await runBin(FFPROBE, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file], { timeoutMs: 60000 });
  const d = JSON.parse(stdout) as { streams?: Array<{ codec_type: string; width?: number; height?: number; duration?: string }>; format?: { duration?: string } };
  const v = d.streams?.find((s) => s.codec_type === "video");
  const a = d.streams?.find((s) => s.codec_type === "audio");
  const duration = Number(d.format?.duration ?? v?.duration ?? a?.duration ?? 0);
  return { duration, hasAudio: Boolean(a), hasVideo: Boolean(v), width: v?.width ?? 0, height: v?.height ?? 0 };
}

/**
 * 截视频的最后一帧。用 -sseof 从末尾倒着定位，比先 probe 时长再 -ss 稳——
 * 有些容器的 duration 比实际最后一帧略大，正着算会落到空帧。
 */
export async function extractLastFrame(videoFile: string, outPng: string) {
  await runBin(FFMPEG, ["-v", "error", "-y", "-sseof", "-0.2", "-i", videoFile, "-update", "1", "-frames:v", "1", "-q:v", "2", outPng], { timeoutMs: 60000 });
  return outPng;
}

/**
 * 把几段视频首尾相接拼成一条。重编码而不是 -c copy：各段虽然来自同一模型，
 * 编码参数未必逐项一致，copy 拼出来的文件时间戳会乱。段与段之间的接缝是同一张关键帧图，
 * 前一段结束在它、后一段从它开始，视觉上连续。
 */
export async function concatVideos(files: string[], outFile: string) {
  if (files.length === 1) {
    await fs.copyFile(files[0], outFile);
    return outFile;
  }
  const list = `${outFile}.txt`;
  await fs.writeFile(list, files.map((f) => `file '${f.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"));
  try {
    await runBin(
      FFMPEG,
      ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", outFile],
      { timeoutMs: 10 * 60 * 1000 },
    );
  } finally {
    await fs.rm(list, { force: true }).catch(() => {});
  }
  return outFile;
}

/**
 * 截视频在第 t 秒的那一帧。-ss 放在 -i 前面：现代 ffmpeg 会先跳到最近的关键帧再解码到精确时间，
 * 既快又准；和浏览器里 video.currentTime 定位的误差在一帧以内。
 */
export async function extractFrameAt(videoFile: string, t: number, outPng: string) {
  await runBin(FFMPEG, ["-v", "error", "-y", "-ss", String(Math.max(0, t)), "-i", videoFile, "-update", "1", "-frames:v", "1", "-q:v", "2", outPng], { timeoutMs: 60000 });
  return outPng;
}

/**
 * 说书的一页：一张图 + 若干段配音 → 一段 mp4。图做缓慢推拉（Ken Burns），配音按各自的起点铺进去。
 * 先按画幅裁满、放大两倍再 zoompan，否则整数像素步进会抖。没有配音的页就是静音的图。
 */
export async function renderPageClip(opts: {
  image: string;
  /** 按顺序的配音文件；offset 是它在本页里的起点（秒） */
  audios: Array<{ file: string; offset: number }>;
  duration: number;
  width: number;
  height: number;
  /** 推拉幅度，0 关；0.06 ≈ 6% 缓慢推近 */
  kenBurns: number;
  fps?: number;
  outFile: string;
}) {
  const fps = opts.fps ?? 24;
  const N = Math.max(fps, Math.round(opts.duration * fps));
  const kb = Math.max(0, opts.kenBurns);
  const inputs = ["-loop", "1", "-framerate", String(fps), "-t", String(n(opts.duration)), "-i", opts.image];
  for (const a of opts.audios) inputs.push("-i", a.file);
  const filters: string[] = [];
  filters.push(
    `[0:v]scale=${opts.width}:${opts.height}:force_original_aspect_ratio=increase,crop=${opts.width}:${opts.height},scale=${opts.width * 2}:${opts.height * 2}:flags=lanczos,` +
      `zoompan=z='1+${n(kb)}*on/${N}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${opts.width}x${opts.height}:fps=${fps},format=yuv420p,trim=duration=${n(opts.duration)},setpts=PTS-STARTPTS[v]`,
  );
  if (opts.audios.length) {
    const parts: string[] = [];
    opts.audios.forEach((a, i) => {
      const ms = Math.round(a.offset * 1000);
      filters.push(`[${i + 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${ms}|${ms}[a${i}]`);
      parts.push(`[a${i}]`);
    });
    filters.push(`${parts.join("")}amix=inputs=${opts.audios.length}:normalize=0:dropout_transition=0,apad,atrim=0:${n(opts.duration)},asetpts=PTS-STARTPTS[a]`);
  } else {
    filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${n(opts.duration)}[a]`);
  }
  await runBin(
    FFMPEG,
    ["-y", "-hide_banner", "-loglevel", "error", ...inputs, "-filter_complex", filters.join(";"), "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-r", String(fps), "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-t", String(n(opts.duration)), opts.outFile],
    { timeoutMs: 10 * 60 * 1000 },
  );
  return opts.outFile;
}

/** 把视频的人声轨抽成 16k 单声道 mp3，给 ASR 用 */
export async function extractSpeech(videoFile: string, outFile: string) {
  await runBin(FFMPEG, ["-v", "error", "-y", "-i", videoFile, "-vn", "-ar", "16000", "-ac", "1", outFile], { timeoutMs: 120000 });
  return outFile;
}

/**
 * 从曲子的 trackStart 处裁出 len 秒，写成 mp3。曲子不够长会自动循环。
 * 用于把每一镜对应的那段 BGM 送给视频模型。
 */
export async function cutAudioSegment(opts: { file: string; trackStart: number; len: number; outFile: string; volume?: number }) {
  const start = Math.max(0, opts.trackStart);
  const len = Math.max(0.1, opts.len);
  const vol = opts.volume ?? 1;
  const chain = [`atrim=start=${n(start)}:end=${n(start + len)}`, "asetpts=PTS-STARTPTS", "aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo"];
  if (vol !== 1) chain.push(`volume=${n(vol)}`);
  await runBin(
    FFMPEG,
    ["-y", "-hide_banner", "-loglevel", "error", "-stream_loop", "-1", "-i", opts.file, "-filter_complex", `[0:a]${chain.join(",")}[a]`, "-map", "[a]", "-t", String(n(len)), "-c:a", "libmp3lame", "-q:a", "4", opts.outFile],
    { timeoutMs: 5 * 60 * 1000 },
  );
  return opts.outFile;
}

export interface ExportClip {
  file: string;
  inPoint: number;
  outPoint: number | null;
  fadeIn: number;
  fadeOut: number;
  subtitleLines: string[];
  /** 对齐好的字幕（时间相对原始成片）。有它就不按字数比例铺 */
  cues?: Array<{ text: string; start: number; end: number }>;
}

/** 一段 BGM：从曲子的 trackStart 处取 len 秒，铺到成片的 at 秒位置 */
export interface BgmSegment {
  file: string;
  trackStart: number;
  at: number;
  len: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
}

/** 片尾字卡：在成片末尾接一段纯色画面，居中打字，用于放引流文案 */
export interface EndCard {
  lines: string[];
  seconds: number;
  /** 主标题字号，副行自动小一号 */
  fontSize?: number;
}

export interface ExportOptions {
  clips: ExportClip[];
  bgmSegments?: BgmSegment[];
  endCard?: EndCard | null;
  subtitles: boolean;
  fontName: string;
  width?: number;
  height?: number;
  fps?: number;
  outFile: string;
  onLog?: (line: string) => void;
}

function n(x: number) {
  return Number.isFinite(x) ? Math.round(x * 1000) / 1000 : 0;
}

/** 入点/出点夹取，导出与 BGM 段落计算共用同一套规则 */
export function resolveTrim(duration: number, inPoint: number, outPoint: number | null) {
  const start = Math.min(Math.max(0, inPoint), Math.max(0, duration - 0.2));
  const end = outPoint && outPoint > start + 0.2 ? Math.min(outPoint, duration) : duration;
  return { start: n(start), end: n(end), len: n(end - start) };
}

function assTime(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec - Math.floor(sec)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function assEscape(text: string) {
  // 先把已插好的 \N 占位，转义后再还原，避免被当成普通反斜杠
  const PH = "\u0000NL\u0000";
  return text
    .replace(/\\N/g, PH)
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "(")
    .replace(/\}/g, ")")
    .replace(/\r?\n/g, PH)
    .split(PH)
    .join("\\N");
}

/**
 * 字幕排版随画幅走。
 *
 * 这几个数原本是照 1080x1920 竖屏调出来的：字号 62、下边距 190。
 * 直接套到 1920x1080 横屏上，字会显得偏小、位置偏高（横屏总高只有竖屏的 56%）。
 * 改成按短边比例缩放——短边才是决定「字看起来多大」的那一维。
 */
const SUB_BASE_SHORT = 1080; // 调参时的短边
const SUB_FONT_SIZE_BASE = 62;
const SUB_MARGIN_BASE = 80;
const SUB_MARGIN_V_BASE = 190;

function subStyle(width: number, height: number) {
  const k = Math.min(width, height) / SUB_BASE_SHORT;
  return {
    font: Math.round(SUB_FONT_SIZE_BASE * k),
    margin: Math.round(SUB_MARGIN_BASE * k),
    // 横屏画面矮，下边距按比例缩会贴得太近底边，这里再压一档
    marginV: Math.round(SUB_MARGIN_V_BASE * k * (width > height ? 0.62 : 1)),
  };
}

/** 中文没有空格，libass 不会自动断行，必须自己拆。优先在标点处断，其次硬断。 */
export function wrapCjk(text: string, maxChars: number) {
  const t = text.trim();
  if (t.length <= maxChars) return [t];
  const lines: string[] = [];
  let rest = t;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars + 1);
    // 在窗口内找最靠后的标点作为断点（标点跟在上一行末尾）
    let cut = -1;
    for (let i = window.length - 1; i >= Math.floor(maxChars * 0.4); i--) {
      if ("，,、；;：:。.！!？?—".includes(window[i])) {
        cut = i + 1;
        break;
      }
    }
    if (cut <= 0) cut = maxChars;
    lines.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) lines.push(rest);
  return lines;
}

/** 一句台词里若含多个句子，拆成多条字幕分别计时，避免一条挂太久 */
export function splitSentences(text: string) {
  const parts = text
    .split(/(?<=[。！？!?])/)
    .map((x) => x.trim())
    .filter(Boolean);
  return parts.length ? parts : [text.trim()];
}

/** 把每段的台词铺在该段时间内生成 ASS 字幕：有对齐时间的按时间，没有的按字数比例 */
export function buildAss(
  segments: Array<{ offset: number; len: number; lines: string[]; cues?: Array<{ text: string; start: number; end: number }> }>,
  opts: { fontName: string; width: number; height: number; endFontSize?: number; endCard?: { at: number; seconds: number; lines: string[] } | null },
) {
  const sub = subStyle(opts.width, opts.height);
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${opts.width}
PlayResY: ${opts.height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${opts.fontName},${sub.font},&H00FFFFFF,&H000000FF,&H00141210,&H80000000,1,0,0,0,100,100,1,0,1,4.5,1.5,2,${sub.margin},${sub.margin},${sub.marginV},1
Style: EndBig,${opts.fontName},${opts.endFontSize ?? 92},&H00FFFFFF,&H000000FF,&H00141210,&H00000000,1,0,0,0,100,100,4,0,1,0,0,5,60,60,60,1
Style: EndSmall,${opts.fontName},${Math.round((opts.endFontSize ?? 92) * 0.62)},&H00D8CFC2,&H000000FF,&H00141210,&H00000000,0,0,0,0,100,100,2,0,1,0,0,5,60,60,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  // 一行最多能放几个中文字：可用宽度 ÷ 字号（中文近似方块字）
  const maxChars = Math.max(8, Math.floor((opts.width - sub.margin * 2) / sub.font));
  const events: string[] = [];
  for (const seg of segments) {
    // 对齐过的：时间是相对本段入点的秒数，夹在段内
    if (seg.cues?.length) {
      for (const c of seg.cues) {
        const start = seg.offset + Math.max(0, c.start);
        const end = seg.offset + Math.min(seg.len, c.end);
        if (end > start + 0.15) events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${assEscape(wrapCjk(c.text, maxChars).join("\\N"))}`);
      }
      continue;
    }
    // 先按句号问号感叹号拆成独立字幕条，每条再按宽度断行
    const cues = seg.lines
      .map((l) => l.trim())
      .filter(Boolean)
      .flatMap((l) => splitSentences(l))
      .map((sentence) => wrapCjk(sentence, maxChars).join("\\N"));
    if (!cues.length) continue;
    const weights = cues.map((c) => Math.max(2, c.replace(/\\N/g, "").length));
    const totalW = weights.reduce((a, b) => a + b, 0);
    const gap = 0.12;
    const usable = Math.max(0.5, seg.len - gap * (cues.length - 1));
    let t = seg.offset;
    cues.forEach((cue, i) => {
      const d = Math.max(0.7, (weights[i] / totalW) * usable);
      const end = Math.min(seg.offset + seg.len, t + d);
      if (end > t + 0.15) events.push(`Dialogue: 0,${assTime(t)},${assTime(end)},Default,,0,0,0,,${assEscape(cue)}`);
      t = end + gap;
    });
  }
  // 片尾字卡：首行大字，其余行小一号，逐行错开淡入
  const ec = opts.endCard;
  if (ec && ec.lines.length) {
    const n = ec.lines.length;
    const lineH = Math.round((opts.endFontSize ?? 92) * 1.5);
    const top = Math.round(opts.height / 2 - ((n - 1) * lineH) / 2);
    ec.lines.forEach((line, i) => {
      const st = ec.at + Math.min(0.35 * i, ec.seconds * 0.4);
      const y = top + i * lineH;
      const style = i === 0 ? "EndBig" : "EndSmall";
      events.push(
        `Dialogue: 0,${assTime(st)},${assTime(ec.at + ec.seconds)},${style},,0,0,0,,{\\an5\\pos(${Math.round(opts.width / 2)},${y})\\fad(400,0)}${assEscape(line)}`,
      );
    });
  }
  return header + events.join("\n") + "\n";
}

function filterPath(p: string) {
  // subtitles 滤镜里的路径：统一正斜杠，转义冒号
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export async function exportTimeline(opts: ExportOptions) {
  const W = opts.width ?? 1080;
  const H = opts.height ?? 1920;
  const FPS = opts.fps ?? 24;
  if (opts.clips.length === 0) throw new Error("没有可导出的片段");

  const infos = await Promise.all(opts.clips.map((c) => probe(c.file)));
  const segs = opts.clips.map((c, i) => {
    const t = resolveTrim(infos[i].duration, c.inPoint, c.outPoint);
    return { ...c, ...t, hasAudio: infos[i].hasAudio };
  });
  const shotsTotal = n(segs.reduce((a, s) => a + s.len, 0));

  const inputs: string[] = [];
  const filters: string[] = [];
  const endSecPre = opts.endCard && opts.endCard.lines.length ? Math.max(2, opts.endCard.seconds) : 0;
  const total = n(shotsTotal + endSecPre);
  segs.forEach((s, i) => {
    inputs.push("-i", s.file);
    let v = `[${i}:v]trim=start=${s.start}:end=${s.end},setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS},format=yuv420p`;
    if (s.fadeIn > 0) v += `,fade=t=in:st=0:d=${n(s.fadeIn)}`;
    if (s.fadeOut > 0) v += `,fade=t=out:st=${n(Math.max(0, s.len - s.fadeOut))}:d=${n(s.fadeOut)}`;
    filters.push(`${v}[v${i}]`);
    if (s.hasAudio) {
      let a = `[${i}:a]atrim=start=${s.start}:end=${s.end},asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo`;
      if (s.fadeIn > 0) a += `,afade=t=in:st=0:d=${n(s.fadeIn)}`;
      if (s.fadeOut > 0) a += `,afade=t=out:st=${n(Math.max(0, s.len - s.fadeOut))}:d=${n(s.fadeOut)}`;
      filters.push(`${a}[a${i}]`);
    } else {
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${s.len},asetpts=PTS-STARTPTS[a${i}]`);
    }
  });
  // 片尾字卡：一段纯色画面 + 静音，拼在所有镜头之后
  const endSec = endSecPre;
  if (endSec > 0) {
    const i = segs.length;
    filters.push(`color=c=0x141210:s=${W}x${H}:d=${n(endSec)}:r=${FPS},format=yuv420p,fade=t=in:st=0:d=0.5[v${i}]`);
    filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${n(endSec)},asetpts=PTS-STARTPTS[a${i}]`);
  }
  const nSeg = segs.length + (endSec > 0 ? 1 : 0);
  filters.push(`${Array.from({ length: nSeg }, (_, i) => `[v${i}][a${i}]`).join("")}concat=n=${nSeg}:v=1:a=1[vc][ac]`);

  let vOut = "[vc]";
  let aOut = "[ac]";
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "slate-export-"));
  try {
    if (opts.subtitles || endSec > 0) {
      let offset = 0;
      const segments = segs.map((s) => {
        // 对齐时间是相对原始文件的，减掉入点变成相对本段；落在裁掉部分的条目丢弃
        const cues = opts.subtitles && s.cues?.length ? s.cues.map((c) => ({ text: c.text, start: c.start - s.start, end: c.end - s.start })).filter((c) => c.end > 0.15 && c.start < s.len) : undefined;
        const seg = { offset, len: s.len, lines: opts.subtitles ? s.subtitleLines : [], cues };
        offset += s.len;
        return seg;
      });
      const endCard = endSec > 0 && opts.endCard ? { at: shotsTotal, seconds: endSec, lines: opts.endCard.lines } : null;
      if (segments.some((s) => s.lines.some((l) => l.trim())) || endCard) {
        const assFile = path.join(tmpDir, "subs.ass");
        await fs.writeFile(assFile, buildAss(segments, { fontName: opts.fontName, width: W, height: H, endFontSize: opts.endCard?.fontSize, endCard }), "utf8");
        filters.push(`[vc]subtitles='${filterPath(assFile)}'[vs]`);
        vOut = "[vs]";
      }
    }
    const bgm = (opts.bgmSegments ?? []).filter((b) => b.len > 0.05);
    if (bgm.length) {
      const labels: string[] = [];
      bgm.forEach((b, j) => {
        const idx = inputs.filter((x) => x === "-i").length; // 当前输入序号
        inputs.push("-stream_loop", "-1", "-i", b.file); // 无限循环，短曲子也能取到任意偏移
        let f = `[${idx}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,atrim=start=${n(b.trackStart)}:end=${n(b.trackStart + b.len)},asetpts=PTS-STARTPTS,volume=${n(b.volume)}`;
        if (b.fadeIn > 0) f += `,afade=t=in:st=0:d=${n(Math.min(b.fadeIn, b.len / 2))}`;
        if (b.fadeOut > 0) f += `,afade=t=out:st=${n(Math.max(0, b.len - b.fadeOut))}:d=${n(Math.min(b.fadeOut, b.len / 2))}`;
        if (b.at > 0) f += `,adelay=${Math.round(b.at * 1000)}:all=1`;
        filters.push(`${f}[b${j}]`);
        labels.push(`[b${j}]`);
      });
      filters.push(`[ac]${labels.join("")}amix=inputs=${labels.length + 1}:duration=first:normalize=0[am]`);
      aOut = "[am]";
    }

    // 成片整体开头淡入、结尾淡出，收得干净一点
    const inD = Math.min(0.6, total / 8);
    const outD = Math.min(1.2, total / 6);
    filters.push(`${vOut}fade=t=in:st=0:d=${n(inD)},fade=t=out:st=${n(Math.max(0, total - outD))}:d=${n(outD)}[vf]`);
    filters.push(`${aOut}afade=t=in:st=0:d=${n(inD)},afade=t=out:st=${n(Math.max(0, total - outD))}:d=${n(outD)}[af]`);
    vOut = "[vf]";
    aOut = "[af]";

    const args = [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      ...inputs,
      "-filter_complex",
      filters.join(";"),
      "-map",
      vOut,
      "-map",
      aOut,
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(FPS),
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-movflags",
      "+faststart",
      "-t",
      String(total),
      opts.outFile,
    ];
    opts.onLog?.(`ffmpeg ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`);
    await runBin(FFMPEG, args);
    return { total, segments: segs.length, endCard: endSec };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
