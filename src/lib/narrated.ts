/** 说书模式的节奏常量：条与条之间的停顿、页首留白、页尾留白（秒）。前后端共用 */
export const PAGE_GAP = 0.45;
export const PAGE_LEAD = 0.5;
export const PAGE_TAIL = 0.8;

export const PRESENT_STYLES = [
  { id: "subtitle", label: "字幕式", note: "全屏页图 + 底部字幕，旁白与台词样式区分" },
  { id: "galgame", label: "对话框式（galgame）", note: "对话框 + 名牌 + 立绘，逐字打出。第二期" },
] as const;

/** MiniMax speech-2.8 的情绪档 */
export const TTS_EMOTIONS = ["", "happy", "sad", "angry", "fearful", "disgusted", "surprised", "calm", "fluent", "whisper"] as const;
export const EMOTION_LABEL: Record<string, string> = { "": "自动", happy: "开心", sad: "难过", angry: "生气", fearful: "害怕", disgusted: "厌恶", surprised: "惊讶", calm: "平静", fluent: "流畅", whisper: "耳语" };

/** 说书台词的表情档（galgame 立绘用），拆页 prompt 与编辑器共用 */
export const EXPRESSIONS = ["平静", "微笑", "惊讶", "难过", "生气", "害羞", "哭", "疑惑"] as const;
