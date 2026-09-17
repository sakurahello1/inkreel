import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { projects as mock } from "@/lib/mock";

/** 开发用：把示例数据写入数据库（只在库为空时执行）。POST /api/dev/seed?force=1 可清空重建。 */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return new NextResponse("disabled", { status: 403 });
  const force = new URL(req.url).searchParams.get("force") === "1";
  const existing = await db.project.count();
  if (existing > 0 && !force) return NextResponse.json({ ok: false, message: "库不为空，加 ?force=1 重建" });
  if (force) {
    await db.job.deleteMany();
    await db.generation.deleteMany();
    await db.project.deleteMany();
    await db.asset.deleteMany();
  }

  for (const p of mock) {
    const project = await db.project.create({
      data: {
        title: p.title,
        genre: p.genre.join("，"),
        orientation: p.orientation,
        targetEpisodes: p.targetEpisodes,
        world: p.world,
        style: p.style,
      },
    });
    const charIds = new Map<string, string>();
    let ci = 0;
    for (const c of p.characters) {
      const row = await db.character.create({
        data: {
          projectId: project.id,
          name: c.name,
          age: c.age,
          role: c.role,
          personality: c.personality,
          catchphrase: c.catchphrase,
          relations: c.relations,
          order: ci++,
          personas: {
            create: c.personas.map((pe, i) => ({ tag: pe.tag, description: pe.description, prompt: "", order: i })),
          },
        },
      });
      charIds.set(c.id, row.id);
    }
    for (const ch of p.chapters) {
      const chapter = await db.chapter.create({
        data: { projectId: project.id, index: ch.index, title: ch.title, sourceText: ch.sourceText.join("\n") },
      });
      const unitIds = new Map<string, string>();
      let ui = 0;
      for (const u of ch.units) {
        const row = await db.unit.create({ data: { chapterId: chapter.id, index: ++ui, summary: u.summary, paraStart: u.sourceRange[0], paraEnd: u.sourceRange[1] } });
        unitIds.set(u.id, row.id);
      }
      for (const s of ch.shots) {
        await db.shot.create({
          data: {
            chapterId: chapter.id,
            unitId: unitIds.get(s.unitId) ?? null,
            index: s.index,
            scene: s.scene,
            shotSize: s.shotSize,
            camera: s.camera,
            duration: s.duration,
            emotion: s.emotion,
            action: s.action,
            sound: s.sound,
            characters: JSON.stringify(s.characters.map((c) => ({ characterId: charIds.get(c.characterId) ?? c.characterId, personaTag: c.personaTag }))),
            dialogue: JSON.stringify(s.dialogue.map((d) => ({ characterId: charIds.get(d.characterId) ?? d.characterId, line: d.line, tone: d.tone }))),
            framePrompt: s.framePrompt,
            videoPrompt: s.videoPrompt,
            frameMode: s.frameMode,
            status: "draft",
            needsReview: Boolean(s.needsReview),
          },
        });
      }
    }
  }
  const count = await db.project.count();
  return NextResponse.json({ ok: true, projects: count });
}
