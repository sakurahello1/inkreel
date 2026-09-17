import { db } from "../src/server/db";

/**
 * 建《同桌说：你压到我头发了》项目：世界观、画风、人物人设、道具。
 * 只铺资产，不生成图，也不写分镜——那两步单独跑。
 */

const WORLD = `2009 年 12 月，临安城老城区，解放路 666 号，临安一中，高三四班。

【时代质感】2009 年的中国县城高中。教室是老式的：水磨石地面、木质课桌椅、绿色黑板、吊扇、日光灯管、后墙贴着高考倒计时和成绩榜。学生穿蓝白两色运动校服。手机是滑盖直板机，教室里没有多媒体。冬天没有暖气，窗户结霜，同学搓手呵气。

【核心设定】男主顾言重生了。前世他 30 岁死于绝症，临死前才知道当年那个不起眼的同桌楚薇薇，十年后成了国民女神、全球十大富豪，并在红毯上当众向他告白，而他因为病重拒绝了。重生回高三这一天，他绑定了「欺负老婆」系统——每次「欺负」女主可获得奖励判定，但系统有一百条正能量条款，不许暴力、不许冷暴力、不许胁迫，奖励高低取决于女主内心真实接受的程度。

【核心关系】顾言与楚薇薇是同桌。顾言身高 188，体重 160 斤，是四班班长，成绩中游偏下，性格吊儿郎当但讲义气。楚薇薇成绩年级前三十，是全班最乖的学霸，却极度自卑：母亲早逝，父亲失踪，与奶奶相依为命，一天生活费只有五块钱。她常年穿同一套洗得发白的校服，长刘海遮住半张脸，坐在靠墙的角落，靠勤工俭学撑生活。

【楚薇薇的行为特征】被人注视时会往角落里缩，低头，用刘海挡脸。说话细声细语，软糯。委屈时瘪嘴、睫毛挂水珠但强忍不哭。奶奶教她「不要跟自己打不过的人抬杠」，所以顾言说什么她都照做。她有一头带茉莉清香的柔顺长发，身上有淡淡奶香。

【时空跨度】故事在三条时间线之间切换：高三教室的当下（2009 年冬）、前世高中回忆（山竹事件）、前世十年后（红毯之夜、枣树下的临终）。前世十年后的段落要与高中段落形成强烈的视觉反差。`;

const STYLE = `精致日系动漫风格，接近高质量 TV 动画关键帧与剧场版分镜的完成度。
干净利落的线稿，赛璐璐上色配合柔和渐变；五官清秀，眼睛有细致高光与虹膜层次；头发分缕，有明显高光带。
整体是 2009 年中国县城高中的怀旧质感：暖黄日光、褪色的蓝白校服、水磨石地面的反光、吊扇在天花板缓慢转动、粉笔灰在光柱里浮动。
光线是主角：清晨斜射的暖光、窗框投在课桌上的长影、逆光下的发丝轮廓、夕阳把整个画面染成橘红。
构图讲究景深，前景常有虚化的课桌角与同学的肩背；人物比例写实偏修长，不夸张、不 Q 版。
情绪色调分三层：高三教室是暖黄与青灰；前世红毯是冷调的银白与聚光灯；枣树下的临终是浓烈的橘红夕阳。
不要 3D 渲染感、不要厚涂写实油画感、不要照片质感、不要美颜滤镜感。`;

type P = { tag: string; description: string };
const CHARACTERS: Array<{ name: string; age: string; role: string; personality: string; relations: string; personas: P[] }> = [
  {
    name: "顾言",
    age: "18（前世 30）",
    role: "男主 · 高三四班班长",
    personality: "吊儿郎当，嘴上不正经，护短，重情义。重生后目标明确：珍惜楚薇薇的每一分每一秒。",
    relations: "楚薇薇的同桌；王多福、刘波儿是损友；老许是班主任。",
    personas: [
      {
        tag: "高中",
        description:
          "18 岁男生，身高 188cm 体格结实，黑色短碎发略显凌乱，剑眉，眼神明亮带一点痞气。穿 2009 年款蓝白两色运动校服，外套拉链敞开，里面是白色圆领 T 恤，校裤宽松，白色帆布鞋。姿态松垮，站着时常常双手插兜，一副没睡醒的样子。",
      },
      {
        tag: "病重",
        description:
          "30 岁男性，与高中同一张脸但极度消瘦，颧骨突出，脸色灰败，嘴唇干裂起皮，眼窝深陷但眼神温和。穿宽松的深色家居棉服，衣服明显空荡。头发稀疏短硬。整个人有一种油尽灯枯的静气。",
      },
    ],
  },
  {
    name: "楚薇薇",
    age: "18（前世 28）",
    role: "女主 · 高三四班学霸",
    personality: "极度内向自卑，说话细声细语，委屈了也不敢大声。心里其实有主见，笑起来会变得很亮。",
    relations: "顾言的同桌，暗恋他；与奶奶相依为命。",
    personas: [
      {
        tag: "高中",
        description:
          "18 岁女生，身高 169cm，身形纤细。乌黑柔顺的及腰长发，长刘海遮住大半额头和一侧眼睛。鹅蛋脸，五官清秀，琼鼻小巧，大眼睛长睫毛，笑起来脸颊有浅浅梨涡。穿洗得发白的蓝白运动校服，尺寸偏大，袖口盖住手背，脚上是旧的白色帆布鞋。姿态总是微微含胸低头，双手抓着衣角。",
      },
      {
        tag: "红毯",
        description:
          "28 岁女性，与高中同一张脸但完全长开：气场沉静，妆容精致。乌黑长发盘起，露出修长脖颈。穿一袭白色及地长礼裙，剪裁利落，肩线优雅。站姿挺拔从容，神情明亮而坚定。整个人明艳夺目，与高中时的怯懦判若两人。",
      },
    ],
  },
  {
    name: "老许",
    age: "40",
    role: "高三四班班主任 · 语文老师",
    personality: "进教室前哼小曲，进门立刻板脸。刀子嘴豆腐心，特别护着班里的好学生。",
    relations: "顾言的班主任，一心想阻止他「祸害」楚薇薇。",
    personas: [
      {
        tag: "班主任",
        description:
          "40 岁男性，中等身材略发福，方脸，短发梳得整齐，戴一副黑框眼镜。穿深色夹克外套配格子衬衫、深色西裤。手里常拿着教案本或粉笔。表情在憋笑和板脸之间切换，皱眉时抬头纹明显。",
      },
    ],
  },
  {
    name: "王多福",
    age: "18",
    role: "顾言的损友 · 同班胖子",
    personality: "话痨，表情夸张，看热闹不嫌事大，起哄第一名。",
    relations: "顾言的邻座和好兄弟。",
    personas: [
      {
        tag: "高中",
        description:
          "18 岁男生，身材圆胖，圆脸，眯眯眼，笑起来眼睛眯成一条缝。头发短而蓬。穿与全班同款的蓝白运动校服，因为体型而绷得较紧。动作幅度大，常竖大拇指或手舞足蹈。",
      },
    ],
  },
  {
    name: "刘波儿",
    age: "18",
    role: "顾言的损友 · 坐王多福后排",
    personality: "起哄的第二发声源，爱喊口号，捧场王。",
    relations: "顾言的兄弟。",
    personas: [
      {
        tag: "高中",
        description:
          "18 岁男生，身材偏瘦高，头发略长盖住耳朵，眉眼灵活，一副随时准备搞事的表情。穿蓝白运动校服，外套只拉一半。常做振臂高呼的动作。",
      },
    ],
  },
  {
    name: "王诗诗",
    age: "18",
    role: "家境优渥的女同学",
    personality: "表面淑女得体，实则带着不自觉的优越感。",
    relations: "曾在四班，后转到零班；山竹事件的起因。",
    personas: [
      {
        tag: "高中",
        description:
          "18 岁女生，长发披肩打理精致，皮肤白皙，五官漂亮但神情带一点居高临下的甜。校服是新的，颜色鲜亮，领口系着一条淡色小丝巾以示区别。姿态挺拔，说话时微微歪头。",
      },
    ],
  },
];

const PROPS: Array<{ name: string; description: string }> = [
  { name: "山竹", description: "紫褐色硬壳的热带水果，顶部有绿色花萼。一颗完整的，一颗被剥开露出雪白蒜瓣状果肉。2009 年在县城属于昂贵稀罕物。" },
  { name: "竖起的课本", description: "2009 年款高中语文课本，封面朴素，书页泛黄，边角卷起。摊开后竖立在课桌上，用来遮挡两个人的脑袋。" },
  { name: "教案本", description: "老式硬壳教案本，深蓝色封皮，边角磨损，里面夹着粉笔和红笔。班主任用来拍讲台的那一本。" },
  { name: "枣树与红枣", description: "老式院落门口的一棵枣树，枝干粗糙。枝头结满红澄澄的枣，风一吹就咚咚落地。地上散落着熟透的红枣。" },
];

async function main() {
  const project = await db.project.create({
    data: {
      title: "同桌说：你压到我头发了",
      genre: "校园, 甜宠, 重生, 系统, 都市",
      orientation: "9:16",
      targetEpisodes: 4,
      world: WORLD,
      style: STYLE,
      videoEngine: "h3",
      videoResolution: "1080P",
    },
  });
  console.log("项目", project.id, project.title);

  for (const [i, c] of CHARACTERS.entries()) {
    const ch = await db.character.create({
      data: { projectId: project.id, name: c.name, age: c.age, role: c.role, personality: c.personality, relations: c.relations, order: i },
    });
    for (const [j, p] of c.personas.entries()) {
      await db.persona.create({ data: { characterId: ch.id, tag: p.tag, description: p.description, order: j } });
    }
    console.log(`  人物 ${c.name}（${c.personas.map((p) => p.tag).join("、")}）`);
  }

  for (const [i, p] of PROPS.entries()) {
    await db.prop.create({ data: { projectId: project.id, name: p.name, description: p.description, order: i } });
    console.log(`  道具 ${p.name}`);
  }

  const personas = await db.persona.count({ where: { character: { projectId: project.id } } });
  console.log(`\n共 ${CHARACTERS.length} 个人物 / ${personas} 张人设 / ${PROPS.length} 个道具`);
  console.log(`项目 id: ${project.id}`);
  await db.$disconnect();
}
main();
