import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { db, parseJson } from "../db";
import { Job, errText } from "../core/job";
import { pageRenderHash } from "../lineage";
import { absPath, saveAsset } from "../storage";
import { buildGalgameAss, renderPageClip, splitSentences, type GalBlock } from "../ffmpeg";
import { splitCue } from "@/lib/cues";
import { PAGE_GAP, PAGE_LEAD, PAGE_TAIL } from "../services/narrated-service";
import { DEFAULT_EXPRESSION } from "@/lib/narrated";

type Payload = { shotId: string };

/**
 * 说书的页视频：页图 + 这一页的全部配音 → 一段 mp4，存成镜头的 video。
 * 之后时间线、导出、成片页全是现成的——它们只认「镜头有一段视频」。
 * 字幕直接用 TTS 回的句级时间戳（相对本页），不用再对齐。
 *
 * 展示方式：
 *   subtitle — 字幕条留给导出时烧（和短剧一样）
 *   galgame  — 底部对话框 + 名牌 + 逐字打出 + 说话人立绘，全部在这里烧进页视频，导出不再叠
 */
export class PageRenderJob extends Job<Payload> {
  readonly type = "page.render";

  async run(p: Payload) {
    const shot = await db.shot.findUniqueOrThrow({
      where: { id: String(p.shotId) },
      include: {
        frame: true,
        utterances: { include: { asset: true }, orderBy: { order: "asc" } },
        chapter: { include: { project: { include: { characters: { include: { personas: { include: { sprites: { include: { asset: true } } } } } } } } } },
      },
    });
    const project = shot.chapter.project;
    const galgame = project.presentStyle === "galgame";
    const gen = await db.generation.create({
      data: { kind: "video", shotId: shot.id, unitId: shot.unitId, provider: "ffmpeg", model: galgame ? "page-render:galgame" : "page-render", prompt: "", params: JSON.stringify({ route: "page", style: project.presentStyle }), status: "running" },
    });
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `inkreel-page-${shot.id.slice(-6)}-`));
    const tmp = path.join(tmpDir, "page.mp4");
    try {
      if (!shot.frame) throw new Error("这一页还没有图");
      const missing = shot.utterances.filter((u) => !u.asset);
      if (missing.length) throw new Error(`还有 ${missing.length} 条没配音`);
      await db.shot.update({ where: { id: shot.id }, data: { status: "video_generating" } });

      // 排时间：页首留白 → 条 → 条间停顿 → … → 页尾留白
      let t = PAGE_LEAD;
      const audios: Array<{ file: string; offset: number }> = [];
      const cues: Array<{ text: string; start: number; end: number }> = [];
      const blocks: GalBlock[] = [];
      const sprites: Array<{ file: string; start: number; end: number; side: "left" | "right" }> = [];
      const spriteIds: string[] = [];
      const shotChars = parseJson<Array<{ characterId: string; personaTag: string }>>(shot.characters, []);
      const dialogue = parseJson<Array<{ characterId: string; line: string; expression?: string }>>(shot.dialogue, []).filter((d) => d.line.trim());
      const sides = new Map<string, "left" | "right">();
      let lineIdx = 0;

      for (const u of shot.utterances) {
        const dur = u.asset!.duration ?? u.duration ?? 1;
        audios.push({ file: absPath(u.asset!.path), offset: t });
        const ts = parseJson<Array<{ text: string; start: number; end: number }>>(u.timestamps, []);
        const pieces: Array<{ text: string; start: number; end: number }> = [];
        if (ts.length) {
          // MiniMax 的「句级」时间戳有时把整段旁白当一句返回，屏幕上会一次糊三行；超长的按句再切、时间按字数摊
          for (const c of ts) for (const piece of splitCue(c.text, c.start, c.end)) pieces.push({ text: piece.text, start: round(t + piece.start), end: round(t + piece.end) });
        } else {
          // 没有时间戳：按句子字数比例铺满这条音频
          const sents = splitSentences(u.text);
          const total = sents.reduce((a, s) => a + Math.max(2, s.length), 0);
          let st = t;
          for (const s of sents) {
            const d = (Math.max(2, s.length) / total) * dur;
            pieces.push({ text: s, start: round(st), end: round(st + d) });
            st += d;
          }
        }
        cues.push(...pieces);

        if (galgame) {
          const d = u.kind === "line" ? dialogue[lineIdx++] : null;
          const ch = u.kind === "line" && u.characterId ? project.characters.find((c) => c.id === u.characterId) : null;
          blocks.push({ kind: u.kind === "line" ? "line" : "narration", name: ch?.name ?? "", pieces });
          if (ch) {
            // 说话人站哪边：按首次开口的先后左右交替
            if (!sides.has(ch.id)) sides.set(ch.id, sides.size % 2 === 0 ? "right" : "left");
            const tag = shotChars.find((x) => x.characterId === ch.id)?.personaTag;
            const persona = ch.personas.find((x) => x.tag === tag) ?? ch.personas[0];
            const want = d?.expression || DEFAULT_EXPRESSION;
            const sprite =
              persona?.sprites.find((s) => s.expression === want && s.asset) ??
              persona?.sprites.find((s) => s.expression === DEFAULT_EXPRESSION && s.asset) ??
              persona?.sprites.find((s) => s.asset);
            if (sprite?.asset) {
              sprites.push({ file: absPath(sprite.asset.path), start: round(Math.max(0, t - 0.1)), end: round(t + dur + PAGE_GAP * 0.6), side: sides.get(ch.id)! });
              spriteIds.push(sprite.asset.id);
            }
          }
        }
        t += dur + PAGE_GAP;
      }
      const duration = round(Math.max(2, t - (shot.utterances.length ? PAGE_GAP : 0) + PAGE_TAIL));
      const [w, hh] = project.orientation === "16:9" ? [1920, 1080] : [1080, 1920];

      let assFile: string | undefined;
      if (galgame && blocks.length) {
        assFile = path.join(tmpDir, "gal.ass");
        await fs.writeFile(assFile, buildGalgameAss(blocks, { fontName: process.env.SUBTITLE_FONT || "Noto Sans CJK SC", width: w, height: hh }), "utf8");
      }
      await renderPageClip({ image: absPath(shot.frame.path), audios, duration, width: w, height: hh, kenBurns: project.kenBurns, outFile: tmp, sprites: galgame ? sprites : [], assFile });
      const asset = await saveAsset({ buffer: await fs.readFile(tmp), mime: "video/mp4", kind: "video", projectId: project.id, folder: "videos", duration });
      const h = pageRenderHash(shot, project, spriteIds);
      await db.$transaction([
        db.shot.update({
          where: { id: shot.id },
          data: {
            videoId: asset.id,
            status: "video_ready",
            videoInputHash: h,
            duration: Math.round(duration),
            subtitleCues: JSON.stringify(cues),
            subtitleBurned: galgame,
            asrText: `${asset.id}|tts`,
            reviewNote: "",
          },
        }),
        db.generation.update({
          where: { id: gen.id },
          data: { status: "success", resultId: asset.id, params: JSON.stringify({ route: "page", style: project.presentStyle, inputHash: h, duration, cues: cues.length, sprites: spriteIds.length }), finishedAt: new Date() },
        }),
      ]);
    } catch (err) {
      const { short, long } = errText(err);
      await db.$transaction([
        db.shot.update({ where: { id: shot.id }, data: { status: shot.frameId ? "frame_ready" : "draft", reviewNote: `页视频渲染失败：${short.slice(0, 300)}` } }),
        db.generation.update({ where: { id: gen.id }, data: { status: "failed", error: long, finishedAt: new Date() } }),
      ]);
      throw err;
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

const round = (x: number) => Math.round(x * 1000) / 1000;
