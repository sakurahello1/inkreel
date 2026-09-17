import type { Metadata } from "next";
import Link from "next/link";
import { IBM_Plex_Mono, Noto_Sans_SC, Noto_Serif_SC } from "next/font/google";
import "./globals.css";
import { monthlySpend } from "@/server/queries";

const serif = Noto_Serif_SC({
  weight: ["600", "900"],
  variable: "--font-serif-sc",
  preload: false,
  display: "swap",
});

const sans = Noto_Sans_SC({
  weight: ["400", "500"],
  variable: "--font-sans-sc",
  preload: false,
  display: "swap",
});

const mono = IBM_Plex_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-mono-en",
  display: "swap",
});

export const metadata: Metadata = {
  title: "场记 · 短剧工作台",
  description: "AI 短剧生产工作台",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const spend = await monthlySpend().catch(() => ({ total: 0, by: {} as Record<string, number> }));
  const keys = { openai: Boolean(process.env.CHAT_API_KEY && process.env.IMAGE_API_KEY), video: Boolean(process.env.VIDEO_API_KEY), minimax: Boolean(process.env.MINIMAX_API_KEY) };
  return (
    // suppressHydrationWarning：沉浸式翻译等浏览器插件会在 React 接管前往 <html> 注入属性，
    // 这类差异无害且无法避免，不抑制会每次都报 hydration 不匹配。
    <html lang="zh-CN" className={`${serif.variable} ${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        <header className="shrink-0 border-b border-line-strong bg-paper">
          <div className="mx-auto flex h-12 max-w-[1500px] items-center justify-between px-6">
            <div className="flex items-center gap-8">
              <Link href="/" className="flex items-baseline gap-2">
                <span className="font-serif text-[20px] font-black leading-none tracking-[0.2em]">场记</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-2">Short Drama Studio</span>
              </Link>
              <nav className="flex items-center gap-5 text-[13px]">
                <Link href="/" className="text-ink hover:text-cinnabar">
                  项目
                </Link>
                <Link href="/assets" className="text-ink-2 hover:text-cinnabar">
                  资产库
                </Link>
                <Link href="/settings" className="text-ink-2 hover:text-cinnabar">
                  设置
                </Link>
              </nav>
            </div>
            <div className="flex items-center gap-5 font-mono text-[11px] text-ink-2">
              <span title="gpt-5.6-sol / gpt-image-2">
                <span className="text-ink-3">OPENAI</span> <span className={keys.openai ? "text-moss" : "text-cinnabar"}>●</span>
              </span>
              <span title="H3 视频中转">
                <span className="text-ink-3">VIDEO</span> <span className={keys.video ? "text-moss" : "text-cinnabar"}>●</span>
              </span>
              <span title="音色库">
                <span className="text-ink-3">MINIMAX</span> <span className={keys.minimax ? "text-moss" : "text-cinnabar"}>●</span>
              </span>
              <span className="border-l border-line pl-5" title={Object.entries(spend.by).map(([k, v]) => `${k} $${v.toFixed(2)}`).join(" · ") || "本月尚无花费"}>
                <span className="text-ink-3">本月用量</span> <span className="text-ink">$ {spend.total.toFixed(2)}</span>
              </span>
            </div>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
