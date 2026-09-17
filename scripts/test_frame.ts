import fs from "node:fs";
import { db } from "../src/server/db";
import { readAsset, saveAsset, assetUrl } from "../src/server/storage";
import { generateImageWithRefs, estimateImageCost, type ImageRef } from "../src/server/providers/image";
import { framePrompt } from "../src/server/prompts";

/** 单出一张试片帧，用来验证画风，不进任何镜头 */
async function main() {
  const [projectId, who, tag] = process.argv.slice(2);
  const scene = process.argv[5];
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const p = await db.persona.findFirstOrThrow({
    where: { character: { projectId, name: who }, tag },
    include: { character: true, sheet: true },
  });
  const refs: ImageRef[] = [];
  const names: string[] = [];
  if (p.sheet) {
    refs.push({ buffer: await readAsset(p.sheet.path), mime: p.sheet.mime, name: `${who}-${tag}.png` });
    names.push(`${who}·${tag}`);
  }
  const prompt = framePrompt({ style: project.style, framePrompt: scene, refNames: names });
  console.log("出图中…");
  const r = await generateImageWithRefs({ prompt, size: "1152x2048", refs });
  const asset = await saveAsset({ buffer: r.buffer, mime: r.mime, kind: "image", projectId, folder: "frames" });
  console.log("成本 $" + estimateImageCost(r.usage).toFixed(3), asset.path);
  fs.writeFileSync("G:/short play production/testframe.txt", asset.path);
  await db.$disconnect();
}
main();
