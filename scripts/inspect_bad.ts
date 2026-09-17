import { db, parseJson } from "../src/server/db";
async function main() {
  const projectId = process.argv[2];
  const chars = await db.character.findMany({ where: { projectId } });
  const nm = (id: string) => chars.find((c) => c.id === id)?.name ?? "?";
  const chs = await db.chapter.findMany({ where: { projectId }, orderBy: { index: "asc" } });
  for (const ch of chs) {
    const shots = await db.shot.findMany({ where: { chapterId: ch.id }, orderBy: { index: "asc" } });
    console.log(`\n【${ch.title}】`);
    for (const s of shots) {
      const d = parseJson<Array<{ characterId: string; line: string; tone: string }>>(s.dialogue, []);
      const n = d.reduce((a, x) => a + x.line.replace(/[，。！？、…—「」\s]/g, "").length, 0);
      const r = n / s.duration;
      const flag = r > 3.3 ? " ★超速" : n === 0 ? " ·静默" : "";
      console.log(`#${String(s.index).padStart(2)} ${s.duration}s ${n}字 ${r ? r.toFixed(1) : "-"}${flag}`);
      for (const x of d) console.log(`     [${nm(x.characterId)}|${(x.tone || "").slice(0, 14)}] ${x.line}`);
    }
  }
  await db.$disconnect();
}
main();
