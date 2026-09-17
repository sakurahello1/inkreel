"use client";

import { useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";

/** 包一层 server action：跑完自动 router.refresh()，并给出 pending 状态。 */
export function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const act = useCallback(
    (fn: () => Promise<unknown>) =>
      start(async () => {
        try {
          await fn();
        } catch (err) {
          alert(err instanceof Error ? err.message : String(err));
        }
        router.refresh();
      }),
    [router],
  );
  return { act, pending };
}
