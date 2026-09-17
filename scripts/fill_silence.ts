import { db, parseJson } from "../src/server/db";
const cn = (s: string) => s.replace(/[，。！？、…—「」\s]/g, "").length;

/** 给静默段落补上男主的内心独白，同时把台词写进视频提示词并加音频指令 */
const FILL: Record<number, { line: string; tone: string }> = {
  3: { line: "全班四十几个人，她像不存在一样。", tone: "低沉的男声画外音，带着迟来的心疼" },
  5: { line: "别人放学去撸串的时候，她在小饭馆端盘子。", tone: "缓慢的男声画外音，克制不煽情" },
  8: { line: "她没见过山竹。那年在我们那儿，三十多块钱一斤。", tone: "压低的男声画外音，语气平静但沉" },
  9: { line: "那是她六天的生活费。", tone: "极轻的男声画外音，说完留白" },
};

async function main() {
  const projectId = process.argv[2];
  const ch = await db.chapter.findFirstOrThrow({ where: { projectId, index: 2 } });
  const gu = await db.character.findFirstOrThrow({ where: { projectId, name: "顾言" } });

  for (const [idxStr, f] of Object.entries(FILL)) {
    const idx = Number(idxStr);
    const s = await db.shot.findFirstOrThrow({ where: { chapterId: ch.id, index: idx } });
    const lines = parseJson<Array<{ characterId: string; line: string; tone: string }>>(s.dialogue, []);
    if (lines.length) { console.log(`#${idx} 已有台词，跳过`); continue; }

    const dur = Math.min(15, Math.max(s.duration, Math.ceil(cn(f.line) / 3)));
    const vp =
      s.videoPrompt.trimEnd() +
      `\n男声画外音（画面中无人开口，所有人物嘴唇保持闭合）低声说「${f.line}」` +
      "\n【音频】「」中的句子是成年男声画外音旁白（顾言的内心独白），画面中任何人都不得做出说话口型，嘴唇保持闭合。";
    await db.shot.update({
      where: { id: s.id },
      data: { dialogue: JSON.stringify([{ characterId: gu.id, line: f.line, tone: f.tone }]), duration: dur, videoPrompt: vp },
    });
    console.log(`#${idx} 补入旁白 ${cn(f.line)}字 / ${dur}s = ${(cn(f.line) / dur).toFixed(1)}字每秒`);
  }
  await db.$disconnect();
}
main();
