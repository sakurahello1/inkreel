"use client";

import { useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "./toast";

/**
 * 包一层 server action：跑完自动 router.refresh()，并给出 pending 状态。
 * 出错右下角浮红条；传 ok 文案则成功时浮绿条；跑的时候顶上亮忙碌条。
 */
export function useAct() {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const act = useCallback(
    (fn: () => Promise<unknown>, opts: { ok?: string } = {}) => {
      // 忙碌条要在 transition 外面点亮：transition 里的 setState 会被推迟到整个 action 跑完才渲染
      toast.busy(1);
      start(async () => {
        try {
          await fn();
          if (opts.ok) toast.push("ok", opts.ok);
        } catch (err) {
          toast.push("err", err instanceof Error ? err.message : String(err));
        } finally {
          toast.busy(-1);
          router.refresh();
        }
      });
    },
    [router, toast],
  );
  return { act, pending, toast };
}
