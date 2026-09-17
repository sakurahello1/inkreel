import { db } from "../src/server/db";
async function main() {
  const chs = await db.chapter.findMany({ where: { projectId: process.argv[2] }, orderBy: { index: "asc" } });
  for (const c of chs) {
    const units = await db.unit.count({ where: { chapterId: c.id } });
    const shots = await db.shot.findMany({ where: { chapterId: c.id } });
    const sec = shots.reduce((a, s) => a + s.duration, 0);
    console.log(`${c.title}  ${c.agentStatus}  ${units}组/${shots.length}镜/${sec}s  ${c.agentError.slice(0, 120)}`);
  }
  const jobs = await db.job.groupBy({ by: ["status", "type"], where: { type: "chapter.storyboard" }, _count: true });
  console.log(jobs.map((j) => `${j.status}:${j._count}`).join(" "));
  await db.$disconnect();
}
main();
