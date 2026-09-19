import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { db, parseJson } from "../db";
import { Job, errText } from "../core/job";
import { pageRenderHash } from "../lineage";
import { absPath, saveAsset } from "../storage";
import { renderPageClip, splitSentences } from "../ffmpeg";
import { PAGE_GAP, PAGE_LEAD, PAGE_TAIL } from "../services/narrated-service";

type Payload = { shotId: string };

/**
 * 说书的页视频：页图 + 这一页的全部配音 → 一段 mp4，存成镜头的 video。
 * 之后时间线、导出、成片页全是现成的——它们只认「镜头有一段视频」。
 * 字幕直接用 TTS 回的句级时间戳（相对本页），不用再对齐。
 */
export class PageRenderJob extends Job<Payload> {
  readonly type = "page.render";

  async run(p: Payload) {
    const shot = await db.shot.findUniqueOrThrow({
      where: { id: String(p.shotId) },
      include: { frame: true, utterances: { include: { asset: true }, orderBy: { order: "asc" } }, chapter: { include: { project: true } } },
    });
    const project = shot.chapter.project;
    const gen = await db.generation.create({
      data: { kind: "video", shotId: shot.id, unitId: shot.unitId, provider: "ffmpeg", model: "page-render", prompt: "", params: JSON.stringify({ route: "page" }), status: "running" },
    });
    const tmp = path.join(os.tmpdir(), `inkreel-page-${shot.id}-${Date.now()}.mp4`);
    try {
      if (!shot.frame) throw new Error("这一页还没有图");
      const missing = shot.utterances.filter((u) => !u.asset);
      if (missing.length) throw new Error(`还有 ${missing.length} 条没配音`);
      await db.shot.update({ where: { id: shot.id }, data: { status: "video_generating" } });

      // 排时间：页首留白 → 条 → 条间停顿 → … → 页尾留白
      let t = PAGE_LEAD;
      const audios: Array<{ file: string; offset: number }> = [];
      const cues: Array<{ text: string; start: number; end: number }> = [];
      for (const u of shot.utterances) {
        const dur = u.asset!.duration ?? u.duration ?? 1;
        audios.push({ file: absPath(u.asset!.path), offset: t });
        const ts = parseJson<Array<{ text: string; start: number; end: number }>>(u.timestamps, []);
        if (ts.length) {
          // MiniMax 的「句级」时间戳有时把整段旁白当一句返回，屏幕上会一次糊三行；超长的按句再切、时间按字数摊
          for (const c of ts) for (const piece of splitCue(c.text, c.start, c.end)) cues.push({ text: piece.text, start: round(t + piece.start), end: round(t + piece.end) });
        } else {
          // 没有时间戳：按句子字数比例铺满这条音频
          const sents = splitSentences(u.text);
          const total = sents.reduce((a, s) => a + Math.max(2, s.length), 0);
          let st = t;
          for (const s of sents) {
            const d = (Math.max(2, s.length) / total) * dur;
            cues.push({ text: s, start: round(st), end: round(st + d) });
            st += d;
          }
        }
        t += dur + PAGE_GAP;
      }
      const duration = round(Math.max(2, t - (shot.utterances.length ? PAGE_GAP : 0) + PAGE_TAIL));
      const [w, hh] = project.orientation === "16:9" ? [1920, 1080] : [1080, 1920];
      await renderPageClip({ image: absPath(shot.frame.path), audios, duration, width: w, height: hh, kenBurns: project.kenBurns, outFile: tmp });
      const asset = await saveAsset({ buffer: await fs.readFile(tmp), mime: "video/mp4", kind: "video", projectId: project.id, folder: "videos", duration });
      const h = pageRenderHash(shot, project);
      await db.$transaction([
        db.shot.update({
          where: { id: shot.id },
          data: { videoId: asset.id, status: "video_ready", videoInputHash: h, duration: Math.round(duration), subtitleCues: JSON.stringify(cues), asrText: `${asset.id}|tts`, reviewNote: "" },
        }),
        db.generation.update({ where: { id: gen.id }, data: { status: "success", resultId: asset.id, params: JSON.stringify({ route: "page", inputHash: h, duration, cues: cues.length }), finishedAt: new Date() } }),
      ]);
    } catch (err) {
      const { short, long } = errText(err);
      await db.$transaction([
        db.shot.update({ where: { id: shot.id }, data: { status: shot.frameId ? "frame_ready" : "draft", reviewNote: `页视频渲染失败：${short.slice(0, 300)}` } }),
        db.generation.update({ where: { id: gen.id }, data: { status: "failed", error: long, finishedAt: new Date() } }),
      ]);
      throw err;
    } finally {
      await fs.rm(tmp, { force: true }).catch(() => {});
    }
  }
}

const round = (x: number) => Math.round(x * 1000) / 1000;

/** 一条字幕最多这么多字，再长就按句切开 */
const MAX_CUE_CHARS = 24;

function splitCue(text: string, start: number, end: number): Array<{ text: string; start: number; end: number }> {
  const clean = text.trim();
  if (clean.length <= MAX_CUE_CHARS) return [{ text: clean, start, end }];
  // 先按句号切；还超长的句子再按逗号顿号贪心拼成不超过上限的小段
  const sents = splitSentences(clean).flatMap((x) => (x.length <= MAX_CUE_CHARS ? [x] : chunkByComma(x)));
  if (sents.length <= 1) return [{ text: clean, start, end }];
  const total = sents.reduce((a, x) => a + Math.max(2, x.length), 0);
  const out: Array<{ text: string; start: number; end: number }> = [];
  let st = start;
  for (const x of sents) {
    const d = (Math.max(2, x.length) / total) * (end - start);
    out.push({ text: x, start: st, end: st + d });
    st += d;
  }
  return out;
}

function chunkByComma(sentence: string) {
  const parts = sentence.split(/(?<=[，、；,;：:])/).map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const part of parts) {
    if (cur && cur.length + part.length > MAX_CUE_CHARS) {
      out.push(cur);
      cur = part;
    } else cur += part;
  }
  if (cur) out.push(cur);
  return out.length ? out : [sentence];
}
