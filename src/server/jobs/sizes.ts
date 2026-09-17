/**
 * 出图尺寸。
 *
 * gpt-image-2 接受任意尺寸，不像 gpt-image-1 只有三档，所以统一按 2K 出。
 * 首帧按画幅取向：竖屏 1440x2560、横屏 2560x1440（fal 的原生 2K 档位），
 * 长边到 2K，留足细节给视频模型，同时宽高都是 16 的倍数。
 *
 * 画幅以前写死在这里和另外三处，改一次画幅要翻四个文件；现在统一由
 * Project.orientation 驱动，那个字段本来就有、界面上也能选，只是从没接上。
 */
/** 人物三视图：三视各约 1024x2048 */
export const SHEET_SIZE = process.env.SHEET_SIZE || "3072x2048";
export const PROP_SIZE = process.env.PROP_SIZE || "2048x2048";
/** 场景概念图：横向并排两个互为反打的视角，各约 1536x1536 */
export const SCENE_SIZE = process.env.SCENE_SIZE || "3072x1536";
export type Orientation = "9:16" | "16:9";

/**
 * 首帧尺寸。传入项目的画幅取向。
 *
 * FRAME_SIZE 环境变量优先级高于画幅设置，是临时试验用的后门。
 * 踩过一次：.env 里留着一行写死的竖屏值，把整套画幅逻辑无声地顶掉了，
 * 70 张横屏首帧全出成了竖屏才发现。所以这里把覆盖行为打进日志。
 */
export function frameSize(orientation?: string | null) {
  const override = process.env.FRAME_SIZE?.trim();
  if (override) {
    console.warn(`[sizes] FRAME_SIZE=${override} 覆盖了画幅设置（${orientation ?? "未设"}），如非本意请清掉这个环境变量`);
    return override;
  }
  return orientation === "16:9" ? "2560x1440" : "1440x2560";
}

/** 成片像素。导出与视频模型的宽高比都从这里取 */
export function outputSize(orientation?: string | null) {
  return orientation === "16:9" ? { w: 1920, h: 1080 } : { w: 1080, h: 1920 };
}

/** 视频轮询节奏 */
export const VIDEO_POLL_MS = 10_000;
export const VIDEO_MAX_WAIT_MS = 90 * 60 * 1000;
