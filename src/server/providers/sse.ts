import http from "node:http";
import https from "node:https";

/**
 * 直接用 Node 原生 http/https 发 POST 并解析 SSE。
 *
 * 不用 fetch 的两个原因：
 * 1. Next.js 会包装全局 fetch 做缓存，在后台任务（非请求上下文）里对流式响应的处理不可靠，
 *    实测同一段代码在独立进程里正常，在 Next 里拿到空正文。
 * 2. Node fetch 底层 undici 有 5 分钟 headers timeout（UND_ERR_HEADERS_TIMEOUT），
 *    AbortSignal 覆盖不到；这里用 socket 空闲超时自己控制。
 */
export interface SsePostResult {
  status: number;
  /** 非 2xx 时的原始响应体 */
  raw: string;
}

export function postSse(opts: {
  url: string;
  headers: Record<string, string>;
  body: string;
  /** 每收到一条 data: 行调用一次，payload 已去掉前缀，[DONE] 不会传入 */
  onData: (payload: string) => void;
  /** 两次数据之间的最大间隔，超过即判定卡死 */
  idleTimeoutMs?: number;
}): Promise<SsePostResult> {
  const u = new URL(opts.url);
  const mod = u.protocol === "http:" ? http : https;
  const idle = opts.idleTimeoutMs ?? 5 * 60 * 1000;

  return new Promise((resolve, reject) => {
    const req = mod.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === "http:" ? 80 : 443),
        path: u.pathname + u.search,
        method: "POST",
        headers: { ...opts.headers, "content-length": Buffer.byteLength(opts.body).toString() },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        res.setEncoding("utf8");

        if (status < 200 || status >= 300) {
          let raw = "";
          res.on("data", (c: string) => {
            if (raw.length < 4000) raw += c;
          });
          res.on("end", () => resolve({ status, raw }));
          return;
        }

        let buf = "";
        res.on("data", (chunk: string) => {
          req.setTimeout(idle);
          buf += chunk;
          // SSE 事件以空行分隔；兼容 \n\n 与 \r\n\r\n
          let m: RegExpExecArray | null;
          const sep = /\r?\n\r?\n/;
          while ((m = sep.exec(buf))) {
            const event = buf.slice(0, m.index);
            buf = buf.slice(m.index + m[0].length);
            for (const line of event.split(/\r?\n/)) {
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              opts.onData(payload);
            }
          }
        });
        res.on("end", () => {
          // 末尾可能还剩一条没有空行收尾的事件
          for (const line of buf.split(/\r?\n/)) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            opts.onData(payload);
          }
          resolve({ status, raw: "" });
        });
        res.on("error", reject);
      },
    );

    req.setTimeout(idle, () => {
      req.destroy(new Error(`SSE 连接空闲超过 ${Math.round(idle / 1000)} 秒，判定卡死`));
    });
    req.on("error", reject);
    req.write(opts.body);
    req.end();
  });
}
