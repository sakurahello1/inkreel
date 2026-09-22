# 交接说明（给下一位接手的 agent / Codex）

> 这份文件只写**别处没有的东西**：现状、坑、约定、未完成事项。产品与流程看 [README.md](README.md)，分层与三个关键设计看 [docs/架构说明.md](docs/架构说明.md)，说书模式的原始方案看 [docs/方案-说书模式.md](docs/方案-说书模式.md)，部署看 [deploy/README.md](deploy/README.md)。

## 现状（2026-09-22）

- 最近三次提交：`c0315b0` 说书模式主链路 → `9bcf47c` galgame 对话框式 + 立绘 → `7071127` 前端动效 + vitest。远端 `sakurahello1/inkreel` 的 master 与本地一致，工作区干净。
- 两条产品线都能端到端跑通：
  - 短剧：分镜 → 预演截帧 / gpt-image 首帧 → Turbo 出片（首帧 / 首尾帧 / 分段）→ 对齐字幕 → 导出。第 1 章已出过成片。
  - 说书：拆页 → 出图 → 选角（人工确认闸门）→ MiniMax 配音 → ffmpeg 页视频（字幕式 / galgame 式）→ 导出。测试项目「【说书测试】同桌说」（`cmu8as73c0000v7g4vuy7pt75`，章 `cmu8as77q0011v7g4l2ws5gf5`）9 页全部按 galgame 渲染并导出过，可直接拿来回归。
- `npm test`（vitest，32 条）覆盖纯函数：`src/lib/cues.ts`、`src/lib/narrated.ts`、`src/lib/keyframes.ts`、`src/server/ffmpeg.ts` 的 ASS / galgame 逐字、`src/server/subtitles.ts` 对齐。`npx tsc --noEmit` 干净（`.next/types` 的报错是陈旧构建产物，过滤 `^src/` 即可）。

## 账户 / 环境状态（会挡住测试的）

| 项 | 状态 |
|---|---|
| gpt-5.6-sol 中转站（`CHAT_*`） | 2026-09-19 起 `INSUFFICIENT_BALANCE`。拆镜 / 拆页 / 选角请选 **deepseek**（界面下拉里有） |
| MiniMax（配音 / 选角试听） | 2026-09-20 起 `t2a: insufficient balance`。配音相关功能代码没问题，充值后再测 |
| fal（图 / 视频 / 抠图 / Whisper） | 正常 |
| 本机网络 | fal 的 CDN（`v3b.fal.media`）直连超时，必须走本地代理 `127.0.0.1:10808`。`.env` 里有 `HTTPS_PROXY`，`src/instrumentation.ts` 用 undici 接管全局 fetch；启动日志看到 `[net] fetch 走代理` 才生效。新加坡服务器不要配这个 |
| G 盘 | 2026-09-20 出过一次底层 I/O 错误（`lstat 'G:\'` 失败、SQLite disk I/O error），事后 `PRAGMA integrity_check` 正常、仓库 `git fsck` 正常。再遇到就先停 dev server 再查盘 |

## 说书 / galgame 的实现要点（README 没展开的）

- 页 = `Shot`（`frameMode` 固定 image，`narration` / `dialogue[].expression` / `framePrompt`），条 = `Utterance`；页视频存成 `shot.video`，所以时间线、导出、版本面板全部复用。
- 配音闸门在服务端：`NarratedService.castingStatus().ready` 为假时 `generateChapterVoices` 直接抛错，界面只是把按钮灰掉。
- 页视频渲染触发点有两个：配音条全部就绪（`utterance-tts.ts`）或图晚于配音到达（`shot-frame.ts` 的 `afterSuccess`），都走 `maybeRenderPage()`。
- galgame：`buildGalgameAss()` 用 ASS 卡拉 OK `{\kN}` + 全透明 SecondaryColour 做逐字打出，对话框 / 名牌是 `\p1` 矢量矩形；立绘用 ffmpeg `overlay ... enable=between(t,a,b)` 硬切，说话人按首次开口左右交替。页 `subtitleBurned=true` 时导出跳过该段字幕。
- 立绘（`Sprite` 表，人设 × 表情）：gpt-image 出图后**一律**走 `fal-ai/birefnet/v2` 抠图再 sharp trim。gpt-image 的 `background: transparent` 会画一圈聚光灯底，不可信，已放弃。
- MiniMax 的句级时间戳有时整段当一句返回，`src/lib/cues.ts` 的 `splitCue` 按句号再按逗号切到 ≤ 24 字。
- 页时长：拆页时按 4.2 字/秒估（`estimatePageSeconds`），渲染后按真实音频长度回写。改了展示方式、立绘、缓推幅度都要重新「渲染页」（`pageRenderHash` 含这些）。

## 前端约定（`7071127` 引入）

- 所有 server action 走 `useAct()`：出错自动红色 toast，`act(fn, { ok: "文案" })` 成功绿 toast；`toast.push(kind, text, ms)` 可直接用。**不要再写 `alert()`**。忙碌条由 `useAct` 自动管理（`ToastProvider` 在根 layout）。
- 动效类都在 `globals.css` 尾部：`anim-in` / `anim-fade` / `anim-pop` / `stagger`（子元素写 `style={{"--i": n}}`）/ `press` / `lift` / `skeleton` / `grow-x`。`Button` 已自带 `press`。页面切换的进场在 `src/app/template.tsx`。
- `TabNav` 在 `src/components/tab-nav.tsx`（client），`ui.tsx` 只是转发。
- 分镜台快捷键在 `storyboard.tsx`：↑↓ / j k 换镜，x 勾选，Esc 关抽屉；输入框内不抢键。行元素 id 为 `shot-<id>`，用于滚进视野。

## 工具链上的坑

- **改了 `src/server/jobs/`、`ffmpeg.ts`、`prompts.ts`、`instrumentation.ts`、`providers/` 必须重启 dev server**，热更新不会重新注册任务处理器（README 也提了，这里再强调一次，因为很容易忘）。
- 如果是在 Claude 桌面端之类的 agent 环境里用 shell 传脚本：heredoc 里的 `\\` 会被折成 `\`，带转义序列的补丁脚本要先写成文件再执行。Codex 的沙箱未必有这个问题，但 `src/server/prompts.ts` 之前因此埋过一个假换行，改提示词时留意 `join("\n")` 之类的写法。
- 一次性运维脚本放 `scripts/`（带具体项目 id）。会话里用过的临时脚本（种子、状态查询、重置卡住的页）没有进仓库，需要的话思路都很简单：`@prisma/client` 直连，`NODE_PATH` 指到项目的 `node_modules`，`node --env-file=.env` 读 `DATABASE_URL`。
- 仓库根目录有几个本地素材（`*.mp4` / `*.wav` / `*.srt` / `storage.old` / `dev.log` / `testframe.txt`），未被 git 跟踪，删不删随意。

## 没做完 / 建议下一步

1. **配音充值后回归**：单条换情绪重配（界面上情绪下拉 → 重配）没测成；`generateUtterance` 和 `maybeRenderPage` 逻辑没变过，预期能通。
2. **galgame 细节**：立绘进出场是硬切，可以改成带 alpha 的淡入（`renderPageClip` 里每个立绘一路输入，`fade=...:alpha=1` + `setpts` 即可）；两人同框时只显示说话的人，另一人可考虑压暗留在画面上。
3. **拆页质量**：第 3 页被 Agent 标了「196 字偏长建议拆页」（`needsReview`），编辑器里有「拆成两页」。旁白里偶尔混入第一人称（「那时候的我」），是原文本身的叙述视角，要不要统一成第三人称是产品决定。
4. **人物库选人设**：拆页 Agent 只按人物名挑人设 tag，没有按剧情阶段选（例如「病重」vs「高中」），目前默认第一个。
5. **短剧线**：第 2–4 章还没出片；预演截帧流程文档在 README。
6. 首页 `site/` 的展示页没有说书模式的内容，可补一屏。
