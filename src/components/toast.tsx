"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * 轻提示 + 全局忙碌条。
 * 以前 server action 出错是 alert()，成功没有任何反馈；现在右下角浮一条，两三秒自己走。
 * 任何 useAct 在跑的时候，页面顶上有一条 2px 的朱砂走带，告诉人「点下去了、在等」。
 */

export type ToastKind = "ok" | "err" | "info";
type Toast = { id: number; kind: ToastKind; text: string; leaving?: boolean };
type Ctx = { push: (kind: ToastKind, text: string, ms?: number) => void; busy: (delta: number) => void };

const ToastCtx = createContext<Ctx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const [busyN, setBusyN] = useState(0);

  const push = useCallback((kind: ToastKind, text: string, ms?: number) => {
    const id = Date.now() + Math.random();
    setItems((l) => [...l, { id, kind, text }].slice(-4));
    const ttl = ms ?? (kind === "err" ? 6500 : 2600);
    setTimeout(() => setItems((l) => l.map((t) => (t.id === id ? { ...t, leaving: true } : t))), ttl);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), ttl + 240);
  }, []);
  const busy = useCallback((delta: number) => setBusyN((n) => Math.max(0, n + delta)), []);
  const value = useMemo(() => ({ push, busy }), [push, busy]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className={busyN > 0 ? "busy-bar on" : "busy-bar"} aria-hidden />
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}${t.leaving ? " leaving" : ""}`} onClick={() => setItems((l) => l.filter((x) => x.id !== t.id))}>
            <span className="toast-dot" />
            <span className="whitespace-pre-wrap break-words">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** 没套 Provider 时退回 alert，不至于静默吞掉错误 */
export function useToast(): Ctx {
  const c = useContext(ToastCtx);
  return (
    c ?? {
      push: (kind, text) => {
        if (kind === "err") alert(text);
      },
      busy: () => {},
    }
  );
}
