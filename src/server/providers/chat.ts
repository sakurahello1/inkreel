import { postSse } from "./sse";
/**
 * OpenAI 兼容的 chat completions 封装。
 * 默认走 CHAT_*（中转站 gpt-5.6-sol），也可指定 deepseek。
 */

export type ChatProviderName = "chat" | "deepseek";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  text: string;
  model: string;
  finishReason: string;
  usage: { prompt: number; completion: number; total: number };
}

function config(name: ChatProviderName) {
  if (name === "deepseek") {
    return {
      baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      apiKey: process.env.DEEPSEEK_API_KEY || "",
      model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    };
  }
  return {
    baseUrl: process.env.CHAT_BASE_URL || "",
    apiKey: process.env.CHAT_API_KEY || "",
    model: process.env.CHAT_MODEL || "gpt-5.6-sol",
  };
}

export function defaultChatProvider(): ChatProviderName {
  return (process.env.STORYBOARD_PROVIDER as ChatProviderName) || "chat";
}

export async function chat(
  messages: ChatMessage[],
  opts: { provider?: ChatProviderName; json?: boolean; maxTokens?: number; temperature?: number; model?: string; timeoutMs?: number; stream?: boolean } = {},
): Promise<ChatResult> {
  const name = opts.provider ?? defaultChatProvider();
  const cfg = config(name);
  if (!cfg.apiKey) throw new Error(`缺少 ${name} 的 API Key`);
  const model = opts.model ?? cfg.model;

  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: opts.maxTokens ?? 16000,
  };
  // 默认走流式：长文本生成时模型可能思考数分钟才出第一个字节，
  // 而 Node fetch 底层 undici 有 5 分钟的 headers timeout（UND_ERR_HEADERS_TIMEOUT），
  // AbortSignal 管不到它。流式下响应头立刻返回，彻底绕开这个限制。
  const stream = opts.stream ?? true;
  if (stream) body.stream = true;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.json) body.response_format = { type: "json_object" };
  // DeepSeek v4 默认开思考，结构化输出任务里推理会吃光 token 预算，关掉后 20 秒出结果
  if (name === "deepseek" && (process.env.DEEPSEEK_THINKING || "off") === "off") body.thinking = { type: "disabled" };

  const url = `${cfg.baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
  const headers = { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json", Accept: stream ? "text/event-stream" : "application/json" };
  const payload = JSON.stringify(body);

  let text = "";
  let finishReason = "";
  let outModel = model;
  let u: Record<string, number> = {};

  // 中转站偶发连接层抖动，重试三次再放弃
  let lastErr: unknown;
  let done = false;
  for (let attempt = 0; attempt < 3 && !done; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt));
    text = "";
    finishReason = "";
    u = {};
    try {
      const res = await postSse({
        url,
        headers,
        body: payload,
        idleTimeoutMs: opts.timeoutMs ?? 10 * 60 * 1000,
        onData: (p) => {
          try {
            const j = JSON.parse(p);
            const c = j.choices?.[0];
            // 流式给 delta，非流式（部分中转站忽略 stream）给 message
            const piece = c?.delta?.content ?? c?.message?.content;
            if (piece) text += piece;
            if (c?.finish_reason) finishReason = String(c.finish_reason);
            if (j.model) outModel = j.model;
            if (j.usage) u = j.usage;
          } catch {
            /* 半截 JSON，忽略 */
          }
        },
      });
      if (res.status < 200 || res.status >= 300) {
        lastErr = new Error(`chat ${model} ${res.status}: ${res.raw.slice(0, 400)}`);
        if (res.status < 500) throw lastErr;
        continue;
      }
      // 空正文也当作失败重试：中转站偶尔会返回一条没有 delta 的空流
      if (!text.trim()) {
        lastErr = new Error(`chat ${model}: 返回空正文（finish=${finishReason || "?"}）`);
        console.warn(`[chat] attempt ${attempt + 1} empty body`);
        continue;
      }
      done = true;
    } catch (e) {
      lastErr = e;
      console.warn(`[chat] attempt ${attempt + 1} failed:`, e instanceof Error ? e.message : String(e));
    }
  }
  if (!done) throw lastErr instanceof Error ? lastErr : new Error(`chat ${model} 连接失败：${String(lastErr)}`);

  if (finishReason === "length" && text.trim().length === 0) throw new Error(`chat ${model}: 输出被 max_tokens 截断且正文为空（推理占满预算）`);
  if (!text.trim()) throw new Error(`chat ${model}: 返回空正文（finish=${finishReason || "?"}）`);
  return {
    text,
    model: outModel,
    finishReason,
    usage: { prompt: u.prompt_tokens ?? 0, completion: u.completion_tokens ?? 0, total: u.total_tokens ?? 0 },
  };
}

/**
 * 从模型输出里剥出 JSON。
 * 模型经常在正文前后夹带东西：``` 围栏、解释性文字，甚至先吐一个「我要开始了」的前言 JSON 对象
 * 再接真正的结果。所以这里扫描出所有括号配平的顶层 JSON，逐个尝试解析，
 * 再用 pick 挑出需要的那个（默认取字段最多的，通常就是正文）。
 */
export function extractJson<T = unknown>(text: string, pick?: (v: unknown) => boolean): T {
  const trimmed = text.trim();
  const tryParse = (x: string) => {
    try {
      return { ok: true as const, v: JSON.parse(x) as unknown };
    } catch {
      return { ok: false as const };
    }
  };

  const direct = tryParse(trimmed);
  if (direct.ok && (!pick || pick(direct.v))) return direct.v as T;

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const f = tryParse(fence[1].trim());
    if (f.ok && (!pick || pick(f.v))) return f.v as T;
  }

  // 扫描所有配平的 { } / [ ]，字符串内的括号不计
  const found: unknown[] = [];
  for (let i = 0; i < trimmed.length; i++) {
    const open = trimmed[i];
    if (open !== "{" && open !== "[") continue;
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < trimmed.length; j++) {
      const ch = trimmed[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          const r = tryParse(trimmed.slice(i, j + 1));
          if (r.ok) found.push(r.v);
          i = j; // 跳过整块，避免重复扫描嵌套
          break;
        }
      }
    }
  }

  const usable = pick ? found.filter(pick) : found;
  if (usable.length) {
    // 取「最大」的那个：键最多，通常就是正文而不是前言
    return usable.reduce((a, b) => (JSON.stringify(b).length > JSON.stringify(a).length ? b : a)) as T;
  }
  throw new Error("模型输出中找不到可用的 JSON");
}
