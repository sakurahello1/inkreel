import { db, parseJson } from "../src/server/db";
async function main() {
  const projectId = process.argv[2];
  const chs = await db.chapter.findMany({ where: { projectId }, orderBy: { index: "asc" } });
  const chars = await db.character.findMany({ where: { projectId } });
  const nm = (id: string) => chars.find((c) => c.id === id)?.name ?? "?";
  let allSec = 0, allTxt = 0, silentRuns: string[] = [], fast: string[] = [];

  for (const ch of chs) {
    const shots = await db.shot.findMany({ where: { chapterId: ch.id }, orderBy: { index: "asc" } });
    let sec = 0, txt = 0, run = 0, maxRun = 0;
    for (const s of shots) {
      sec += s.duration;
      const d = parseJson<Array<{ characterId: string; line: string; tone: string }>>(s.dialogue, []);
      const n = d.reduce((a, x) => a + x.line.replace(/[，。！？、…—「」\s]/g, "").length, 0);
      txt += n;
      if (n === 0) { run++; maxRun = Math.max(maxRun, run); } else run = 0;
      if (n / s.duration > 3.3) fast.push(`${ch.title} #${s.index} ${s.duration}s ${n}字 ${(n / s.duration).toFixed(1)}字/秒`);
    }
    allSec += sec; allTxt += txt;
    if (maxRun >= 3) silentRuns.push(`${ch.title} 最长连续 ${maxRun} 个无台词镜头`);
    const units = await db.unit.count({ where: { chapterId: ch.id } });
    console.log(`${ch.title.padEnd(18)} ${units}组 ${shots.length}镜 ${sec}s  ${txt}字  ${(txt / sec).toFixed(2)}字/秒  最长静默${maxRun}镜`);
  }
  console.log(`\n全片 ${allSec}s = ${(allSec / 60).toFixed(1)}分钟，${allTxt}字，平均 ${(allTxt / allSec).toFixed(2)} 字/秒`);
  console.log(fast.length ? `\n语速过快：\n  ${fast.join("\n  ")}` : "\n无语速过快镜头");
  console.log(silentRuns.length ? `连续静默：\n  ${silentRuns.join("\n  ")}` : "无连续静默问题");

  // 内心独白有没有被保留成画外音
  const all = await db.shot.findMany({ where: { chapter: { projectId } } });
  let vo = 0, onCam = 0, sys = 0;
  for (const s of all) {
    for (const d of parseJson<Array<{ characterId: string; line: string; tone: string }>>(s.dialogue, [])) {
      const t = d.tone || "";
      if (/系统|机械|电子/.test(t + d.line)) sys++;
      else if (/旁白|独白|画外|心声|内心/.test(t)) vo++;
      else onCam++;
    }
  }
  console.log(`\n台词构成：画外音独白 ${vo} 句 / 现场对白 ${onCam} 句 / 系统音 ${sys} 句`);
  await db.$disconnect();
}
main();
