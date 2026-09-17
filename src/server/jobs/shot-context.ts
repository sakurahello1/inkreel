import { db, parseJson } from "../db";
import { unitSourceText } from "../agent/storyboard";

/**
 * 镜头上下文：首帧任务与视频任务都要用同一套「这一镜牵涉到谁、用了哪些图和音」。
 * 以前是 jobs/index.ts 里的一个自由函数，现在独立出来，两个任务共享同一份装载逻辑。
 */
type ShotChar = { characterId: string; personaTag: string };

const include = {
  frame: true,
  keyframes: { include: { asset: true } },
  video: true,
  sceneAsset: { include: { sheet: true } },
  extraRefs: { include: { asset: true }, orderBy: { order: "asc" as const } },
  unit: true,
  chapter: {
    include: {
      project: {
        include: {
          styleRefs: { include: { asset: true }, orderBy: { order: "asc" as const } },
          characters: { include: { personas: { include: { sheet: true } }, voiceSample: true } },
          props: { include: { sheet: true } },
        },
      },
    },
  },
};

export type ShotContext = Awaited<ReturnType<typeof loadShotContext>>;

export async function loadShotContext(shotId: string) {
  const shot = await db.shot.findUniqueOrThrow({ where: { id: shotId }, include });
  const project = shot.chapter.project;

  // 顺序即喂给模型的顺序：先立住场地，再放人，最后摆道具
  const refs: Array<{ asset: { path: string; mime: string }; label: string; fileName: string }> = [];
  if (shot.sceneAsset?.sheet) refs.push({ asset: shot.sceneAsset.sheet, label: "场景", fileName: "scene.png" });
  for (const c of parseJson<ShotChar[]>(shot.characters, [])) {
    const ch = project.characters.find((x) => x.id === c.characterId);
    const persona = ch?.personas.find((p) => p.tag === c.personaTag) ?? ch?.personas.find((p) => p.sheet);
    if (ch && persona?.sheet) refs.push({ asset: persona.sheet, label: `${ch.name}·${persona.tag}`, fileName: `${ch.name}-${persona.tag}.png` });
  }
  for (const pid of parseJson<string[]>(shot.props, [])) {
    const pr = project.props.find((x) => x.id === pid);
    if (pr?.sheet) refs.push({ asset: pr.sheet, label: `道具·${pr.name}`, fileName: `${pr.name}.png` });
  }

  // 创作者手动补充的参考图，排在道具之后、锚点与画风之前
  for (const r of shot.extraRefs) refs.push({ asset: r.asset, label: `补充·${r.label}`, fileName: `extra-${r.id}.png` });

  // 只有本镜真正开口的人物才送声音样本，避免把无关音色塞给模型
  const speaking = new Set(parseJson<Array<{ characterId: string }>>(shot.dialogue, []).map((d) => d.characterId));
  const voices = project.characters.filter((ch) => speaking.has(ch.id) && ch.voiceSample).map((ch) => ({ asset: ch.voiceSample!, label: ch.name }));

  // 本镜对应的原文段落，送给视频模型做还原依据
  const source = unitSourceText(shot.chapter.sourceText, shot.unit);

  return { shot, project, refs, voices, source };
}
