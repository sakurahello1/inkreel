// 按实际语音区间对齐的 SRT
const { PrismaClient } = require("@prisma/client");
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const db = new PrismaClient();
const STORAGE = "G:/short-play-data/storage";
const split = (t) => { const p = t.split(/(?<=[。！？!?])/).map(x => x.trim()).filter(Boolean); return p.length ? p : [t.trim()]; };
const ts = (s) => { const h = Math.floor(s/3600), m = Math.floor(s%3600/60), x = s%60; return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${x.toFixed(3).padStart(6,"0").replace(".",",")}`; };
const ff = (a) => { const r = spawnSync("ffmpeg", a, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }); return (r.stdout || "") + (r.stderr || ""); };

/** 在 [0,len] 内找出语音段（相对剪切后的片段） */
function speechSpans(file, start, len) {
  const log = ff(["-hide_banner","-nostats","-ss",String(start),"-t",String(len),"-i",file,"-af","silencedetect=noise=-32dB:d=0.25","-f","null","-"]);
  const ev = [];
  for (const m of log.matchAll(/silence_(start|end):\s*([0-9.]+)/g)) ev.push([m[1], parseFloat(m[2])]);
  const spans = [];
  let cur = 0;
  for (const [k, t] of ev) {
    if (k === "start") { if (t - cur > 0.12) spans.push([cur, Math.min(t, len)]); }
    else cur = t;
  }
  if (len - cur > 0.12) spans.push([cur, len]);
  return spans.filter(([a, b]) => b - a > 0.25);
}

(async () => {
  const shots = await db.shot.findMany({ where: { chapterId: "cmtsuvqty000pv7ck7772exk5", clipEnabled: true, video: { isNot: null } }, orderBy: { index: "asc" }, include: { video: true } });
  const out = []; let at = 0, n = 0, aligned = 0, fallback = 0;
  for (const s of shots) {
    const file = path.join(STORAGE, s.video.path);
    const d = parseFloat(execFileSync("ffprobe",["-v","error","-show_entries","format=duration","-of","csv=p=0",file]).toString().trim());
    const start = Math.min(Math.max(0, s.clipIn), Math.max(0, d - 0.2));
    const end = s.clipOut && s.clipOut > start + 0.2 ? Math.min(s.clipOut, d) : d;
    const len = end - start;
    const lines = (s.clipSubtitle.trim() ? s.clipSubtitle.split(/\r?\n+/) : JSON.parse(s.dialogue||"[]").map(x=>x.line)).map(x=>x.trim()).filter(Boolean);
    const cues = lines.flatMap(split);
    if (cues.length) {
      const spans = speechSpans(file, start, len);
      if (spans.length === cues.length) {
        // 语音段数与句数一致：逐句对齐，最精确
        cues.forEach((c, i) => { out.push(`${++n}\n${ts(at+spans[i][0]-0.1 > at ? at+spans[i][0]-0.1 : at)} --> ${ts(at+Math.min(spans[i][1]+0.25, len))}\n${c}\n`); });
        aligned++;
      } else {
        // 否则按字数在整体语音区间内分配
        const lo = spans.length ? Math.max(0, spans[0][0]-0.1) : 0;
        const hi = spans.length ? Math.min(len, spans[spans.length-1][1]+0.25) : len;
        const w = cues.map(c => Math.max(2, c.length));
        const tw = w.reduce((a,b)=>a+b,0);
        const gap = 0.1;
        const usable = Math.max(0.5, (hi-lo) - gap*(cues.length-1));
        let t = lo;
        cues.forEach((c,i) => { const dd = Math.max(0.7, (w[i]/tw)*usable); const e = Math.min(hi, t+dd); out.push(`${++n}\n${ts(at+t)} --> ${ts(at+e)}\n${c}\n`); t = e+gap; });
        fallback++;
      }
    }
    at += len;
  }
  fs.writeFileSync("G:/short play production/养妹失策_推文_字幕.srt", "\ufeff" + out.join("\n"), "utf8");
  console.log(`${n} 条字幕；逐句精确对齐 ${aligned} 镜，按语音区间分配 ${fallback} 镜；正片 ${at.toFixed(2)}s`);
  await db.$disconnect();
})();
