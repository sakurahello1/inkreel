const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
(async () => {
  const p = await db.project.findFirst({ where: { title: { contains: "养妹" } } });
  const ch = await db.chapter.findFirst({ where: { projectId: p.id, index: 1 } });
  await db.chapter.update({ where: { id: ch.id }, data: { agentStatus: "running", agentError: "" } });
  await db.job.create({
    data: {
      type: "chapter.storyboard",
      payload: JSON.stringify({
        chapterId: ch.id,
        provider: "chat",
        targetSeconds: 190,
        instruction: `这是发抖音的小说推文视频，目标总时长 3 到 3.5 分钟，务必按这个体量拆够镜头数。
观众是刷到就走的路人，前 15 秒必须抓住人：开场直接给「全班安静下来盯着转学生，只有男主在看她袖子里发抖的手」这个反差。
节奏要有起伏：冲突段（拍桌、截胡零食）短促有力，情绪段（递纸条、天台吃饭）放慢留白。
男女主是无血缘兄妹，在学校装作不认识，这是全片的张力来源，镜头要多用「隔着人群对视」「余光扫过去」这类关系构图。
最后一镜必须停在「他回头，正撞上躲在铁门后偷看他的那双眼睛」，留悬念，不要收尾不要总结。
所有镜头都用 image 模式先出首帧，不要用 text_only。`,
      }),
    },
  });
  console.log("已提交拆镜:", ch.id);
  require("fs").writeFileSync(process.env.TEMP + "/promo.txt", p.id + "\n" + ch.id);
  await db.$disconnect();
})();
