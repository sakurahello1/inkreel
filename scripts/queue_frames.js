const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const CH = process.argv[2];
  const only = process.argv[3] ? process.argv[3].split(",").map(Number) : null;
  const where = { chapterId: CH, frameMode: "image" };
  if (only) where.index = { in: only };
  const shots = await db.shot.findMany({ where, orderBy: { index: "asc" } });
  for (const s of shots) {
    await db.shot.update({ where: { id: s.id }, data: { status: "frame_generating", reviewNote: "" } });
    await db.job.create({ data: { type: "shot.frame", payload: JSON.stringify({ shotId: s.id }), runAt: new Date() } });
  }
  console.log("已排 " + shots.length + " 张首帧");
  for (let i = 0; i < 160; i++) {
    await sleep(15000);
    const ss = await db.shot.findMany({ where, orderBy: { index: "asc" } });
    const c = {};
    for (const s of ss) c[s.status] = (c[s.status] || 0) + 1;
    if (!c.frame_generating) {
      console.log("完成:", Object.entries(c).map(([k, v]) => k + ":" + v).join(" "));
      for (const s of ss) if (s.status !== "frame_ready") console.log("  #" + s.index + " " + s.status + " " + (s.reviewNote || "").slice(0, 200));
      break;
    }
    if (i % 4 === 0) console.log(new Date().toTimeString().slice(0, 8), Object.entries(c).map(([k, v]) => k + ":" + v).join(" "));
  }
  await db.$disconnect();
})();
