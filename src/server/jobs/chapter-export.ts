import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { db, parseJson } from "../db";
import { Job, errText } from "../core/job";
import { absPath, saveAsset } from "../storage";
import { exportTimeline, probe, resolveTrim, type BgmSegment } from "../ffmpeg";

type Payload = { chapterId: string };

type ExportShot = {
  id: string;
  index: number;
  clipOrder: number | null;
  clipIn: number;
  clipOut: number | null;
  clipSubtitle: string;
  dialogue: string;
  fadeIn: number;
  fadeOut: number;
  bgmTrackId: string | null;
  video: { path: string } | null;
  bgmTrack: { id: string; volume: number; asset: { path: string } } | null;
};

/**
 * 章节导出：把已生成的镜头视频按时间线拼成一条竖屏成片。
 *
 * ffmpeg 那边负责缩放裁切、烧字幕、混 BGM、片尾字卡；这里负责决定
 * 「哪些镜头进片、各取哪一段、BGM 在曲子里从哪个偏移开始」。
 */
export class ChapterExportJob extends Job<Payload> {
  readonly type = "chapter.export";

  async run(p: Payload) {
    const id = String(p.chapterId);
    const ch = await db.chapter.findUniqueOrThrow({
      where: { id },
      include: { project: true, shots: { include: { video: true, bgmTrack: { include: { asset: true } } }, orderBy: { index: "asc" } } },
    });
    const gen = await db.generation.create({ data: { kind: "export", chapterId: id, provider: "ffmpeg", model: "libx264", status: "running" } });
    const tmpOut = path.join(os.tmpdir(), `slate-export-${id}-${Date.now()}.mp4`);

    try {
      // 有当前成片且没停用就进片。不看 status：改一下提示词状态就退回草稿，但成片还在、还是当前采用的那条
      const shots = ch.shots
        .filter((s) => s.video && s.clipEnabled)
        .sort((a, b) => (a.clipOrder ?? a.index) - (b.clipOrder ?? b.index));
      if (shots.length === 0) throw new Error("没有可导出的镜头：需要至少一个已生成视频且启用的镜头");

      const clips = shots.map((s) => ({
        file: absPath(s.video!.path),
        inPoint: s.clipIn,
        outPoint: s.clipOut,
        fadeIn: s.fadeIn,
        fadeOut: s.fadeOut,
        // 手工字幕优先；留空则回落到台词原文
        subtitleLines: s.clipSubtitle.trim() ? s.clipSubtitle.split(/\r?\n+/) : parseJson<Array<{ line: string }>>(s.dialogue, []).map((d) => d.line),
        cues: parseJson<Array<{ text: string; start: number; end: number }>>(s.subtitleCues, []),
      }));

      const endLines = ch.endCardText.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      const bgmSegments = await this.planBgm(shots as ExportShot[], ch.bgmVolume);
      // 片尾字卡下面继续放最后一段 BGM，否则字卡是死寂的几秒
      if (endLines.length && ch.endCardSecs > 0 && bgmSegments.length) {
        const last = bgmSegments[bgmSegments.length - 1];
        last.len += ch.endCardSecs;
        last.fadeOut = Math.max(last.fadeOut, 1.6);
      }

      const [w, h] = ch.project.orientation === "16:9" ? [1920, 1080] : [1080, 1920];
      const result = await exportTimeline({
        clips,
        bgmSegments,
        endCard: endLines.length ? { lines: endLines, seconds: ch.endCardSecs } : null,
        subtitles: ch.subtitles,
        fontName: process.env.SUBTITLE_FONT || "Noto Sans CJK SC",
        width: w,
        height: h,
        outFile: tmpOut,
        onLog: (l) => console.log("[export]", l.slice(0, 600)),
      });

      const buffer = await fs.readFile(tmpOut);
      const asset = await saveAsset({ buffer, mime: "video/mp4", kind: "video", projectId: ch.projectId, folder: "exports", duration: result.total });
      await db.$transaction([
        db.chapter.update({ where: { id }, data: { exportId: asset.id, exportStatus: "ready", exportError: "" } }),
        db.generation.update({
          where: { id: gen.id },
          data: {
            status: "success",
            resultId: asset.id,
            params: JSON.stringify({ clips: result.segments, seconds: result.total, bgmSegments: bgmSegments.length, endCard: result.endCard }),
            finishedAt: new Date(),
          },
        }),
      ]);
    } catch (err) {
      const { long, raw } = errText(err);
      await db.$transaction([
        db.chapter.update({ where: { id }, data: { exportStatus: "failed", exportError: raw.slice(0, 1500) } }),
        db.generation.update({ where: { id: gen.id }, data: { status: "failed", error: long, finishedAt: new Date() } }),
      ]);
      throw err;
    } finally {
      await fs.rm(tmpOut, { force: true }).catch(() => undefined);
    }
  }

  /**
   * BGM 连续段落。
   *
   * 相邻镜头如果用同一首曲子，第二镜要接着第一镜在曲子里的位置继续取，
   * 听感上才是一条连续的旋律；换曲或中间断掉则从头开始。段落首尾各做一次淡入淡出。
   */
  private async planBgm(shots: ExportShot[], chapterVolume: number): Promise<BgmSegment[]> {
    const out: BgmSegment[] = [];
    // 整章音量拉到 0 就是「不要 BGM」：干脆不混，省得 ffmpeg 白混一轨静音
    if (chapterVolume <= 0) return out;
    let at = 0;
    let runTrackId: string | null = null;
    let runOffset = 0;

    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      const info = await probe(absPath(s.video!.path));
      const { len } = resolveTrim(info.duration, s.clipIn, s.clipOut);
      const track = s.bgmTrack;

      if (track) {
        const isRunStart = track.id !== runTrackId;
        if (isRunStart) {
          runTrackId = track.id;
          runOffset = 0;
        }
        const endsRun = !shots[i + 1] || shots[i + 1].bgmTrackId !== track.id;
        out.push({
          file: absPath(track.asset.path),
          trackStart: runOffset,
          at,
          len,
          volume: track.volume * chapterVolume,
          fadeIn: isRunStart ? 0.8 : 0,
          fadeOut: endsRun ? 1.2 : 0,
        });
        runOffset += len;
      } else {
        runTrackId = null;
        runOffset = 0;
      }
      at += len;
    }
    return out;
  }
}
