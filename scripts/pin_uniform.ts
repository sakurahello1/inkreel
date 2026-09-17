import { db } from "../src/server/db";
async function main() {
  const p = await db.project.findUniqueOrThrow({ where: { id: process.argv[2] } });
  const SPEC = `

【校服统一规格 · 全片必须一致】临安一中 2009 年款蓝白运动校服，男女同款：
拉链立领外套，肩部与上胸为白色，其余为宝蓝色，两色以一道斜向白边分隔；袖口与下摆是宝蓝色罗纹；胸前不带任何校徽、字母或图案。
配宝蓝色束脚运动长裤，裤腿外侧有一道细白条。
脚上一律是白色低帮帆布鞋。
楚薇薇的那套明显大一号，袖口盖住手背，且洗得发白、蓝色区域褪色不均。`;
  if (p.world.includes("校服统一规格")) { console.log("已存在，跳过"); return; }
  await db.project.update({ where: { id: p.id }, data: { world: p.world + SPEC } });
  console.log("校服规格已钉入世界观");
  await db.$disconnect();
}
main();
