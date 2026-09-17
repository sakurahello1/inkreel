import { db } from "../src/server/db";
import { chat, extractJson } from "../src/server/providers/chat";

/**
 * 把 77 镜的首帧提示词从竖屏改写成横屏。
 *
 * 不能机械替换。这些提示词是真的按竖屏在布局的：
 *   「保留上下空间表现教室纵深」「置于下方三分之一，顶部留出窗光与粉尘空间」
 * 把「竖屏9:16」四个字换掉，剩下的空间指令仍然是竖屏的，而系统还会在末尾追加
 * 「横屏 16:9 构图」——两边打架，模型只会画出四不像。
 *
 * 所以逐条交给模型重写构图那一句：保留它想强调的内容（发丝、泪光、材质、道具位置），
 * 只把画面的方位关系翻译到横向。景别、机位、人物描述一律不动。
 */
const SYS = `你是分镜师。用户会给你若干条「首帧提示词」，它们原本是为竖屏 9:16 画面写的，现在整部片子改成横屏 16:9。

只做一件事：把其中关于画面构图与方位的表述，改写成适合横屏的。

必须遵守：
- 景别、机位、光线、人物外貌、服装、表情、动作、道具，一个字都不要改。
- 只改构图方位类的表述。竖屏靠上下经营空间，横屏靠左右：
  「保留上下空间」→ 改成利用左右空间；「置于下方三分之一，顶部留出X」→ 改成置于画面一侧三分之一，另一侧留出 X；
  「占据画面上半 / 下半」→ 改成占据画面左侧 / 右侧；「纵向延伸」→ 改成横向延伸。
- 句首的「竖屏9:16构图」统一改成「横屏16:9构图」。
- 横屏两侧空间变多，如果原文只写了主体，可以顺势补一句同场景里合理的横向环境元素（相邻的课桌、窗户、走道、同学的虚化肩背等），但不要新增有名有姓的人物、不要改变故事内容。
- 保持原来的行文风格与句式密度，不要变长很多。

输出严格 json（小写 json 格式，不要任何解释文字）：{"items":[{"i":原样返回的编号,"p":"改写后的完整首帧提示词"}]}`;

async function main() {
  const PID = "cmtuaacxa0000v7dooo97lonk";
  const all = await db.shot.findMany({
    where: { chapter: { projectId: PID }, framePrompt: { not: "" } },
    include: { chapter: true },
    orderBy: [{ chapterId: "asc" }, { index: "asc" }],
  });
  // 断点续跑：已经带「横屏」的说明这一条改过了。上游偶尔返回空正文，跑一半挂掉是常态
  const shots = all.filter((s) => !s.framePrompt.includes("横屏"));
  console.log(`共 ${all.length} 条，已改 ${all.length - shots.length} 条，本次待改 ${shots.length} 条`);

  const SIZE = 8;
  let done = 0;
  for (let i = 0; i < shots.length; i += SIZE) {
    const batch = shots.slice(i, i + SIZE);
    const user = batch.map((s, k) => `【${i + k}】${s.framePrompt}`).join("\n\n");
    // 单批失败不该拖垮整轮：记下来继续，最后再跑一次脚本补齐
    try {
      const res = await chat(
        [
          { role: "system", content: SYS },
          { role: "user", content: user },
        ],
        { json: true, maxTokens: 8000, timeoutMs: 10 * 60 * 1000 },
      );
      const out = extractJson<{ items: Array<{ i: number; p: string }> }>(res.text);
      for (const it of out.items ?? []) {
        const s = shots[it.i];
        if (!s || !it.p?.trim()) continue;
        await db.shot.update({ where: { id: s.id }, data: { framePrompt: it.p.trim() } });
        done++;
      }
      console.log(`  ${Math.min(i + SIZE, shots.length)}/${shots.length}`);
    } catch (e) {
      console.log(`  ${Math.min(i + SIZE, shots.length)}/${shots.length} 本批失败：${String(e).slice(0, 120)}`);
    }
  }
  console.log(`改写 ${done} 条`);

  // 视频提示词里也有零星的竖屏字样，这个可以直接换
  const vs = await db.shot.findMany({ where: { chapter: { projectId: PID }, videoPrompt: { contains: "竖屏" } } });
  for (const s of vs) {
    await db.shot.update({ where: { id: s.id }, data: { videoPrompt: s.videoPrompt.replace(/竖屏\s*9:16/g, "横屏 16:9").replace(/竖屏/g, "横屏") } });
  }
  console.log(`视频提示词修正 ${vs.length} 条`);

  await db.project.update({ where: { id: PID }, data: { orientation: "16:9" } });
  console.log("项目画幅已设为 16:9");
  await db.$disconnect();
}
main();
