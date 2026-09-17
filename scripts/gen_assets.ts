import { db } from "../src/server/db";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const projectId = process.argv[2];
  const personas = await db.persona.findMany({ where: { character: { projectId } }, include: { character: true }, orderBy: { createdAt: "asc" } });
  const props = await db.prop.findMany({ where: { projectId }, orderBy: { order: "asc" } });

  for (const p of personas) {
    await db.persona.update({ where: { id: p.id }, data: { status: "generating", error: "" } });
    await db.job.create({ data: { type: "persona.sheet", payload: JSON.stringify({ personaId: p.id }), runAt: new Date() } });
  }
  for (const p of props) {
    await db.prop.update({ where: { id: p.id }, data: { status: "generating", error: "" } });
    await db.job.create({ data: { type: "prop.sheet", payload: JSON.stringify({ propId: p.id }), runAt: new Date() } });
  }
  console.log(`已排 ${personas.length} 张人设 + ${props.length} 个道具`);

  for (let i = 0; i < 120; i++) {
    await sleep(15000);
    const ps = await db.persona.findMany({ where: { character: { projectId } }, include: { character: true } });
    const pr = await db.prop.findMany({ where: { projectId } });
    const busy = [...ps, ...pr].filter((x) => x.status === "generating").length;
    if (!busy) {
      for (const x of ps) console.log(`  ${x.character.name}·${x.tag}: ${x.status} ${x.error.slice(0, 160)}`);
      for (const x of pr) console.log(`  道具 ${x.name}: ${x.status} ${x.error.slice(0, 160)}`);
      break;
    }
    if (i % 4 === 0) console.log(new Date().toTimeString().slice(0, 8), `剩余 ${busy}`);
  }
  await db.$disconnect();
}
main();
