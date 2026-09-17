import { db } from "../src/server/db";
import fs from "node:fs";
async function main() {
  const projectId = process.argv[2];
  const defs = [
    { f: "Bittersweet.mp3", n: "Bittersweet", d: 202, mood: "怀旧，苦涩，遗憾", desc: "轻钢琴带微苦，用于前世回忆与临终段落" },
    { f: "Sincerely.mp3", n: "Sincerely", d: 375, mood: "温暖，青春，心动", desc: "温柔钢琴，用于教室日常与甜的段落" },
  ];
  for (const [i, d] of defs.entries()) {
    const path = `bgm/${d.f}`;
    const st = fs.statSync(`G:/short-play-data/storage/${path}`);
    const a = await db.asset.create({ data: { projectId, kind: "audio", path, mime: "audio/mpeg", bytes: st.size, duration: d.d } });
    const t = await db.bgmTrack.create({ data: { projectId, assetId: a.id, name: d.n, mood: d.mood, description: d.desc, volume: 0.2, order: i } });
    console.log("加入 BGM", t.name);
  }
  await db.$disconnect();
}
main();
