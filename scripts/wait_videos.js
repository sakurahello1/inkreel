const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const CH = "cmtsuvqty000pv7ck7772exk5";
  for (let i = 0; i < 400; i++) {
    const ss = await db.shot.findMany({ where: { chapterId: CH }, orderBy: { index: "asc" } });
    const c = {};
    for (const s of ss) c[s.status] = (c[s.status] || 0) + 1;
    const pending = (c.video_queued || 0) + (c.video_generating || 0) + (c.video_submitted || 0);
    if (!pending) {
      const cost = ss.reduce((a, s) => a + s.cost, 0);
      console.log("完成", JSON.stringify(c), "花费 $" + cost.toFixed(2));
      for (const s of ss) if (s.status !== "video_ready" && s.status !== "done") console.log("  #" + s.index, s.status, (s.reviewNote || "").slice(0, 240));
      break;
    }
    if (i % 6 === 0) console.log(new Date().toTimeString().slice(0, 8), JSON.stringify(c));
    await sleep(20000);
  }
  await db.$disconnect();
})();
