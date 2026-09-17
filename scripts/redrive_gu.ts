import { db } from "../src/server/db";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const projectId = process.argv[2];
  const gu = await db.character.findFirstOrThrow({ where: { projectId, name: "顾言" }, include: { personas: { orderBy: { order: "asc" } } } });
  for (const p of gu.personas) {
    const pending = await db.job.count({ where: { type: "persona.sheet", payload: { contains: p.id }, status: { in: ["queued", "running"] } } });
    console.log(`顾言·${p.tag} 队列中 ${pending} 条`);
    if (pending === 0) {
      await db.job.create({ data: { type: "persona.sheet", payload: JSON.stringify({ personaId: p.id }), runAt: new Date() } });
      console.log("  已补排");
    }
  }
  for (let i = 0; i < 50; i++) {
    await sleep(12000);
    const ps = await db.persona.findMany({ where: { characterId: gu.id }, include: { sheet: true }, orderBy: { order: "asc" } });
    if (!ps.some((x) => x.status === "generating")) {
      for (const x of ps) console.log(`顾言·${x.tag}: ${x.status} ${x.sheet?.path ?? ""} ${x.error.slice(0, 150)}`);
      break;
    }
  }
  await db.$disconnect();
}
main();
