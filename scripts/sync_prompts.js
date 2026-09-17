const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
const R = {
  15: [["功课上有什么不懂的也可以问我", "有不懂的也可以问我"]],
  22: [["沈幼怡始终没有开口沈幼怡没有抬头", "沈幼怡始终没有开口，也没有抬头；她的心声以女声画外音轻轻响起：「都可以。」她"]],
  26: [["我站在门口，额头全是汗，领口的扣子崩开了一颗。", "我站在门口，额头全是汗。"]],
  27: [["镜头停顿，男声画外音旁白：「天台上什么都没有，只有安静。」随后风吹过饭盒，", "镜头停顿，风吹过饭盒，"]],
  28: [["男声画外音旁白：「她低着头，腮帮子鼓鼓的，嚼得很慢，但筷子越夹越快。上次在家做西红柿炒蛋，我放了点糖，她多夹了好几筷。我猜她喜欢甜口。猜对了。」",
       "她低着头，腮帮子鼓鼓的，嚼得很慢，但筷子越夹越快——这是画面动作，不要念出来。"]],
  30: [["低头猛扒两口饭，把那股说不清的东西，混着饭一并咽下去。", "把那股说不清的东西，混着饭一并咽下去。"]],
  32: [["她站在门后，半张脸藏在门板后面。", "她半张脸藏在门板后面。"]],
};
(async () => {
  const ss = await db.shot.findMany({ where: { chapterId: process.argv[2] }, orderBy: { index: "asc" } });
  for (const s of ss) {
    let vp = s.videoPrompt;
    for (const [a, b] of R[s.index] || []) {
      if (!vp.includes(a)) { console.log("!! #" + s.index + " 未命中: " + a.slice(0, 20)); continue; }
      vp = vp.replace(a, b);
    }
    vp = vp.replace("【音频】其余所有「」中的句子", "【音频】所有「」中的句子");
    if (vp !== s.videoPrompt) await db.shot.update({ where: { id: s.id }, data: { videoPrompt: vp } });
  }
  // 校验：提示词里被引号包住的句子总字数 vs 时长
  const fin = await db.shot.findMany({ where: { chapterId: process.argv[2] }, orderBy: { index: "asc" } });
  let tot = 0, bad = 0;
  for (const s of fin) {
    tot += s.duration;
    const head = s.videoPrompt.split("\n")[0];
    const q = [...head.matchAll(/「([^」]*)」/g)].map((m) => m[1]).join("");
    const n = q.replace(/[，。！？、…—\s]/g, "").length;
    const r = n / s.duration;
    if (r > 3.3) { bad++; console.log("  过快 #" + s.index, s.duration + "s", n + "字", r.toFixed(2)); }
  }
  console.log(fin.length + " 镜 " + tot + " 秒 = " + (tot / 60).toFixed(1) + " 分钟，提示词内超速 " + bad);
  await db.$disconnect();
})();
