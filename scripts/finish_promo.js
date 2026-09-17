// 充值后补跑最后三镜（#30 #31 #32），然后导出整片
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CH = "cmtsuvqty000pv7ck7772exk5";
(async () => {
  const miss = await db.shot.findMany({ where: { chapterId: CH, status: { notIn: ["video_ready", "done"] } }, orderBy: { index: "asc" } });
  if (miss.length) {
    console.log("补跑:", miss.map((s) => "#" + s.index + " " + s.duration + "s").join(" "));
    for (const s of miss) {
      await db.shot.update({ where: { id: s.id }, data: { status: "video_queued", reviewNote: "" } });
      await db.job.create({ data: { type: "shot.video.submit", payload: JSON.stringify({ shotId: s.id }), runAt: new Date() } });
    }
    for (let i = 0; i < 200; i++) {
      await sleep(20000);
      const ss = await db.shot.findMany({ where: { chapterId: CH } });
      const pend = ss.filter((s) => ["video_queued", "video_generating"].includes(s.status)).length;
      const bad = ss.filter((s) => !["video_ready", "done", "video_queued", "video_generating"].includes(s.status));
      if (bad.length) { console.log("仍失败:", bad.map((s) => "#" + s.index + " " + (s.reviewNote || "").slice(0, 160)).join("\n")); return; }
      if (!pend) break;
      if (i % 6 === 0) console.log(new Date().toTimeString().slice(0, 8), "待完成", pend);
    }
  }
  const ss = await db.shot.findMany({ where: { chapterId: CH }, orderBy: { index: "asc" } });
  const ready = ss.filter((s) => ["video_ready", "done"].includes(s.status)).length;
  console.log("可用镜头 " + ready + "/" + ss.length + "，开始导出");
  await db.chapter.update({ where: { id: CH }, data: { exportStatus: "running", exportError: "" } });
  await db.job.create({ data: { type: "chapter.export", payload: JSON.stringify({ chapterId: CH }), runAt: new Date() } });
  for (let i = 0; i < 120; i++) {
    await sleep(15000);
    const ch = await db.chapter.findUnique({ where: { id: CH }, include: { export: true } });
    if (ch.exportStatus === "ready") { console.log("导出完成:", ch.export.path, (ch.export.duration || 0).toFixed(1) + "s", (ch.export.bytes / 1048576).toFixed(1) + "MB"); break; }
    if (ch.exportStatus === "failed") { console.log("导出失败:", ch.exportError); break; }
  }
  await db.$disconnect();
})();
