import { db } from "../src/server/db";

/**
 * 建场景库并把 77 镜挂上去。
 *
 * 拆镜写出了 52 种 scene 文字，但物理场景只有 5 处。更糟的是同一间教室同一个上午，
 * 光线描述互相打架（「日光灯冷白」「暖黄日光」「冷白压过暖黄」并存），
 * 不锚定的话每张首帧都会各自发明一遍这间教室。
 */
const SCENES: Array<{ key: string; name: string; description: string; match: (s: string) => boolean }> = [
  {
    key: "classroom",
    name: "高三四班教室",
    description: `2009 年中国南方县城中学的老式教室，高三四班。
【空间】长方形，进深较大，六排木质课桌椅两两并排，中间一条过道。水磨石地面被踩得发亮，墙裙是半人高的暗绿色油漆，墙面白灰略有剥落。
【门窗】左侧一整排木框玻璃窗，窗格细密，冬天玻璃下半部结着霜，窗外是光秃的树和对面教学楼。右侧墙上有前后两扇门，后门靠近最后一排。
【前方】正面一整块绿色水磨石黑板，槽里有粉笔和板擦；黑板上方挂着标语横幅；黑板右侧是木质讲台，讲台上有一摞作业本。
【后方】后墙一块黑板报，贴着高考倒计时牌；角落堆着扫把、拖把和一摞旧书。
【顶部】天花板两台老式吊扇，两排裸露的日光灯管。
【氛围】空气里常年浮着粉笔灰，阳光斜射进来时能看见光柱。整体是暖黄日光与青灰阴影两层。`,
    match: (s) => s.includes("高三四班") || s.includes("临安一中"),
  },
  {
    key: "redcarpet",
    name: "红毯之夜",
    description: `十年后的颁奖礼红毯现场，夜晚。
【空间】长条红毯从入口一直铺到远处的背景板，两侧是金属护栏与密集的媒体区。
【背景】巨大的品牌背景板，冷色调，反光材质。
【光】数百支闪光灯连成一片惨白的光墙，主体被强烈的正面硬光打亮，边缘有冷调轮廓光；红毯本身反射出暖红。
【人群】护栏外密集的摄影记者与举着手机的人群，全部虚化成光斑与剪影。
【氛围】冷调银白为主，明暗对比极强，空气里有闪光灯造成的细微光晕。与教室那种温吞的暖黄完全相反。`,
    match: (s) => s.includes("红毯") || s.includes("闪光灯"),
  },
  {
    key: "jujube",
    name: "老城区小卖部门口的枣树下",
    description: `临安老城区一条旧街，一家小卖部门口，冬日傍晚。
【空间】水泥路面开裂，路边一棵老枣树，树干粗糙皲裂，枝叶间挂满熟透的红枣，地上散落着落下的枣子。
【建筑】小卖部是一层砖房，卷帘门半开，门口摆着旧冰柜和塑料板凳；墙上是褪色的手写招牌和过期的小广告。
【环境】街的另一侧是低矮的民房与院墙，电线在头顶横过，远处能看到县城的天际线。
【光】浓烈的橘红夕阳从街的一端斜射过来，把整条街染成橘红，逆光很强，树影拉得很长，空气里有细小的浮尘。
【氛围】温暖但迟暮，与教室的清冷完全不同。`,
    match: (s) => s.includes("枣树") || s.includes("院落门口") || s.includes("小卖部"),
  },
  {
    key: "eatery",
    name: "老城区小饭馆后厨",
    description: `临安老城区一家路边小饭馆的后厨与过道，冬夜刚落。
【空间】狭窄逼仄，过道只容一人侧身通过；后厨在里侧，灶台上是巨大的炒锅，蒸笼冒着白雾。
【陈设】墙上贴着油污的白瓷砖，地面湿滑发亮；不锈钢操作台上堆着碗碟，头顶挂着一排勺子与漏勺。
【光】一只昏黄的白炽灯泡悬在过道中央，光线浑浊；后厨的白雾在灯下形成明显的光柱。
【氛围】油烟弥漫，暖黄浑浊，空间压迫感强。`,
    match: (s) => s.includes("小饭馆") || s.includes("后厨"),
  },
];

async function main() {
  const PID = "cmtuaacxa0000v7dooo97lonk";
  const ids = new Map<string, string>();
  for (const [i, sc] of SCENES.entries()) {
    const found = await db.scene.findFirst({ where: { projectId: PID, name: sc.name } });
    const row = found
      ? await db.scene.update({ where: { id: found.id }, data: { description: sc.description, prompt: "" } })
      : await db.scene.create({ data: { projectId: PID, name: sc.name, description: sc.description, order: i } });
    ids.set(sc.key, row.id);
    console.log(`${found ? "更新" : "新建"} ${sc.name}`);
  }

  const shots = await db.shot.findMany({ where: { chapter: { projectId: PID } }, include: { chapter: true }, orderBy: [{ chapterId: "asc" }, { index: "asc" }] });
  const tally = new Map<string, number>();
  const unmatched: string[] = [];
  for (const s of shots) {
    const hay = `${s.scene} ${s.framePrompt} ${s.videoPrompt}`;
    const hit = SCENES.find((x) => x.match(hay));
    if (!hit) {
      unmatched.push(`ep${s.chapter.index} #${s.index} ${s.scene}`);
      continue;
    }
    await db.shot.update({ where: { id: s.id }, data: { sceneId: ids.get(hit.key)! } });
    tally.set(hit.name, (tally.get(hit.name) ?? 0) + 1);
  }
  console.log("");
  for (const [k, v] of tally) console.log(`${k}: ${v} 镜`);
  if (unmatched.length) {
    console.log(`\n未匹配 ${unmatched.length} 镜：`);
    unmatched.forEach((x) => console.log("  " + x));
  }
  await db.$disconnect();
}
main();
