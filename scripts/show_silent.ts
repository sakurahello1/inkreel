import { db, parseJson } from "../src/server/db";
async function main() {
  const ch = await db.chapter.findFirstOrThrow({ where: { projectId: process.argv[2], index: 2 } });
  const shots = await db.shot.findMany({ where: { chapterId: ch.id }, orderBy: { index: "asc" }, take: 12 });
  for (const s of shots) {
    const d = parseJson<Array<{ line: string }>>(s.dialogue, []);
    console.log(`#${String(s.index).padStart(2)} ${s.duration}s ${s.shotSize}  ${d.length ? "「" + d.map((x) => x.line).join(" / ").slice(0, 45) + "」" : "（静默）"}`);
    console.log(`     ${s.action.slice(0, 70)}`);
  }
  await db.$disconnect();
}
main();
