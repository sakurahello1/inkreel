"use client";

import { useEffect, useState } from "react";
import type { Chapter, Project } from "@/lib/types";
import { discardVersion, labelVersion, useGenerationResult } from "@/server/actions";
import { useAct } from "@/components/use-act";
import { Button, Mono, Placeholder, cx } from "@/components/ui";
import { frameAspect } from "./shared";

type VersionRow = {
  id: string; url: string | null; duration: number | null; cost: number; model: string; resolution: string;
  status: string; progress: string; label: string; createdAt: string; prompt: string; isCurrent: boolean;
};

/**
 * 版本面板。每一次生成都是一个版本：能播、能标注、能采用、能弃。
 * 视频版本直接带 controls 放在网格里，横屏两列——以前那个折叠的静音缩略图条根本没法比较。
 */
export function VersionStrip({
  project,
  chapter,
  load,
  kind,
  onGenerate,
}: {
  project: Project;
  chapter: Chapter;
  load: () => Promise<VersionRow[]>;
  kind: "图" | "视频";
  /** 视频：再出一版。keepCurrent 为真时不顶掉当前 */
  onGenerate?: (keepCurrent: boolean) => Promise<unknown>;
}) {
  const { act: run, pending } = useAct();
  const [rows, setRows] = useState<VersionRow[] | null>(null);
  const [open, setOpen] = useState(kind === "视频");
  const [keep, setKeep] = useState(true);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const landscape = project.orientation === "16:9";

  const refresh = async () => setRows(await load());
  useEffect(() => {
    if (open) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, chapter.updatedAt]);

  const busy = rows?.some((r) => r.status !== "success") ?? false;
  useEffect(() => {
    if (!open || !busy) return;
    const t = setInterval(() => void refresh(), 6000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, busy]);

  const shortModel = (m: string) => m.replace(/^fal:/, "fal·").replace("minimax/h3-max-turbo", "H3 Turbo").replace("openai/gpt-image-2.5/flare", "flare");

  return (
    <div className="mt-3 border-t border-dashed border-line pt-3">
      <div className="flex items-center justify-between">
        <button onClick={() => setOpen((v) => !v)} className="text-[11.5px] tracking-wider text-ink-2 hover:text-ink">
          版本{rows ? ` · ${rows.length}` : ""} <Mono className="ml-1 text-[10px] text-ink-3">{open ? "收起" : "展开"}</Mono>
        </button>
        {onGenerate && (
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-[10.5px] text-ink-2">
              <input type="checkbox" className="accent-cinnabar" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
              不替换当前
            </label>
            <Button size="sm" variant="primary" disabled={pending} onClick={() => run(async () => { await onGenerate(keep); setOpen(true); await refresh(); })}>
              再出一版
            </Button>
          </div>
        )}
      </div>

      {open && (
        <div className="mt-2">
          {!rows ? (
            <Mono className="text-[10.5px] text-ink-3">读取中…</Mono>
          ) : rows.length === 0 ? (
            <Mono className="text-[10.5px] text-ink-3">还没有生成过</Mono>
          ) : (
            <div className={cx("grid gap-2", landscape ? "grid-cols-2" : "grid-cols-3")}>
              {rows.map((r, i) => {
                const no = rows.length - i;
                return (
                  <div key={r.id} className={cx("border p-1.5", r.isCurrent ? "border-cinnabar bg-paper" : "border-line")}>
                    {r.status !== "success" ? (
                      <div className="placeholder flex items-center justify-center text-[10px] text-ink-3" style={{ aspectRatio: frameAspect(project.orientation) }}>
                        {r.status === "queued" ? "排队中" : `生成中 ${r.progress}`}
                      </div>
                    ) : r.url ? (
                      kind === "视频" ? (
                        <video src={r.url} controls preload="metadata" className="w-full bg-black" style={{ aspectRatio: frameAspect(project.orientation) }} />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <a href={r.url} target="_blank" rel="noreferrer"><img src={r.url} alt="" className="w-full object-cover" style={{ aspectRatio: frameAspect(project.orientation) }} /></a>
                      )
                    ) : (
                      <Placeholder ratio={frameAspect(project.orientation)} label="—" />
                    )}

                    <div className="mt-1 flex items-baseline justify-between gap-1">
                      <span className="font-mono text-[11px]">
                        v{no}
                        {r.isCurrent && <span className="ml-1 text-cinnabar">当前</span>}
                      </span>
                      <Mono className="truncate text-[9.5px] text-ink-3">
                        {r.createdAt.slice(5, 16).replace("T", " ")} · {r.duration ? `${r.duration.toFixed(1)}s · ` : ""}{r.cost ? `$${r.cost.toFixed(2)}` : "—"}
                      </Mono>
                    </div>
                    <span className="block truncate font-mono text-[9.5px] text-ink-3" title={r.model}>
                      {shortModel(r.model)}{r.resolution ? ` · ${r.resolution}` : ""}
                    </span>

                    {editing?.id === r.id ? (
                      <input
                        autoFocus
                        value={editing.text}
                        onChange={(e) => setEditing({ id: r.id, text: e.target.value })}
                        onBlur={() => { const t = editing.text; setEditing(null); if (t !== r.label) run(async () => { await labelVersion(project.id, chapter.id, r.id, t); await refresh(); }); }}
                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditing(null); }}
                        placeholder="备注：台词对 / 表情好…"
                        className="mt-1 w-full border border-line bg-panel px-1 py-0.5 text-[10.5px]"
                      />
                    ) : (
                      <button onClick={() => setEditing({ id: r.id, text: r.label })} className={cx("mt-1 block w-full truncate text-left text-[10.5px]", r.label ? "text-ink" : "text-ink-3 hover:text-ink-2")} title="点击改备注">
                        {r.label || "＋ 备注"}
                      </button>
                    )}

                    {r.status === "success" && (
                      <div className="mt-1 flex gap-1">
                        {r.isCurrent ? (
                          <span className="flex-1 border border-cinnabar/40 py-0.5 text-center text-[10px] text-cinnabar">采用中</span>
                        ) : (
                          <button disabled={pending} onClick={() => run(async () => { await useGenerationResult(project.id, chapter.id, r.id); await refresh(); })} className="flex-1 border border-line py-0.5 text-[10px] hover:bg-panel disabled:opacity-40">
                            采用
                          </button>
                        )}
                        <button
                          disabled={pending || r.isCurrent}
                          title={r.isCurrent ? "采用中的版本不能弃，先切到别的版本" : "删除这一版及其文件"}
                          onClick={() => { if (confirm(`弃掉 v${no}？文件会一起删除。`)) run(async () => { await discardVersion(project.id, chapter.id, r.id); await refresh(); }); }}
                          className="border border-line px-2 py-0.5 text-[10px] text-ink-3 hover:text-cinnabar disabled:opacity-40"
                        >
                          弃
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

