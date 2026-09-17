const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
const CH = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 80; i++) {
    const us = await db.unit.findMany({ where: { chapterId: CH }, orderBy: { index: "asc" } });
    const c = {};
    for (const u of us) c[u.sheetStatus] = (c[u.sheetStatus] || 0) + 1;
    if (!c.queued && !c.running) {
      console.log("完成:", Object.entries(c).map(([k, v]) => k + ":" + v).join(" "));
      for (const u of us) if (u.sheetStatus !== "ready") console.log("  组" + u.index + " " + u.sheetStatus + " " + (u.sheetError || "").slice(0, 200));
      break;
    }
    if (i % 4 === 0) console.log(new Date().toTimeString().slice(0, 8), Object.entries(c).map(([k, v]) => k + ":" + v).join(" "));
    await sleep(15000);
  }
  await db.$disconnect();
})();
