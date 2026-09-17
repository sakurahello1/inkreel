import { db } from "../src/server/db";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const UNIFORM = `
【校服规格，必须严格照此画】临安一中 2009 年款蓝白运动校服：拉链立领外套，肩部与上胸为白色，其余为宝蓝色，两色之间以一道斜向白边分隔；袖口与下摆是宝蓝色罗纹；胸前不带任何校徽、字母或图案。配宝蓝色运动长裤，裤腿外侧一道细白条。白色低帮帆布鞋。`;

/** 穿校服的人设 */
const WEARS_UNIFORM = new Set(["顾言·高中", "楚薇薇·高中", "王多福·高中", "刘波儿·高中", "王诗诗·高中"]);

async function main() {
  const projectId = process.argv[2];
  const chars = await db.character.findMany({ where: { projectId }, include: { personas: { orderBy: { order: "asc" } } }, orderBy: { order: "asc" } });

  // 1) 把校服规格写进描述
  for (const c of chars) {
    for (const p of c.personas) {
      const key = `${c.name}·${p.tag}`;
      if (!WEARS_UNIFORM.has(key)) continue;
      if (p.description.includes("校服规格")) continue;
      await db.persona.update({ where: { id: p.id }, data: { description: p.description + UNIFORM } });
    }
  }
  console.log("校服规格已写入 5 张人设描述");

  // 2) 逐人物依次重画：同一人物的第二张要等第一张出图，才能拿它当参考对齐脸
  for (const c of chars) {
    for (const p of c.personas) {
      await db.persona.update({ where: { id: p.id }, data: { prompt: "", status: "generating", error: "" } });
      await db.job.create({ data: { type: "persona.sheet", payload: JSON.stringify({ personaId: p.id }), runAt: new Date() } });
      for (let i = 0; i < 40; i++) {
        await sleep(10000);
        const q = await db.persona.findUniqueOrThrow({ where: { id: p.id }, include: { sheet: true } });
        if (q.status === "generating") continue;
        console.log(`  ${c.name}·${p.tag}: ${q.status} ${q.sheet?.path ?? ""} ${q.error.slice(0, 120)}`);
        break;
      }
    }
  }

  // 3) 道具也用新画风重画
  const props = await db.prop.findMany({ where: { projectId }, orderBy: { order: "asc" } });
  for (const p of props) {
    await db.prop.update({ where: { id: p.id }, data: { prompt: "", status: "generating", error: "" } });
    await db.job.create({ data: { type: "prop.sheet", payload: JSON.stringify({ propId: p.id }), runAt: new Date() } });
  }
  for (let i = 0; i < 60; i++) {
    await sleep(10000);
    const ps = await db.prop.findMany({ where: { projectId } });
    if (!ps.some((x) => x.status === "generating")) {
      for (const x of ps) console.log(`  道具 ${x.name}: ${x.status} ${x.error.slice(0, 120)}`);
      break;
    }
  }
  await db.$disconnect();
}
main();
