const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

const STYLE = `精致日系动漫风格，接近高质量TV动画关键帧与剧场版分镜的完成度。
干净利落的线稿，赛璐璐上色配合柔和渐变；五官清秀，眼睛有细致高光与虹膜层次；头发分缕，有明显高光带。
色彩通透偏胶片感：教室内暖黄日光与青灰阴影对比，窗外是夏末的浓绿与光斑。
光线是主角：百叶窗光、逆光轮廓光、粉笔灰在光柱里浮动、桌面与黑板的反光。
构图讲究景深，前景常有虚化的课桌角与同学的肩背；人物比例写实偏修长，不夸张、不Q版。
不要3D渲染感、不要厚涂写实油画感、不要照片质感、不要美颜滤镜感。`;

// 内容审核对未成年角色的外貌细节很敏感，人设只写服装、发型、姿态、神情
const FIX = {
  沈幼怡: `高中女生角色设定。乌黑长发扎成利落的高马尾，几缕碎发垂在耳侧。神情安静克制，视线略微躲闪，嘴唇抿紧，透着紧张。
穿明显过大的黑白高中校服外套，肩线垮到手臂外侧，袖子长出一截几乎遮住整只手，衣摆盖过臀部，整个人像被衣服裹住缩在里面。同款校服长裤，白色运动鞋。
背一个深色双肩包，双手抓着背包肩带。站姿内收，肩膀微微向前含着，重心偏后。`,
  陈诚: `高中男生角色设定。身形高瘦挺拔，短碎发略显凌乱，额前碎发盖住一点眉毛，眼神锋利带着漫不经心，嘴角挂着一抹欠揍的浅笑。
黑白配色的宽松高中校服外套敞开不拉拉链，里面白色圆领T恤，同款校服长裤，白色帆布板鞋。
习惯双手插裤兜，站姿松垮，重心压在一条腿上，下巴微抬。`,
};

(async () => {
  const p = await db.project.findFirst({ where: { title: { contains: "养妹" } } });
  await db.project.update({ where: { id: p.id }, data: { style: STYLE } });

  const personas = await db.persona.findMany({ where: { character: { projectId: p.id } }, include: { character: true } });
  for (const x of personas) {
    const fix = FIX[x.character.name];
    await db.persona.update({
      where: { id: x.id },
      // prompt 清空，让系统按新画风重新拼；description 只在需要时替换
      data: { ...(fix ? { description: fix } : {}), prompt: "", status: "generating", error: "" },
    });
    await db.job.create({ data: { type: "persona.sheet", payload: JSON.stringify({ personaId: x.id }) } });
  }
  const props = await db.prop.findMany({ where: { projectId: p.id } });
  for (const x of props) {
    await db.prop.update({ where: { id: x.id }, data: { prompt: "", status: "generating", error: "" } });
    await db.job.create({ data: { type: "prop.sheet", payload: JSON.stringify({ propId: x.id }) } });
  }
  console.log("画风已更新，重排", personas.length, "张人设 +", props.length, "张道具");
  await db.$disconnect();
})();
