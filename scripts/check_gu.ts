import { db } from "../src/server/db";
async function main() {
  const gu = await db.character.findFirstOrThrow({ where: { projectId: process.argv[2], name: "顾言" }, include: { personas: { orderBy: { order: "asc" } } } });
  for (const p of gu.personas) {
    console.log(`顾言·${p.tag}  status=${p.status}  描述已更新=${p.description.includes("打篮球的体格") || p.description.includes("同一副骨相")}`);
    console.log("  " + p.description.slice(0, 60).replace(/\n/g, " "));
  }
  await db.$disconnect();
}
main();
