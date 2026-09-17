import { db } from "../src/server/db";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const [projectId, name, tag] = process.argv.slice(2);
  const p = await db.persona.findFirstOrThrow({
    where: { character: { projectId, name }, tag },
    include: { character: true },
  });
  await db.persona.update({ where: { id: p.id }, data: { prompt: "", status: "generating", error: "" } });
  await db.job.create({ data: { type: "persona.sheet", payload: JSON.stringify({ personaId: p.id }), runAt: new Date() } });
  console.log(`重画 ${name}·${tag}`);
  for (let i = 0; i < 40; i++) {
    await sleep(12000);
    const q = await db.persona.findUniqueOrThrow({ where: { id: p.id }, include: { sheet: true } });
    if (q.status !== "generating") { console.log(q.status, q.sheet?.path ?? "", q.error.slice(0, 200)); break; }
  }
  await db.$disconnect();
}
main();
