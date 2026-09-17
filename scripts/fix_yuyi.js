const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
(async () => {
  const x = await db.persona.findFirst({ where: { character: { name: "沈幼怡" } }, include: { character: true } });
  await db.persona.update({
    where: { id: x.id },
    data: {
      description: `高中女生角色设定。乌黑长发扎成利落的高马尾，几缕碎发垂在耳侧。神情安静克制，视线略微躲闪，嘴唇抿紧，透着紧张。
穿一套明显过大的黑白高中校服：外套肩线垮到手臂外侧，袖子长出一截几乎遮住整只手，衣摆很长，整个人像被衣服裹住。同款校服长裤，白色运动鞋。
背一个深色双肩包，双手抓着背包肩带。站姿内收，肩膀微微向前含着。`,
      prompt: "",
      status: "generating",
      error: "",
    },
  });
  await db.job.create({ data: { type: "persona.sheet", payload: JSON.stringify({ personaId: x.id }) } });
  console.log("已重排沈幼怡人设图（去掉身体部位描述）");
  await db.$disconnect();
})();
