import { referenceImagesLine, type RefImage } from "@/lib/keyframes";

/**
 * 所有提示词模板集中在这里，方便调。
 */

/** 画风参考图和身份参考图混在同一串里，必须显式区分，
 *  否则模型会拿画风图里的那张脸去对人物身份——男主会被画成参考图里的女生。 */
const STYLE_REF_NOTE =
  "其中「画风参考」定的是这部片子的统一画风，必须严格照它来：线条与上色方式、皮肤与布料的材质表现、光影处理、五官的动漫化程度，都要和它完全一致——" +
  "既不能滑成真人照片质感，也不能滑成三维卡通或平涂赛璐璐。同时它画的是别的人、别的场景，人物长相、服装、年龄、构图一概不要照搬。";

export const hasStyleRef = (names: string[]) => names.includes("画风参考");

/** 同组锚点首帧：只借场景，不借构图。说不清楚模型就会把上一镜原样重画一遍。 */
const ANCHOR_NOTE =
  "标着「同组锚点」的那张，是同一场戏里另一个镜头已经画好的画面。请沿用它的场景：同一间屋子、同样的家具陈设与位置关系、" +
  "同样的时间与光源方向、同样的色调与天气、同样的人物服装状态。但这是**另一个镜头**，机位、景别、人物姿态与表情都必须按本镜的描述重新构图，绝对不要照抄那张的构图或姿势。";

export const hasAnchor = (names: string[]) => names.some((n) => n.startsWith("同组锚点"));

/** 上一镜末帧：本镜在时间上紧接着它，画面要从它结束的状态往下走 */
const PREV_FRAME_NOTE =
  "标着「上一镜末帧」的那张，是紧接在本镜之前那个镜头**结束那一刻**的真实画面。本镜在时间上直接承接它：" +
  "人物的位置、姿态、表情、手里拿的东西、衣服的状态、光线与天气，都要从那一刻自然延续，不能跳变、不能回退。" +
  "但机位与景别按本镜自己的描述来——它交代的是「上一秒发生到哪了」，不是构图。";

export const hasPrevFrame = (names: string[]) => names.some((n) => n.startsWith("上一镜末帧"));

/** 创作者手动补充的参考图：标签就是用途，按标签参考，别的方面不要照搬 */
const EXTRA_REF_NOTE =
  "标着「补充·…」的参考图是创作者手动提供的，「补充·」后面的文字说明了它的用途（比如姿势、光线、构图、某个物件的样子）。" +
  "只在标签所说的那个方面参考它，其余方面（人物长相、服装、场景）仍以本镜描述和其他参考图为准。";

export const hasExtraRef = (names: string[]) => names.some((n) => n.startsWith("补充·"));

/** 关键帧：首帧是同一镜头开始那一刻，关键帧是同一镜头的另一时刻。除了描述里说变的，什么都别变 */
const KEYFRAME_NOTE =
  "标着「本镜首帧」的参考图是这一镜头开始那一刻的画面，你要画的是**同一个镜头在上面所说那一时刻**的画面。" +
  "场景、布景、光线方向、色温、人物的服装发型、画幅与镜头焦段都必须与首帧完全一致；" +
  "只按上面的描述改变人物的动作、位置、表情、视线，以及描述里明确提到的机位或景别变化。没提到的一律沿用首帧。";

export const hasFirstFrameRef = (names: string[]) => names.includes("本镜首帧");

export function stylePrefix(style: string) {
  const s = style.trim();
  return s ? `【画风】${s}` : "";
}

/** 人物三视图：刻意留白，构图交给 gpt-image-2 */
export function sheetPrompt(opts: { style: string; name: string; description: string; refNames: string[] }) {
  const parts = [
    stylePrefix(opts.style),
    `人物设定图：${opts.name}。${opts.description.trim()}`,
    "展示这个人物的整体造型，包含正面、侧面与背面，全身，干净的纯色背景。",
    "同一人物、同一服装在三个视角下保持一致。人物穿着完整、得体，画面端正，不做任何暴露或性暗示表现。画面中不要出现文字、标注、水印。",
  ];
  if (opts.refNames.length) parts.push(`参考图依次为：${opts.refNames.join("、")}。`);
  if (opts.refNames.some((n) => n !== "画风参考")) parts.push("同一人物的其他人设参考图中，面部特征、骨相必须与之一致，只按描述改变发型、服装、状态。");
  if (hasStyleRef(opts.refNames)) parts.push(STYLE_REF_NOTE);
  return parts.filter(Boolean).join("\n");
}

/** galgame 立绘：单人七分身站姿、指定表情、透明背景。身份靠三视图参考锚住 */
export function spritePrompt(opts: { style: string; name: string; description: string; expression: string; refNames: string[] }) {
  const parts = [
    stylePrefix(opts.style),
    `galgame 人物立绘：${opts.name}。${opts.description.trim()}`,
    `表情：${opts.expression}。表情要明确可辨，但不夸张变形。`,
    "单人，正面略偏四分之三的站姿，从头顶到膝盖以上的七分身，人物居中、完整、头顶不裁切，身体微微朝向画面左侧，手臂自然。",
    "纯白色平整背景，没有任何渐变、聚光灯、地面、投影、边框、文字、水印；人物与背景之间轮廓干净利落，便于抠图。",
    "人物穿着完整、得体，不做任何暴露或性暗示表现。",
  ];
  if (opts.refNames.length) parts.push(`参考图依次为：${opts.refNames.join("、")}。`);
  parts.push("面部特征、骨相、发型、服装必须与人设参考图完全一致，只按要求改变表情与姿态。");
  if (hasStyleRef(opts.refNames)) parts.push(STYLE_REF_NOTE);
  return parts.filter(Boolean).join("\n");
}

/** 道具概念图：单体、干净背景，方便当参考图用 */
export function propSheetPrompt(opts: { style: string; name: string; description: string; refNames?: string[] }) {
  return [
    stylePrefix(opts.style),
    `道具概念图：${opts.name}。${opts.description.trim()}`,
    "只画这一件物品本身，居中、完整、细节清晰，干净的纯色背景，不要人物、不要场景。",
    // 画风文档整篇都在写脸、皮肤、头发、眼睛，对静物一条可用的都没有，
    // 模型于是默认去拍产品摄影。静物的渲染要求得在这里单独说一遍。
    "按同一套画风渲染这件物品：动漫化的形体概括、干净利落的轮廓、成组而明确的高光与反射、浓郁饱和的色彩，以及把物体从背景剥离出来的轮廓光。" +
      "是电影级三维渲染的美术资产，不是实物照片——不要照片质感，不要产品摄影的柔光棚感。",
    hasStyleRef(opts.refNames ?? []) ? STYLE_REF_NOTE : "",
    "画面中不要出现文字、标注、水印。",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * 场景概念图：同一空间的两个互为反打视角，画在一张图里。
 * 只要空间本身，不要人物、不要情节——人物由人设图负责，位序绑定才不会乱。
 */
export function sceneSheetPrompt(opts: { style: string; name: string; description: string; refNames?: string[] }) {
  const names = opts.refNames ?? [];
  return [
    stylePrefix(opts.style),
    `场景概念图：${opts.name}。${opts.description.trim()}`,
    "一张图里横向并排两格，中间留一条细白边分隔。左格是这个空间的主视角广角全景，右格是从主视角正对面反打回来的广角全景——两格必须是同一个空间、同一套陈设、同一个时间与光线，只是镜头掉了个头。",
    "重点交代空间本身：房间的形状与进深、家具与陈设的排列和相对位置、门窗的位置与朝向、墙面地面天花板的材质与颜色、光从哪个方向进来、这个年代这个地方特有的细节。",
    "画面里不要出现任何人物，也不要讲故事，这是给后续镜头当空间基准用的美术设定图。",
    hasStyleRef(names) ? STYLE_REF_NOTE : "",
    "画面中不要出现文字、标注、格号、水印。",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 场景参考图：借空间，不借构图，也不借它那一刻的光 */
const SCENE_REF_NOTE =
  "标着「场景」的那张是本镜发生地点的空间基准图（左右两格是同一空间的正反打广角）。请严格沿用它的空间：" +
  "同样的房间形状与进深、同样的家具陈设排列与相对位置、同样的门窗位置与朝向、同样的墙地天花材质与颜色、同样的年代细节。" +
  "但机位、景别、人物、以及本镜自己的时间与光线，一律以本镜的描述为准——那张图只定「这是哪儿」，不定「这一刻长什么样」。";

export const hasSceneRef = (names: string[]) => names.includes("场景");

/** 首帧：Agent 已经写好 frame_prompt，这里补画风前缀、参考说明与硬约束 */
export function framePrompt(opts: { style: string; framePrompt: string; refNames: string[]; orientation?: string | null }) {
  const ar = opts.orientation === "16:9" ? "横屏 16:9" : "竖屏 9:16";
  const parts = [stylePrefix(opts.style), opts.framePrompt.trim()];
  if (opts.refNames.length) {
    parts.push(`参考图依次为：${opts.refNames.join("、")}。画面中的人物外貌、服装必须与对应参考图一致。`);
  }
  if (hasSceneRef(opts.refNames)) parts.push(SCENE_REF_NOTE);
  if (hasExtraRef(opts.refNames)) parts.push(EXTRA_REF_NOTE);
  if (hasPrevFrame(opts.refNames)) parts.push(PREV_FRAME_NOTE);
  if (hasAnchor(opts.refNames)) parts.push(ANCHOR_NOTE);
  if (hasStyleRef(opts.refNames)) parts.push(STYLE_REF_NOTE);
  parts.push(`${ar} 构图，电影感单帧，不要文字、字幕、水印、拼贴或多格。`);
  return parts.filter(Boolean).join("\n");
}

/** 关键帧提示词：和首帧同一套骨架，多一条「以本镜首帧为基准只改变化部分」的约束 */
export function keyframePrompt(opts: { style: string; prompt: string; at: number; duration: number; refNames: string[]; orientation?: string | null }) {
  const ar = opts.orientation === "16:9" ? "横屏 16:9" : "竖屏 9:16";
  const when = opts.at < 0 ? `镜头结束（第 ${opts.duration} 秒）时的画面` : `镜头进行到第 ${opts.at} 秒时的画面`;
  const parts = [stylePrefix(opts.style), `【${when}】${opts.prompt.trim()}`];
  if (opts.refNames.length) {
    parts.push(`参考图依次为：${opts.refNames.join("、")}。画面中的人物外貌、服装必须与对应参考图一致。`);
  }
  if (hasFirstFrameRef(opts.refNames)) parts.push(KEYFRAME_NOTE);
  if (hasSceneRef(opts.refNames)) parts.push(SCENE_REF_NOTE);
  if (hasExtraRef(opts.refNames)) parts.push(EXTRA_REF_NOTE);
  if (hasStyleRef(opts.refNames)) parts.push(STYLE_REF_NOTE);
  parts.push(`${ar} 构图，电影感单帧，不要文字、字幕、水印、拼贴或多格。`);
  return parts.filter(Boolean).join("\n");
}

/**
 * 音频约束：配乐由后期在导出时统一混音，所以视频模型只负责人声与环境音效。
 * 否则模型自带的配乐会和我们混入的 BGM 叠成两层音乐。环境音效是要的，只禁音乐。
 */
export const AUDIO_DIRECTIVE =
  "【音频要求】输出人物对白/人声，以及场景该有的环境音与音效（风、雪、脚步、衣料、器物、远处钟声等），这些都要保留。但不要生成任何背景音乐、配乐、旋律、歌曲、哼唱或乐器演奏——配乐由后期统一配。";

/**
 * 语言约束。fal 那边会先把整段提示词改写成英文再喂模型，台词跟着被翻译，
 * 模型念哪种语言就看运气——同一镜三条里两条说了英文。加上这条之后三条全中文。
 * 中英双写是故意的：改写器读英文那句，模型读中文那句。
 */
/**
 * 视频的唯一风格：动漫 3D。写死，不走项目设置。
 * 视频模型的赛璐璐（2D 平涂）风格不稳定，同一条里会在 2D 和 3D 之间反复横跳；只有三维动画渲染那一档是稳的。
 * 每一条送给视频模型的提示词（预演、首帧出片、分段、文生）都带这一段。
 */
export const VIDEO_STYLE_DIRECTIVE =
  "【画面风格】高品质三维动画渲染的动漫风格（3D anime，接近动画电影与游戏过场 CG）：人物是立体建模，皮肤、头发、布料有真实的光影与材质，有景深与体积光。" +
  "绝不要平涂赛璐璐的 2D 动画，不要真人实拍；整段视频从头到尾风格必须一致，不能在 2D 与 3D 之间切换。" +
  " Style: high-quality 3D-rendered anime (like animated feature film / game cinematic CG), consistent throughout; never flat cel-shaded 2D, never live action.";

export const LANGUAGE_DIRECTIVE =
  "【语言要求】所有人物对白必须使用中文普通话说出。台词原文是「」内的中文句子，必须逐字原样念出，绝对不要翻译成英文或任何其他语言，不要改词、不要增减。" +
  " All spoken dialogue MUST be in Mandarin Chinese, verbatim from the quoted Chinese text; never translate it into English.";

/**
 * 视频。首帧模式下不重复描述外貌；直出模式下 Agent 已写全。
 * imageRefs 与实际送出的图片严格同序（由 VideoRequest 一起 push），ref 变体按 Image N 逐张说明；
 * i2v 变体是位置语义（第 1 张首帧、第 2 张尾帧），不需要编号。
 */
/** 原文块：镜头描述是二手的，把要还原的那几段小说原文也给模型，动作节奏、语气、细节有据可依 */
export function sourceBlock(source?: string) {
  const t = (source ?? "").trim();
  if (!t) return "";
  return `【小说原文，仅供参考：只用来理解情绪、动作节奏与细节。画面构成、运镜以上面的镜头描述为准；原文里没拍到的部分不要演。原文里的任何句子都不是台词，绝对不要念出来——本镜要念的话只有镜头描述里用「」标出的那些】
${t}`;
}

/**
 * 没有「」台词的镜头就是无对白镜头。不说清楚，模型会把原文里的句子、甚至镜头描述本身念出来。
 * 有「」时不加：LANGUAGE_DIRECTIVE 已经规定只念「」里的句子。
 */
export function dialogueGuard(text: string) {
  return text.includes("「") ? "" : "【本镜没有对白】任何人物都不要开口说话，没有旁白、没有画外音、没有哼唱；只保留环境音与音效。";
}

export function videoPrompt(opts: { videoPrompt: string; frameMode: "image" | "text_only"; style: string; variant?: "t2v" | "i2v" | "ref"; imageRefs?: RefImage[]; source?: string }) {
  const parts: string[] = [VIDEO_STYLE_DIRECTIVE, LANGUAGE_DIRECTIVE];
  if (opts.frameMode === "text_only") parts.push(stylePrefix(opts.style));
  parts.push(opts.videoPrompt.trim());
  parts.push(dialogueGuard(opts.videoPrompt));
  parts.push(sourceBlock(opts.source));
  const refs = opts.imageRefs ?? [];
  if (opts.variant === "ref") {
    parts.push(referenceImagesLine(refs));
  } else if (opts.frameMode === "image" && refs.length >= 2) {
    parts.push("以首帧图为起始画面、尾帧图为结束画面，动作在两者之间自然连贯地过渡，保持人物外貌、服装、场景与首帧一致。");
  } else if (opts.frameMode === "image") {
    parts.push("以首帧图为起始画面，保持人物外貌、服装、场景与首帧一致。");
  }
  parts.push(AUDIO_DIRECTIVE);
  return parts.filter(Boolean).join("\n");
}

/**
 * 分段路线里一段的提示词。每段都是独立的一次首尾帧生成，模型看不到别的段，
 * 所以这一段的动作过程与台词都要在这里写全；没写段提示词就退回镜头的视频提示词。
 */
export function segmentVideoPrompt(opts: { text: string; index: number; total: number; start: number; end: number; hasEnd: boolean; source?: string }) {
  const parts: string[] = [VIDEO_STYLE_DIRECTIVE, LANGUAGE_DIRECTIVE];
  parts.push(`【本段为镜头的第 ${opts.index + 1}/${opts.total} 段，对应镜头第 ${opts.start}–${opts.end} 秒】`);
  parts.push(opts.text.trim());
  parts.push(dialogueGuard(opts.text));
  parts.push(sourceBlock(opts.source));
  parts.push(
    opts.hasEnd
      ? "以首帧图为起始画面、尾帧图为结束画面，动作在两者之间自然连贯地过渡，保持人物外貌、服装、场景与首帧一致。"
      : "以首帧图为起始画面，保持人物外貌、服装、场景与首帧一致。",
  );
  parts.push(AUDIO_DIRECTIVE);
  return parts.filter(Boolean).join("\n");
}

/**
 * 分镜预演：把一章的镜头按顺序快速闪一遍，每镜不到一秒，给人从里面截首帧用。
 * 每个镜头是一个固定机位的构图，对焦在列出的人物上——它的价值是「人物长什么样、站在哪、什么景别」，
 * 不是表演，所以要求人物基本静止、镜头之间硬切。参考图只作外貌参考，用 referenceImagesLine 统一说法。
 */
export function previzPrompt(opts: { slots: Array<{ index: number; start: number; text: string }>; duration: number; slotSeconds: number; refs: RefImage[]; orientation?: string | null }) {
  const ar = opts.orientation === "16:9" ? "横屏 16:9" : "竖屏 9:16";
  const parts: string[] = [
    VIDEO_STYLE_DIRECTIVE,
    `这是一段分镜预演：把下面 ${opts.slots.length} 个镜头按顺序快速闪过，总长 ${opts.duration} 秒，每个镜头约 ${opts.slotSeconds.toFixed(2)} 秒。` +
      "镜头之间用硬切，不要任何转场特效、叠化、闪黑；不要字幕、不要文字、不要水印。" +
      "每个镜头都是一个固定机位的清晰构图，画面对焦在列出的人物身上，人物按描述摆好姿态后基本静止（只允许呼吸、眨眼这种微动），不要运镜、不要快速动作，避免动态模糊。" +
      "没有台词，不要配乐。" +
      ` ${ar}。`,
    referenceImagesLine(opts.refs),
    "镜头顺序与各自的起始时间：",
    ...opts.slots.map((sl) => `[镜头 ${sl.index} · ${sl.start.toFixed(1)}s] ${sl.text}`),
  ];
  return parts.filter(Boolean).join("\n");
}

export const SHOT_SIZES = ["大远景", "远景", "全景", "中景", "近景", "特写", "大特写"] as const;

/** 拆镜 Agent 的 system prompt */
export function storyboardSystemPrompt(orientation?: string | null) {
  const ar = orientation === "16:9" ? "横屏（16:9）" : "竖屏（9:16）";
  return `你是一名短剧导演兼分镜师。你会把小说原文拆成可以直接交给 AI 视频模型生成的${ar}分镜表。

硬性规则：
1. 分镜偏碎：一句台词一镜；对话双方切反打各成一镜；一个动作一镜，反应另起一镜。
2. **每镜时长由你自己判断**，唯一的硬性限制是必须落在用户给出的【时长区间】内、取整数秒。判断标准是「演员真这么演，需要多久」，把下面这些一起算进去：
   - 台词的实际念白速度：急切、慌张时快；悲伤、压迫、决绝时慢，同样字数可能差出一倍
   - 开口前的迟疑、句与句之间的换气、说完之后的沉默留白
   - 台词之外的动作：走位、转身、抬头、拔剑、递出手，这些都要占时间
   - 镜头运动本身：缓慢推近、摇、跟拍，比固定机位需要更长
   一组镜头内不要平均分配时长，该快的短、该沉的长，节奏才有起伏。
   **宁可给宽一点，不要卡得刚好。** 这是实测过的失败模式：语速被逼紧时，视频模型会吞字、改词，甚至把整句换成别的意思。
   如果一个镜头无论如何都装不下想表达的内容，就拆成两镜，而不是压缩时长。
3. 出场人物只能从给定人物表中选，并且必须为每个出场人物指定一个 persona_tag（只能用该人物已有的 tag）。根据原文的时间线与状态词（如"多年后""入魔"）选择 tag；无法判断时用列表中的第一个 tag，并把 needs_review 置为 true。
4. frame_mode：有人物面部、需要精确构图或服装细节的镜头用 "image"（先出首帧）；空镜、环境、转场、纯运镜、远景用 "text_only"（直接文生视频）。
5. frame_prompt（给图像模型）按固定顺序写：场景与光线天气 → 人物（外貌关键词取自 persona 描述、姿态、表情、位置）→ 景别与机位 → ${ar} 构图要求。不要写画风（系统会自动加）。text_only 镜头 frame_prompt 留空字符串。
6. video_prompt（给视频模型）写：镜头描述与运镜 → 人物动作 → 台词（标明说话人与语气，台词原文用「」包住）→ 情绪 → 环境音。text_only 镜头必须额外写全场景、光线、人物外貌关键词，因为没有首帧兜底。
   sound 与 video_prompt 里要写足真实的环境音与音效（风、雪、脚步、衣料、器物、远处钟声等），但绝不要写背景音乐、配乐、旋律、笛声琴声等乐器演奏——配乐由后期用音乐库统一配，模型输出的音乐会和它打架。
7. **先分组，再拆镜。** 把原文切成若干「分镜组」（unit）：每组是一个完整的小情节（一次交锋、一次靠近、一次揭示），给一句摘要和覆盖的段落区间（段落编号从 0 开始）。
   每组包含 2–4 个镜头。同一组的镜头必须共享同一场景、同一时间段、同一光线，是连续的时间推进；一旦换场景、跳时间、或情绪转折，就必须开新的一组。
   分组决定了配乐的连续段落，也是审片时的最小单位。每个镜头写 unit_index 归属哪一组。
8. 道具：如果给了道具库，为每个镜头列出画面里出现的关键道具（写 props 数组，元素是道具名，只能用库里有的；没有就写 []）。道具概念图会作为参考图一起送给绘图模型。
9. BGM：如果给了音乐库，为每个镜头选一首（写曲名到 "bgm"），按情绪匹配；同一情绪段落里相邻镜头必须沿用同一首（导出时会连续播放），情绪转折处再换曲；不需要音乐的镜头写 null。音乐库为空时一律 null。
10. 输出必须是严格 JSON，不要任何解释文字。

输出 JSON 结构：
{
  "units": [{ "index": 1, "summary": "这一组的小情节", "para_start": 0, "para_end": 1 }],
  "shots": [{
    "unit_index": 1,
    "scene": "地点 · 时间 · 天气",
    "shot_size": "大远景|远景|全景|中景|近景|特写|大特写",
    "camera": "运镜描述",
    "duration": 5,
    "characters": [{ "name": "人物名", "persona_tag": "tag" }],
    "props": ["道具名"],
    "dialogue": [{ "name": "人物名", "line": "台词", "tone": "语气" }],
    "emotion": "情绪基调",
    "action": "动作与走位",
    "sound": "环境音/音效",
    "frame_mode": "image|text_only",
    "frame_prompt": "……",
    "video_prompt": "……",
    "bgm": "曲名或 null",
    "needs_review": false
  }]
}`;
}

export function propLibraryText(props: Array<{ name: string; description: string }>) {
  if (!props.length) return "（空，所有镜头 props 写 []）";
  return props.map((p) => `- 「${p.name}」${p.description ? `：${p.description}` : ""}`).join("\n");
}

export function bgmLibraryText(tracks: Array<{ name: string; mood: string; description: string }>) {
  if (!tracks.length) return "（空，所有镜头 bgm 写 null）";
  return tracks.map((t) => `- 「${t.name}」 情绪：${t.mood || "未标注"}${t.description ? `；${t.description}` : ""}`).join("\n");
}

export function durationHint(min: number, max: number) {
  return `每镜 ${min}–${max} 秒整数，这是视频引擎的硬限制，超出就没法生成。区间内的具体时长由你按表演节奏自己定，不用平均分配。`;
}

export function storyboardUserPrompt(opts: {
  world: string;
  style: string;
  characters: Array<{ name: string; age: string; role: string; personality: string; personas: Array<{ tag: string; description: string }>; hasVoice: boolean }>;
  paragraphs: string[];
  /** 分段拆镜时，本段第一句在全篇里的段落编号 */
  paragraphOffset?: number;
  instruction?: string;
  props?: Array<{ name: string; description: string }>;
  bgmTracks?: Array<{ name: string; mood: string; description: string }>;
  duration?: { min: number; max: number };
}) {
  const chars = opts.characters
    .map((c) => {
      const tags = c.personas.map((p) => `    - tag「${p.tag}」：${p.description || "（无描述）"}`).join("\n");
      return `- ${c.name}（${c.age}；${c.role}）性格：${c.personality}\n  可用 persona_tag：\n${tags || "    - （无人设，请勿让此人出场）"}`;
    })
    .join("\n");
  const off = opts.paragraphOffset ?? 0;
  const paras = opts.paragraphs.map((p, i) => `[${i + off}] ${p}`).join("\n");
  return [
    `【时长区间】\n${durationHint(opts.duration?.min ?? 4, opts.duration?.max ?? 15)}`,
    `【世界观】\n${opts.world || "（未填写）"}`,
    `【画风】\n${opts.style || "（未填写）"}`,
    `【人物表】\n${chars || "（无人物）"}`,
    `【道具库】\n${propLibraryText(opts.props ?? [])}`,
    `【音乐库】\n${bgmLibraryText(opts.bgmTracks ?? [])}`,
    `【原文，按段落编号】\n${paras}`,
    opts.instruction ? `【额外要求】\n${opts.instruction}` : "",
    "请输出分镜表 JSON。",
  ]
    .filter(Boolean)
    .join("\n\n");
}


/** 逐镜改写：只输出一个镜头对象 */
export function shotRewriteSystemPrompt() {
  return `你是一名短剧导演兼分镜师。用户会给你一整章的分镜表上下文和其中一个待改写的镜头，以及改写要求。
你只改写这一个镜头，输出一个镜头 JSON 对象（不是数组，不带 units），字段与结构必须与给定镜头完全一致：
{ "unit_index", "scene", "shot_size", "camera", "duration", "characters":[{"name","persona_tag"}], "props":["道具名"], "dialogue":[{"name","line","tone"}], "emotion", "action", "sound", "frame_mode", "frame_prompt", "video_prompt", "bgm", "needs_review" }
规则：单镜时长必须落在用户给出的【时长区间】内，具体多长由你按表演节奏判断（念白快慢、停顿换气、动作与运镜占的时间），宁可宽松不要卡紧——语速被逼紧时视频模型会吞字改词；出场人物与 persona_tag 只能来自人物表；frame_prompt 不写画风；text_only 镜头 frame_prompt 为空字符串且 video_prompt 写全场景与外貌；没有明确要求改动的字段尽量保持原样。只输出 JSON。`;
}

export function shotRewriteUserPrompt(opts: {
  world: string;
  style: string;
  characters: Array<{ name: string; personas: Array<{ tag: string; description: string }> }>;
  context: string;
  target: string;
  instruction: string;
  props?: Array<{ name: string; description: string }>;
  bgmTracks?: Array<{ name: string; mood: string; description: string }>;
  duration?: { min: number; max: number };
}) {
  const chars = opts.characters
    .map((c) => `- ${c.name}：可用 persona_tag ${c.personas.map((p) => `「${p.tag}」（${p.description || "无描述"}）`).join("、")}`)
    .join("\n");
  return [
    `【时长区间】\n${durationHint(opts.duration?.min ?? 4, opts.duration?.max ?? 15)}`,
    `【时长区间】\n${durationHint(opts.duration?.min ?? 4, opts.duration?.max ?? 15)}`,
    `【世界观】\n${opts.world || "（未填写）"}`,
    `【画风】\n${opts.style || "（未填写）"}`,
    `【人物表】\n${chars || "（无人物）"}`,
    `【道具库】\n${propLibraryText(opts.props ?? [])}`,
    `【音乐库】\n${bgmLibraryText(opts.bgmTracks ?? [])}`,
    `【本章分镜上下文（镜号 · 景别 · 时长 · 动作 · 台词）】\n${opts.context}`,
    `【待改写镜头（当前 JSON）】\n${opts.target}`,
    `【改写要求】\n${opts.instruction}`,
    "请输出改写后的镜头 JSON 对象。",
  ].join("\n\n");
}

/* ====================================================================== *
 * 说书模式：拆页 / 选角
 * ====================================================================== */

import { EXPRESSIONS } from "@/lib/narrated";
export { EXPRESSIONS };

/** 拆页 Agent 的 system prompt。一页 = 画面不变的一段叙述 + 要念的话 */
export function pagesSystemPrompt(orientation?: string | null) {
  const ar = orientation === "16:9" ? "横屏（16:9）" : "竖屏（9:16）";
  return `你是一名有声漫画 / 图文说书的编导。你会把小说原文拆成「页」：每页一张${ar}静态画面，配上要念出来的旁白和台词。没有视频，画面不动，靠配音推进。

硬性规则：
1. **页的定义**：画面不变的一段叙述。换地点、换构图、换主要人物、时间跳跃，就换页。一段原文可能是 0 页（并入相邻页）、1 页或多页。
2. **每页配音 10–25 秒**：旁白 + 台词合计约 40–120 个汉字。短了并页，长了拆页。全文按这个粒度走，不要一句一页，也不要一整段一页。
3. **narration（旁白）**：把原文的叙述改写成适合朗读的口吻，以原文语句为主，只做朗读所需的最小润色。原文里「某某的内心独白：」这类标记不要念，内心独白直接用第一人称写进旁白。「系统提示音：」这类也当旁白念，保留原句。旁白里不要包含台词。
4. **lines（台词）**：逐字引用原文里人物说的话，不改词。每条给 name（只能用人物表里的名字）、tone（语气）、expression（表情，只能从 ${EXPRESSIONS.join(" / ")} 里选）。旁白与台词按原文顺序自然穿插——但输出里 narration 只有一段，所以请把这一页里台词之前的叙述放进 narration，台词之后还有叙述就另起一页。
5. **image_prompt（给图片模型）**按固定顺序写：场景与光线天气 → 人物（外貌关键词取自 persona 描述、姿态、表情、位置）→ 景别与机位 → ${ar} 构图要求。不要写画风（系统会加）。空镜也要写。
6. characters 只能从人物表选，并为每个出场人物指定 persona_tag（只能用该人物已有的 tag）；无法判断用第一个 tag 并把 needs_review 置为 true。
7. **先分组，再拆页。** 把原文切成若干「分镜组」（unit）：每组是一个完整的小情节，给一句摘要和覆盖的段落区间（段落编号从 0 开始）。每组 2–5 页。每页写 unit_index 归属哪一组。
8. 道具：如果给了道具库，为每页列出画面里出现的关键道具（props 数组，元素是道具名，只能用库里有的；没有写 []）。
9. BGM：如果给了音乐库，为每页选一首（bgm 写曲名），同一情绪段落里相邻页沿用同一首，转折处再换；不需要写 null。音乐库为空时一律 null。
10. 输出必须是严格 JSON，不要任何解释文字。

输出 JSON 结构：
{
  "units": [{ "index": 1, "summary": "这一组的小情节", "para_start": 0, "para_end": 1 }],
  "pages": [{
    "unit_index": 1,
    "scene": "地点 · 时间 · 天气",
    "characters": [{ "name": "人物名", "persona_tag": "tag" }],
    "props": ["道具名"],
    "narration": "要念的旁白",
    "lines": [{ "name": "人物名", "line": "台词原文", "tone": "语气", "expression": "微笑" }],
    "image_prompt": "给图片模型的画面描述",
    "bgm": "曲名或 null",
    "needs_review": false
  }]
}`;
}

export function pagesUserPrompt(opts: {
  world: string;
  style: string;
  characters: Array<{ name: string; age: string; role: string; personality: string; personas: Array<{ tag: string; description: string }> }>;
  paragraphs: string[];
  paragraphOffset?: number;
  instruction?: string;
  props?: Array<{ name: string; description: string }>;
  bgmTracks?: Array<{ name: string; mood: string; description: string }>;
}) {
  const chars = opts.characters
    .map((c) => {
      const tags = c.personas.map((p) => `    - tag「${p.tag}」：${p.description || "（无描述）"}`).join("\n");
      return `- ${c.name}（${c.age}；${c.role}）性格：${c.personality}\n  可用 persona_tag：\n${tags || "    - （无人设，请勿让此人出场）"}`;
    })
    .join("\n");
  const off = opts.paragraphOffset ?? 0;
  const paras = opts.paragraphs.map((p, i) => `[${i + off}] ${p}`).join("\n");
  return [
    `【世界观】\n${opts.world || "（未填写）"}`,
    `【画风】\n${opts.style || "（未填写）"}`,
    `【人物表】\n${chars || "（无人物）"}`,
    `【道具库】\n${propLibraryText(opts.props ?? [])}`,
    `【音乐库】\n${bgmLibraryText(opts.bgmTracks ?? [])}`,
    `【原文，按段落编号】\n${paras}`,
    opts.instruction ? `【额外要求】\n${opts.instruction}` : "",
    "请输出拆页 JSON。",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** 选角 Agent：给每个角色从音色库里挑 3 个候选 */
export function castingSystemPrompt() {
  return `你是一名有声剧的选角导演。给你一组角色（含旁白）和一份音色库，请为每个角色挑出 3 个最合适的音色候选，按合适程度排序。
考虑：性别、年龄段、气质（少年感 / 成熟 / 沉稳 / 活泼 / 冷淡）、音色描述里的关键词，以及角色的性格与说话风格。旁白要清晰、不抢戏、耐听。
同一个音色可以给多个角色当候选，但同一角色的 3 个候选不要重复。voice_id 必须原样来自音色库。
输出必须是严格 JSON：{ "casts": [{ "role": "角色 key", "candidates": [{ "voice_id": "…", "reason": "一句话理由" }] }] }`;
}

export function castingUserPrompt(opts: {
  roles: Array<{ key: string; name: string; description: string; sampleLine: string }>;
  voices: Array<{ voiceId: string; name: string; description: string[] }>;
}) {
  const roles = opts.roles.map((r) => `- key「${r.key}」 ${r.name}：${r.description || "（无描述）"}\n  代表句：「${r.sampleLine}」`).join("\n");
  const voices = opts.voices.map((v) => `- ${v.voiceId} ｜ ${v.name}${v.description.length ? ` ｜ ${v.description.join("，")}` : ""}`).join("\n");
  return `【角色】\n${roles}\n\n【音色库】\n${voices}\n\n请输出选角 JSON。`;
}
