import type { NextConfig } from "next";

// 注意：数据库与生成文件放在项目目录之外（见 .env 的 DATABASE_URL / STORAGE_DIR），
// 否则开发模式下任务队列的写入会被 Next 的文件监听当成源码变更，触发 Fast Refresh 并中断进行中的 server action。
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  serverExternalPackages: ["@prisma/client", "sharp", "undici"],
  experimental: {
    serverActions: {
      // Server Action 请求体默认只有 1MB，一张 2K 首帧 PNG 就 4–6MB，上传直接被拦。
      // 首帧、参考图、人设图、BGM 都走 server action 上传，放到 64MB 够用。
      bodySizeLimit: "64mb",
    },
  },
};

export default nextConfig;
