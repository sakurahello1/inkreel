import { db } from "../src/server/db";
async function main() {
  const running = await db.job.findMany({ where: { status: "running" }, orderBy: { lockedAt: "asc" } });
  console.log(`running 任务 ${running.length} 条（并发上限 8）：`);
  for (const j of running) {
    const mins = j.lockedAt ? ((Date.now() - j.lockedAt.getTime()) / 60000).toFixed(1) : "?";
    console.log(`  ${j.type}  锁了 ${mins} 分钟  attempts=${j.attempts}`);
  }
  const queued = await db.job.groupBy({ by: ["type"], where: { status: "queued" }, _count: true });
  console.log("queued:", queued.map((q) => `${q.type}:${q._count}`).join(" ") || "无");
  await db.$disconnect();
}
main();
