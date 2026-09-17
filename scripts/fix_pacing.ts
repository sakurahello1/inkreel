import { db, parseJson } from "../src/server/db";

/**
 * 三件事：
 * 1. 剥掉混进台词的说话人前缀（H3 会把「顾言的内心独白」六个字念出来）
 * 2. 按 3.0 字/秒的上限重排时长，H3 支持 4–15 秒
 * 3. 视频提示词里的引号内容与台词保持一致，否则模型念的是旧文案
 */
const PREFIX = /^(.{1,8}的内心独白|系统提示音|旁白|画外音)[：:]\s*/;
const MAX_RATE = 3.0;
const MIN_D = 4, MAX_D = 15;
const cn = (s: string) => s.replace(/[，。！？、…—「」\s]/g, "").length;

async function main() {
  const projectId = process.argv[2];
  const shots = await db.shot.findMany({ where: { chapter: { projectId } }, include: { chapter: true }, orderBy: [{ chapterId: "asc" }, { index: "asc" }] });
  let stripped = 0, retimed = 0, stillFast = 0;

  for (const s of shots) {
    const lines = parseJson<Array<{ characterId: string; line: string; tone: string }>>(s.dialogue, []);
    let vp = s.videoPrompt;

    // 1) 剥前缀，台词与视频提示词同步
    const fixed = lines.map((d) => {
      const m = d.line.match(PREFIX);
      if (!m) return d;
      const clean = d.line.replace(PREFIX, "");
      vp = vp.split(d.line).join(clean);
      stripped++;
      return { ...d, line: clean };
    });

    // 2) 重排时长
    const n = fixed.reduce((a, d) => a + cn(d.line), 0);
    let dur = s.duration;
    if (n > 0) {
      const need = Math.ceil(n / MAX_RATE);
      if (need > dur) {
        dur = Math.min(MAX_D, Math.max(MIN_D, need));
        if (n / dur > 3.3) stillFast++;
        retimed++;
      }
    }

    if (fixed.some((d, i) => d.line !== lines[i].line) || dur !== s.duration || vp !== s.videoPrompt) {
      await db.shot.update({ where: { id: s.id }, data: { dialogue: JSON.stringify(fixed), videoPrompt: vp, duration: dur } });
    }
  }
  console.log(`剥掉前缀 ${stripped} 处，重排时长 ${retimed} 镜，仍超 3.3 字/秒 ${stillFast} 镜`);

  const after = await db.shot.findMany({ where: { chapter: { projectId } }, include: { chapter: true }, orderBy: [{ chapterId: "asc" }, { index: "asc" }] });
  const bad = after.filter((s) => {
    const n = parseJson<Array<{ line: string }>>(s.dialogue, []).reduce((a, d) => a + cn(d.line), 0);
    return n / s.duration > 3.3;
  });
  for (const s of bad) {
    const ls = parseJson<Array<{ line: string }>>(s.dialogue, []);
    const n = ls.reduce((a, d) => a + cn(d.line), 0);
    console.log(`  仍超速 ${s.chapter.title} #${s.index} ${s.duration}s ${n}字 ${(n / s.duration).toFixed(1)}  「${ls.map((x) => x.line).join(" / ").slice(0, 60)}」`);
  }
  await db.$disconnect();
}
main();
