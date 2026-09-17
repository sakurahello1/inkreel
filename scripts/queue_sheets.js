const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
(async () => {
  const CH = process.argv[2];
  const shots = await db.shot.findMany({ where: { chapterId: CH }, orderBy: { index: "asc" } });
  for (const s of shots) {
    const lines = JSON.parse(s.dialogue || "[]").map((d) => d.line.trim()).filter(Boolean);
    await db.shot.update({ where: { id: s.id }, data: { clipSubtitle: lines.join("\n"), status: "storyboard_approved" } });
  }
  const units = await db.unit.findMany({ where: { chapterId: CH }, orderBy: { index: "asc" } });
  for (const u of units) {
    await db.unit.update({ where: { id: u.id }, data: { sheetStatus: "queued", sheetError: "" } });
    await db.job.create({ data: { type: "unit.sheet", payload: JSON.stringify({ unitId: u.id }), runAt: new Date() } });
  }
  console.log("字幕已锁定 " + shots.length + " 镜，已排 " + units.length + " 张分镜组漫画页");
  await db.$disconnect();
})();
