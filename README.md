# 场记 · AI 短剧生产工作台

把一章小说变成一集有声动画短剧的单人工作台：拆镜 → 资产 → 预演截帧 → 出片 → 字幕对齐 → 导出。
Next.js 15 + Prisma/SQLite，单进程带任务队列，一台机器就能跑。

> 名字来自片场的「场记」：记板、对镜号、管连戏。这个工具干的也是这些事。

## 流程

```
小说原文 ──拆镜 Agent──▶ 分镜表（分镜组 / 镜头 / 台词 / 时长）
                              │
资产库（人设三视图 · 场景图 · 道具图 · 画风参考）──▶ 预演：全能参考把整章镜头闪一遍（每镜 <1s）
                              │                          │
                              │                 人工拖进度条截首帧（也可 gpt-image 画 / 上传）
                              │                          │
                              └──────────▶ 出片：首帧 / 首尾帧 / 分段拼接（关键帧）
                                                         │
                                            字幕对齐（Whisper 字级时间戳）──▶ 导出成片（字幕 · BGM · 片尾）
```

几条实际踩出来的原则，代码注释里都有出处：

- **以视频为中心**：首帧从视频模型自己的预演里截，而不是让图片模型画——图是图、视频是视频，两边的画风和人物对不上
- **风格写死为动漫 3D**：赛璐璐在视频模型里会在 2D / 3D 之间横跳
- **只有尾帧时首尾帧钉死；有中间关键帧时分段拼接**：每一段都是首尾帧钉死的短片，比"全能参考按时间点"稳
- **输入指纹判过期**：每个产物记录生成时全部输入的哈希，改了上游不用传播，重算一遍就知道谁旧了
- **每一次生成都是版本**：能回看、能切回、能弃

## 运行

```bash
npm install
cp .env.example .env      # 填 FAL_KEY（图 + 视频）或中转站密钥，见文件内注释
npx prisma db push
npm run dev               # http://localhost:3000
```

需要系统里有 `ffmpeg` / `ffprobe`（带 libass，烧字幕用）。数据库与生成文件默认放在项目目录外（`.env` 里的 `DATABASE_URL` / `STORAGE_DIR`），否则开发模式下会被文件监听当成源码变更。

**改了 `src/server/jobs/`、`ffmpeg.ts`、`prompts.ts` 要重启 dev server**：任务处理器在导入时注册，热更新不会重新注册。

## 供应商

| 用途 | 默认 | 备选 |
|---|---|---|
| 首帧 / 三视图 / 场景 / 道具图 | fal `openai/gpt-image-2.5/flare` | 中转站 gpt-image-2 |
| 视频（首帧 / 首尾帧 / 分段） | fal `minimax/h3-max-turbo` | 中转站 H3 三变体 |
| 预演（全能参考） | fal `minimax/h3-max` | 中转站 `hailuo-h3-quannengcankao` |
| 字幕对齐 | fal `fal-ai/whisper` | — |
| 拆镜 / 改写 | OpenAI 兼容接口（gpt-5.6-sol） | DeepSeek |
| 音色 | MiniMax | — |

切换只改 `.env` 里的 `IMAGE_PROVIDER` / `VIDEO_PROVIDER`。

## 目录

```
src/app/                      页面（App Router）。分镜页在 projects/[id]/chapters/[cid]/
src/components/ui.tsx         设计系统组件
src/lib/                      前后端共用的纯函数与类型（keyframes.ts 是分段规则的唯一事实来源）
src/server/actions.ts         Server Actions（薄）
src/server/services/          业务逻辑：镜头、章节、预演、字幕、版本…
src/server/jobs/              进程内任务队列与各类生成任务（出图 / 出片 / 预演 / 导出）
src/server/providers/         fal / 中转站 / MiniMax 适配层
src/server/prompts.ts         所有提示词模板
src/server/lineage.ts         输入指纹与新鲜度
src/server/ffmpeg.ts          截帧、拼接、字幕、导出
prisma/schema.prisma          数据模型
docs/                         方案与架构说明
deploy/                       Docker + Caddy 部署
scripts/                      一次性运维脚本（带项目 id，按需改）
```

## 部署

见 [deploy/README.md](deploy/README.md)：Docker 单容器 + SQLite，Caddy 反代，公网必须设 `APP_PASSWORD`。
