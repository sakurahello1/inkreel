"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import { Mono, cx } from "./ui";

/** 标签页导航：朱砂下划线在标签之间滑动，而不是每个标签自己亮灭 */
export function TabNav({ items, current }: { items: Array<{ href: string; label: string; count?: number }>; current: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);
  const activeHref = items.find((it) => current === it.href || current.startsWith(it.href + "/"))?.href ?? null;

  useLayoutEffect(() => {
    const el = wrap.current?.querySelector<HTMLElement>("[data-active='true']");
    setBar(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
  }, [activeHref, items.length]);

  return (
    <nav className="shrink-0 border-b border-line bg-panel">
      <div ref={wrap} className="relative mx-auto flex max-w-[1500px] gap-1 px-6">
        {items.map((it) => {
          const active = it.href === activeHref;
          return (
            <Link
              key={it.href}
              href={it.href}
              data-active={active ? "true" : "false"}
              className={cx("flex items-center gap-1.5 px-3 py-2.5 text-[13px] transition-colors duration-200", active ? "text-ink" : "text-ink-2 hover:text-ink")}
            >
              {it.label}
              {typeof it.count === "number" && <Mono className="text-[10.5px] text-ink-3">{it.count}</Mono>}
            </Link>
          );
        })}
        <span
          className={cx("pointer-events-none absolute bottom-[-1px] h-[2px] bg-cinnabar transition-[left,width,opacity] duration-300 ease-out", bar ? "opacity-100" : "opacity-0")}
          style={{ left: bar?.left ?? 0, width: bar?.width ?? 0 }}
        />
      </div>
    </nav>
  );
}
