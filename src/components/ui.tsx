import Link from "next/link";
import type { ReactNode } from "react";
import type { ShotStatus } from "@/lib/types";
import { STATUS_CODE, STATUS_LABEL, STATUS_TONE, type Tone } from "@/lib/status";

/* ---------- 基础 ---------- */

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("font-mono tracking-wide", className)}>{children}</span>;
}

/* ---------- 按钮 ---------- */

type ButtonProps = {
  children: ReactNode;
  variant?: "primary" | "outline" | "ghost";
  size?: "sm" | "md";
  href?: string;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
  title?: string;
};

export function Button({
  children,
  variant = "outline",
  size = "md",
  href,
  className,
  disabled,
  onClick,
  type = "button",
  title,
}: ButtonProps) {
  const base = cx(
    "press inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border font-medium select-none",
    size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3.5 text-[13px]",
    variant === "primary" &&
      "bg-cinnabar border-cinnabar text-paper hover:bg-cinnabar-deep hover:border-cinnabar-deep",
    variant === "outline" && "bg-panel border-line-strong text-ink hover:bg-paper-deep",
    variant === "ghost" && "bg-transparent border-transparent text-ink-2 hover:text-ink hover:bg-paper-deep",
    disabled && "opacity-40 pointer-events-none",
    className,
  );
  if (href) {
    return (
      <Link href={href} className={base} title={title}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} className={base} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

/* ---------- 印章徽章 ---------- */

const TONE_CLASS: Record<Tone, string> = {
  neutral: "text-ink-2 bg-panel",
  amber: "text-amber bg-amber-wash",
  indigo: "text-indigo bg-indigo-wash",
  moss: "text-moss bg-moss-wash",
  cinnabar: "text-cinnabar bg-cinnabar-wash",
};

export function Stamp({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx("stamp", TONE_CLASS[tone], className)}>{children}</span>;
}

export function StatusStamp({ status, withLabel = true }: { status: ShotStatus; withLabel?: boolean }) {
  return (
    <Stamp key={status} tone={STATUS_TONE[status]} className="anim-pop">
      {STATUS_CODE[status]}
      {withLabel && <span className="font-sans tracking-normal normal-case">{STATUS_LABEL[status]}</span>}
    </Stamp>
  );
}

/* ---------- 占位符 ---------- */

export function Placeholder({
  label,
  hint,
  ratio,
  className,
}: {
  label: string;
  hint?: string;
  ratio?: string;
  className?: string;
}) {
  return (
    <div
      className={cx("placeholder flex flex-col items-center justify-center gap-1 text-center rounded-sm", className)}
      style={ratio ? { aspectRatio: ratio } : undefined}
    >
      <Mono className="text-[10.5px] text-ink-2">{label}</Mono>
      {hint && <span className="text-[11px] text-ink-3 px-3">{hint}</span>}
    </div>
  );
}

/* ---------- 表单 ---------- */

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("block", className)}>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[11.5px] tracking-wider text-ink-2">{label}</span>
        {hint && <Mono className="text-[10px] text-ink-3">{hint}</Mono>}
      </div>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-sm border border-line bg-panel px-2.5 py-1.5 text-[13px] leading-relaxed outline-none placeholder:text-ink-3 focus:border-line-strong";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputClass, "resize-y", props.className)} />;
}

/* ---------- 区块 ---------- */

export function Section({
  title,
  aside,
  children,
  className,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("border border-line bg-panel rounded-sm", className)}>
      <header className="flex items-center justify-between border-b border-line px-4 py-2">
        <h3 className="font-serif text-[14px] font-bold tracking-wide">{title}</h3>
        {aside && <div className="flex items-center gap-2">{aside}</div>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Rule({ className }: { className?: string }) {
  return <hr className={cx("border-0 border-t border-line", className)} />;
}

/* ---------- 人物头像（带 tag 角标） ---------- */

export function Avatar({ name, tag, size = 24 }: { name: string; tag?: string; size?: number }) {
  return (
    <span className="relative inline-flex shrink-0" title={tag ? `${name} · ${tag}` : name}>
      <span
        className="inline-flex items-center justify-center rounded-sm border border-line-strong bg-paper-deep font-serif font-bold leading-none"
        style={{ width: size, height: size, fontSize: size * 0.48 }}
      >
        {name.slice(0, 1)}
      </span>
      {tag && (
        <span className="absolute -right-1 -bottom-1 rounded-sm border border-line-strong bg-panel px-[3px] font-mono text-[8.5px] leading-[12px] tracking-wider">
          {tag}
        </span>
      )}
    </span>
  );
}

/* ---------- 场记板标题 ---------- */

export function Slate({
  eyebrow,
  title,
  meta,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  meta?: Array<[string, ReactNode]>;
  actions?: ReactNode;
}) {
  return (
    <div className="shrink-0 border-b border-line-strong bg-panel">
      <div className="mx-auto flex max-w-[1500px] items-end justify-between gap-6 px-6 pt-5 pb-4">
        <div className="min-w-0">
          {eyebrow && <Mono className="block text-[10.5px] uppercase text-ink-2">{eyebrow}</Mono>}
          <h1 className="mt-1 truncate font-serif text-[26px] font-bold leading-tight tracking-wide">{title}</h1>
        </div>
        <div className="flex items-end gap-6">
          {meta && (
            <dl className="hidden items-end gap-6 md:flex">
              {meta.map(([k, v]) => (
                <div key={k} className="min-w-[72px] border-l border-line pl-3">
                  <dt className="text-[10.5px] tracking-wider text-ink-3">{k}</dt>
                  <dd className="font-mono text-[13px] leading-tight">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      </div>
    </div>
  );
}

/* ---------- 标签页导航（下划线滑动，实现在 tab-nav.tsx） ---------- */

export { TabNav } from "./tab-nav";
