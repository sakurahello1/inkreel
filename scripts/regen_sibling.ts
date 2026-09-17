import { db } from "../src/server/db";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 重画「同一人物的第二张人设」，此时第一张已有图，会被当作参考，保证是同一张脸 */
async function main() {
  const projectId = process.argv[2];
  const targets = await db.persona.findMany({
    where: { character: { projectId }, tag: { in: ["红毯", "病重"] } },
    include: { character: true },
  });
  for (const p of targets) {
    // 清掉上次落库的提示词，让它按「有兄弟人设」重新拼
    await db.persona.update({ where: { id: p.id }, data: { prompt: "", status: "generating", error: "" } });
    await db.job.create({ data: { type: "persona.sheet", payload: JSON.stringify({ personaId: p.id }), runAt: new Date() } });
    console.log(`重画 ${p.character.name}·${p.tag}`);
  }
  for (let i = 0; i < 60; i++) {
    await sleep(15000);
    const ps = await db.persona.findMany({ where: { id: { in: targets.map((t) => t.id) } }, include: { character: true, sheet: true } });
    if (!ps.some((x) => x.status === "generating")) {
      for (const x of ps) console.log(`  ${x.character.name}·${x.tag}: ${x.status} ${x.sheet?.path ?? ""} ${x.error.slice(0, 150)}`);
      break;
    }
  }
  await db.$disconnect();
}
main();
