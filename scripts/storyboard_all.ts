import { db } from "../src/server/db";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TARGET: Record<number, number> = { 1: 130, 2: 155, 3: 120, 4: 125 };

const INSTRUCTION = `这是一部竖屏短剧，不是默片。男主顾言的内心独白是全片的叙事引擎——观众全靠它理解「他是重生回来的、他知道未来会发生什么」。
硬性要求：
1. 文案里凡是「顾言的内心独白：」开头的句子，一律作为顾言的男声画外音处理，必须原样保留成台词，不要丢、不要改写、不要合并掉。画面中他不开口，嘴唇闭合。
2. 凡是「某某：」开头的句子是现场对白，由该人物在画面中真实说出，要有口型。
3. 「系统提示音：」是机械电子音画外音，画面中没有人在说话。
4. 尽量不要出现连续两个以上完全无台词的镜头。空镜可以有，但不要连成一串，观众会划走。
5. 台词密度控制在每秒 2 到 3 个字，宁可把镜头拉长，也不要把话塞得太挤念不清楚。`;

async function main() {
  const projectId = process.argv[2];
  const chapters = await db.chapter.findMany({ where: { projectId }, orderBy: { index: "asc" } });
  for (const ch of chapters) {
    await db.chapter.update({ where: { id: ch.id }, data: { agentStatus: "running", agentError: "" } });
    await db.job.create({
      data: {
        type: "chapter.storyboard",
        payload: JSON.stringify({
          chapterId: ch.id,
          provider: "chat",
          instruction: INSTRUCTION,
          targetSeconds: TARGET[ch.index],
        }),
        runAt: new Date(),
      },
    });
    console.log(`${ch.title} 已提交，目标 ${TARGET[ch.index]}s`);

    for (let i = 0; i < 100; i++) {
      await sleep(15000);
      const c = await db.chapter.findUniqueOrThrow({ where: { id: ch.id } });
      if (c.agentStatus === "running") continue;
      if (c.agentStatus === "failed") { console.log("  失败:", c.agentError.slice(0, 300)); break; }
      const units = await db.unit.count({ where: { chapterId: ch.id } });
      const shots = await db.shot.findMany({ where: { chapterId: ch.id }, orderBy: { index: "asc" } });
      const sec = shots.reduce((a, s) => a + s.duration, 0);
      console.log(`  完成：${units} 组 / ${shots.length} 镜 / ${sec}s`);
      break;
    }
  }
  const all = await db.shot.findMany({ where: { chapter: { projectId } } });
  console.log(`\n全片 ${all.length} 镜 ${all.reduce((a, s) => a + s.duration, 0)}s`);
  await db.$disconnect();
}
main();
