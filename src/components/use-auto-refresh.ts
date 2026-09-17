"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** 有任务在跑时定时 router.refresh()，让服务端组件把最新状态带下来。 */
export function useAutoRefresh(active: boolean, ms = 5000) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [active, ms, router]);
}
