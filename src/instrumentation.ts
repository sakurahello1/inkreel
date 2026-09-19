export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Node 的 fetch 不认 HTTP(S)_PROXY 环境变量；机器上开着本地代理时（curl 能走、Node 走不了）
    // fal 的 CDN 下载会直连超时。有代理变量就把全局 dispatcher 换成走代理的，NO_PROXY 照常生效。
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
    if (proxy) {
      const { setGlobalDispatcher, EnvHttpProxyAgent } = await import("undici");
      setGlobalDispatcher(new EnvHttpProxyAgent());
      console.log(`[net] fetch 走代理 ${proxy}`);
    }
    const { startJobs } = await import("./server/jobs");
    startJobs();
  }
}
