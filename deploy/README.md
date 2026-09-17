# 部署到 Linux 服务器（新加坡）

单机部署：Docker 一个容器跑 Next.js（含进程内任务队列）+ SQLite，数据目录挂在宿主机 `./data`。
前面用 Caddy 做 HTTPS 反代（自动签证书）。

## 1. 服务器准备（Ubuntu 22.04 / 24.04）

```bash
sudo apt update && sudo apt install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # 重新登录生效
```

## 2. 拉代码、写环境变量

```bash
git clone <你的仓库> slate && cd slate
cp .env.example .env.production
```

编辑 `.env.production`，至少填：

| 变量 | 说明 |
|---|---|
| `CHAT_BASE_URL` / `CHAT_API_KEY` / `CHAT_MODEL` | 拆镜文本模型（中转站） |
| `DEEPSEEK_API_KEY` | 备选拆镜模型 |
| `IMAGE_BASE_URL` / `IMAGE_API_KEY` | gpt-image-2 |
| `VIDEO_BASE_URL` / `VIDEO_API_KEY` | 中转站视频（H3 三变体） |
| `MINIMAX_API_KEY` / `MINIMAX_BASE_URL` | 音色库（国内域名 api.minimaxi.com） |
| `APP_PASSWORD` | 访问口令，**公网必填** |
| `AUTH_SECRET` | 随机长字符串，签 cookie 用 |
| `PUBLIC_BASE_URL` | 对外访问地址，例如 `https://slate.example.com`（视频参考等需要公网 URL 的功能用） |

`DATABASE_URL` / `STORAGE_DIR` / `SUBTITLE_FONT` 由 docker-compose.yml 固定指向 `/data`，不用填。

## 3. 构建并启动

```bash
docker compose up -d --build
docker compose logs -f app
```

看到 `[jobs] runner started` 即正常。容器只监听 127.0.0.1:3000，必须经反代访问。

## 4. HTTPS 反代（Caddy）

```bash
sudo apt install -y caddy
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
slate.example.com {
    reverse_proxy 127.0.0.1:3000
    request_body {
        max_size 200MB
    }
}
EOF
sudo systemctl reload caddy
```

把域名 A 记录指到服务器 IP，Caddy 会自动申请证书。

## 5. 升级

```bash
git pull
docker compose up -d --build
```

启动命令里带了 `prisma db push`，新增字段会自动同步到 `/data/app.db`，不会丢数据。

## 6. 备份

整个 `./data` 目录（`app.db` + `storage/`）就是全部数据，定期打包即可：

```bash
tar czf slate-data-$(date +%F).tgz data
```

## 注意

- 视频任务通常 5–60 分钟；任务状态存在数据库里，容器重启后会自动续上轮询。
- 导出用容器内的 ffmpeg 与 Noto Sans CJK 字体，不需要额外安装。
- 单容器只能跑一个实例（进程内队列），别开多副本。

## 本机（Windows）构建的坑

开发机的 G: 盘是 exFAT，`next build` 会在 route 文件上报 `EISDIR: illegal operation on a directory, readlink`。
这是文件系统问题，不是代码问题：把项目放到 NTFS 盘（如 C:）再 build 即可（已验证通过），或者直接在 Linux 服务器 / Docker 里构建。
