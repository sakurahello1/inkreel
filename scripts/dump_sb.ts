import { db } from "../src/server/db";
import { parseJson } from "../src/server/db";
async function main() {
  const ch = await db.chapter.findFirstOrThrow({ where: { projectId: process.argv[2], index: Number(process.argv[3]) } });
  const units = await db.unit.findMany({ where: { chapterId: ch.id }, include: { shots: { orderBy: { index: "asc" } } }, orderBy: { index: "asc" } });
  const chars = await db.character.findMany({ where: { projectId: process.argv[2] } });
  const nm = (id: string) => chars.find((c) => c.id === id)?.name ?? "?";
  let tot = 0, txt = 0;
  console.log(`【${ch.title}】`);
  for (const u of units) {
    console.log(`组${u.index} (${u.shots.length}) ${u.summary}`);
    for (const s of u.shots) {
      tot += s.duration;
      const d = parseJson<Array<{ characterId: string; line: string }>>(s.dialogue, []);
      const n = d.reduce((a, x) => a + x.line.replace(/[，。！？、…—「」\s]/g, "").length, 0);
      txt += n;
      const rate = n ? (n / s.duration).toFixed(1) : "-";
      console.log(`  #${String(s.index).padStart(2)} ${s.duration}s ${s.shotSize.padEnd(4)} ${rate.padStart(4)}字/秒  ${d.map((x) => nm(x.characterId) + "：" + x.line).join(" / ").slice(0, 70) || "（无台词）"}`);
    }
  }
  console.log(`合计 ${tot}s，台词 ${txt} 字，平均 ${(txt / tot).toFixed(2)} 字/秒`);
  await db.$disconnect();
}
main();
