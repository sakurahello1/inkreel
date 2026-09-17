import { db, parseJson } from "../src/server/db";
const PREFIX = /^(顾言的内心独白|楚薇薇的内心独白|.{1,6}的内心独白|系统提示音|旁白|画外音)[：:]\s*/;
async function main() {
  const projectId = process.argv[2];
  const shots = await db.shot.findMany({ where: { chapter: { projectId } }, include: { chapter: true }, orderBy: [{ chapterId: "asc" }, { index: "asc" }] });
  let bad = 0, vpBad = 0;
  for (const s of shots) {
    for (const d of parseJson<Array<{ line: string }>>(s.dialogue, [])) {
      if (PREFIX.test(d.line)) { bad++; console.log(`台词前缀 ${s.chapter.title} #${s.index}: ${d.line.slice(0, 40)}`); }
    }
    if (/内心独白[：:]|系统提示音[：:]/.test(s.videoPrompt)) vpBad++;
  }
  console.log(`\n台词带前缀 ${bad} 处，视频提示词里出现前缀 ${vpBad} 镜`);
  const one = shots.find((s) => /内心独白[：:]/.test(s.videoPrompt));
  if (one) console.log(`\n样例视频提示词（${one.chapter.title} #${one.index}）：\n${one.videoPrompt.slice(0, 400)}`);
  await db.$disconnect();
}
main();
