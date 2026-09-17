import { db } from "../src/server/db";
async function main() {
  const ps = await db.persona.findMany({ where: { character: { projectId: process.argv[2] } }, include: { character: true, sheet: true }, orderBy: { createdAt: "asc" } });
  for (const p of ps) console.log(`${p.character.name}·${p.tag}|${p.sheet?.path}`);
  const pr = await db.prop.findMany({ where: { projectId: process.argv[2] }, include: { sheet: true }, orderBy: { order: "asc" } });
  for (const p of pr) console.log(`道具${p.name}|${p.sheet?.path}`);
  await db.$disconnect();
}
main();
