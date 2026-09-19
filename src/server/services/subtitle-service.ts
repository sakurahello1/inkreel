import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseJson } from "../db";
import { absPath } from "../storage";
import { extractSpeech } from "../ffmpeg";
import { falTranscribeWords } from "../providers/fal-asr";
import { alignCues, textSimilarity, type SubtitleCue } from "../subtitles";
import { Service } from "./base";

export interface AlignReport {
  shotId: string;
  index: number;
  expected: string;
  heard: string;
  similarity: number;
  cues: SubtitleCue[];
}

/**
 * 字幕对齐：把每镜的台词对到成片里真正说话的时间上。
 * 以前是按字数比例铺满整段，人还没开口字幕就出来了、说完了还挂着。
 * 顺手把识别出来的话存下来，念错的一眼能看出来。
 */
export class SubtitleService extends Service {
  /** 对齐一章里所有「有成片且有台词」的镜头。已对齐且成片没换的跳过，force 为真全部重来 */
  async alignChapter(chapterId: string, opts: { force?: boolean } = {}) {
    const shots = await this.db.shot.findMany({ where: { chapterId, videoId: { not: null } }, include: { video: true }, orderBy: { index: "asc" } });
    const reports: AlignReport[] = [];
    for (const s of shots) {
      // 说书的页视频：字幕来自 TTS 时间戳，已经精确，不用 Whisper 再对
      if (s.asrText.endsWith("|tts")) continue;
      const lines = s.clipSubtitle.trim() ? s.clipSubtitle.split(/\r?\n+/) : parseJson<Array<{ line: string }>>(s.dialogue, []).map((d) => d.line);
      if (!lines.some((l) => l.trim())) {
        if (s.subtitleCues) await this.db.shot.update({ where: { id: s.id }, data: { subtitleCues: "", asrText: "" } });
        continue;
      }
      if (!opts.force && s.subtitleCues && s.asrText.startsWith(`${s.videoId}|`)) {
        reports.push({ shotId: s.id, index: s.index, expected: lines.join(" "), heard: s.asrText.slice(s.videoId!.length + 1), similarity: -1, cues: parseJson<SubtitleCue[]>(s.subtitleCues, []) });
        continue;
      }
      const r = await this.alignShot(s.id);
      reports.push(r);
    }
    return reports;
  }

  /** 对齐一镜：抽人声 → Whisper 字级时间 → 按字对齐 → 存 */
  async alignShot(shotId: string): Promise<AlignReport> {
    const s = await this.db.shot.findUniqueOrThrow({ where: { id: shotId }, include: { video: true } });
    if (!s.video) throw new Error("没有成片");
    const lines = s.clipSubtitle.trim() ? s.clipSubtitle.split(/\r?\n+/) : parseJson<Array<{ line: string }>>(s.dialogue, []).map((d) => d.line);
    const tmp = path.join(os.tmpdir(), `sub-${shotId}-${Date.now()}.mp3`);
    try {
      await extractSpeech(absPath(s.video.path), tmp);
      const { text, words } = await falTranscribeWords(await fs.readFile(tmp));
      const cues = alignCues(lines, words);
      const expected = lines.join(" ");
      // asrText 前面带上成片 id：成片换了版本就知道该重对
      await this.db.shot.update({ where: { id: shotId }, data: { subtitleCues: JSON.stringify(cues), asrText: `${s.videoId}|${text}` } });
      return { shotId, index: s.index, expected, heard: text, similarity: textSimilarity(expected, text), cues };
    } finally {
      await fs.rm(tmp, { force: true }).catch(() => {});
    }
  }
}
