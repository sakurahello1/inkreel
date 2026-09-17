const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

// 每镜：新时长 + 台词覆写（null 表示不动）
const DUR = { 2:8, 4:10, 5:8, 6:11, 15:10, 17:7, 21:9, 22:7, 26:8, 27:10, 28:6, 29:11, 30:6, 31:13 };

// 精简过长旁白（按镜号 → 新的 line 数组，顺序与原 dialogue 对齐；undefined 表示删除该条）
const LINES = {
  15: ["沈幼怡同学你好，我叫陆丰。这些零食留着课间吃，有不懂的也可以问我。"],
  26: ["我站在门口，额头全是汗。", "她眼底亮了一下。"],
  27: ["废弃实验楼，五楼天台。风灌进来。", null, "糖醋里脊的甜味被风吹得到处都是。"],
  28: ["她咬下第一口，动作顿了一下。", "甜的。", null, null],
  29: ["谢谢哥哥。", "我的筷子停了半拍，耳根烫了一下。", "把那股说不清的东西，混着饭一并咽下去。"],
  31: ["云层裂开一道缝，光打在我侧脸上。", "她半张脸藏在门板后面。", "她没走。", "我回头的时候，正撞上那双眼睛。"],
};

// 现场同期声（有口型）的台词；其余一律画外音
const ONCAM = {
  15: ["沈幼怡同学你好"],
  17: ["哟，陆大少", "这是我……", "老班！"],
  19: ["对，给大家的"],
  21: ["想吃什么", "我知道个没人的地方"],
};
const VO_FEMALE = { 16: "不是说好在学校不认识吗。", 22: "都可以。", 29: "谢谢哥哥。" };

function narrate(p) {
  return p
    .replace(/陈诚以内心旁白[^「]{0,12}说/g, "男声画外音旁白（画面中无人开口）")
    .replace(/陈诚旁白[，,]?[^「：]{0,14}[说：]/g, "男声画外音旁白：")
    .replace(/陈诚旁白/g, "男声画外音旁白")
    .replace(/停顿后压低声音说/g, "停顿后画外音压低声音")
    .replace(/停顿后继续说/g, "停顿后画外音继续");
}

(async () => {
  const chapterId = process.argv[2];
  const shots = await db.shot.findMany({ where: { chapterId }, orderBy: { index: "asc" }, include: { unit: true } });
  const chars = await db.character.findMany();
  const nm = (id) => (chars.find((c) => c.id === id) || {}).name || "?";

  for (const s of shots) {
    let d = JSON.parse(s.dialogue || "[]");
    if (LINES[s.index]) {
      const repl = LINES[s.index];
      d = d.map((x, i) => (repl[i] === null ? null : { ...x, line: repl[i] ?? x.line })).filter(Boolean);
    }
    let vp = narrate(s.videoPrompt);

    // 便签/眼神：不要让模型渲染中文字，也不要对口型
    if (s.index === 22) vp = vp.replace(/便利贴上写着「都可以。」/, "便签上的字迹不必清晰可辨；沈幼怡始终没有开口");
    if (s.index === 16) vp = vp.replace(/沈幼怡的眼神像是在说：/, "沈幼怡没有开口，她的心声以女声画外音响起：");
    if (s.index === 29) vp = vp.replace(/便签上的内容以男声画外音旁白读出，沈幼怡没有开口，旁白声音很轻：/, "便签上的内容以沈幼怡的轻声女声画外音读出，她没有开口：");

    // 音频指令
    const on = ONCAM[s.index];
    const vf = VO_FEMALE[s.index];
    const bits = [];
    if (on) bits.push(`「${on.join("」「")}」这几句由画面中的人物真实开口说出，要有准确口型`);
    if (vf) bits.push(`「${vf}」是沈幼怡的女声画外音（她写在纸上/只用眼神表达），她全程不开口、嘴唇保持闭合`);
    bits.push("其余所有「」中的句子都是成年男声画外音旁白（陈诚的内心独白），画面中任何人都不得做出说话口型，嘴唇保持闭合");
    if (d.length) vp += `\n【音频】${bits.join("；")}。`;

    const dur = DUR[s.index] ?? s.duration;
    await db.shot.update({ where: { id: s.id }, data: { dialogue: JSON.stringify(d), videoPrompt: vp, duration: dur } });
  }

  // 拆 #28：新增一镜承接「我猜她喜欢甜口」
  const s28 = shots.find((x) => x.index === 28);
  const chengId = (chars.find((c) => c.name === "陈诚") || {}).id;
  await db.shot.updateMany({ where: { chapterId, index: { gte: 29 } }, data: {} });
  const after = await db.shot.findMany({ where: { chapterId, index: { gte: 29 } }, orderBy: { index: "desc" } });
  for (const s of after) await db.shot.update({ where: { id: s.id }, data: { index: s.index + 1 } });

  await db.shot.create({
    data: {
      chapterId, unitId: s28.unitId, index: 29, panelIndex: 2,
      scene: "废弃实验楼天台，午后",
      shotSize: "近景",
      camera: "镜头从饭盒里剩下的糖醋里脊缓慢摇到陈诚，他垂着眼假装专心扒饭，嘴角却轻轻扬了一下；后景沈幼怡低头小口吃着，腮帮鼓鼓的，筷子越夹越快",
      duration: 11,
      emotion: "笨拙的宠溺与被印证的确认感",
      action: "陈诚假装看别处，用余光确认她在吃；沈幼怡专注吃饭，夹菜速度加快",
      sound: "筷子碰饭盒、咀嚼声、风吹过护栏与发丝、远处操场模糊人声",
      characters: s28.characters, props: s28.props,
      dialogue: JSON.stringify([{ characterId: chengId, line: "上次在家做西红柿炒蛋，我放了点糖，她多夹了好几筷。我猜她喜欢甜口。猜对了。", tone: "低而缓的内心旁白，说到最后一句时带一点藏不住的得意" }]),
      framePrompt: s28.framePrompt,
      videoPrompt:
        "镜头从饭盒里剩下的糖醋里脊缓慢摇到陈诚，他盘腿坐在天台水泥地上，垂着眼假装专心扒饭，嘴角却轻轻扬了一下；后景虚焦的沈幼怡低着头小口吃饭，腮帮子鼓鼓的，嚼得很慢，但筷子越夹越快。男声画外音旁白低而缓地说「上次在家做西红柿炒蛋，我放了点糖，她多夹了好几筷。我猜她喜欢甜口。」停顿一拍后带着一点藏不住的得意补一句「猜对了。」情绪是无人打扰的满足和笨拙的宠溺。筷子碰饭盒、咀嚼声、风吹过护栏和发丝、远处操场的模糊人声清楚可闻" +
        "\n【音频】所有「」中的句子都是成年男声画外音旁白（陈诚的内心独白），画面中任何人都不得做出说话口型，嘴唇保持闭合。",
      frameMode: "image", status: s28.status,
    },
  });
  // 组内 panelIndex 重排
  const unitShots = await db.shot.findMany({ where: { unitId: s28.unitId }, orderBy: { index: "asc" } });
  for (let i = 0; i < unitShots.length; i++) await db.shot.update({ where: { id: unitShots[i].id }, data: { panelIndex: i + 1 } });

  const fin = await db.shot.findMany({ where: { chapterId }, orderBy: { index: "asc" } });
  let tot = 0, bad = 0;
  for (const s of fin) {
    tot += s.duration;
    const n = JSON.parse(s.dialogue || "[]").reduce((a, x) => a + x.line.replace(/[，。！？、…—「」\s]/g, "").length, 0);
    const r = n / s.duration;
    if (r > 3.25) { bad++; console.log("  过快 #" + s.index, s.duration + "s", n + "字", r.toFixed(2)); }
  }
  console.log(fin.length + " 镜", tot + " 秒 =", (tot / 60).toFixed(1) + " 分钟，超速镜头 " + bad);
  await db.$disconnect();
})();
