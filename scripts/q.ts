import { db } from "../src/server/db";
async function main() {
  const j = await db.job.groupBy({ by: ["type", "status"], where: { status: { in: ["queued", "running"] } }, _count: true });
  console.log(j.map((x) => `${x.type}/${x.status}:${x._count}`).join("  ") || "队列空");
  const g = await db.generation.findMany({ where: { status: "running" }, select: { kind: true, createdAt: true } });
  console.log("进行中的生成:", g.map((x) => x.kind).join(",") || "无");
  await db.$disconnect();
}
main();
