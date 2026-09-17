import { db } from "../src/server/db";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const projectId = process.argv[2];
  for (let i = 0; i < 60; i++) {
    const ps = await db.persona.count({ where: { character: { projectId }, status: "generating" } });
    const pr = await db.prop.count({ where: { projectId, status: "generating" } });
    const ch = await db.chapter.count({ where: { projectId, agentStatus: "running" } });
    if (!ps && !pr && !ch) { console.log("全部就绪"); break; }
    if (i % 4 === 0) console.log(new Date().toTimeString().slice(0, 8), `人设${ps} 道具${pr} 拆镜${ch}`);
    await sleep(15000);
  }
  await db.$disconnect();
}
main();
