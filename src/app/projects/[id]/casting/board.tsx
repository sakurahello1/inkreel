"use client";

import { useEffect, useMemo, useState } from "react";
import type { Project, VoiceOption } from "@/lib/types";
import { confirmVoice, getCastingStatus, getVoiceOptions, runCasting, unconfirmVoice } from "@/server/actions";
import { useAct } from "@/components/use-act";
import { Avatar, Button, Mono, Placeholder, Slate, Stamp, cx } from "@/components/ui";
import type { ChatProviderName } from "@/server/providers/chat";
import { PROVIDERS } from "../chapters/[cid]/shared";

type Status = Awaited<ReturnType<typeof getCastingStatus>>;

/**
 * 选角：Agent 给每个开口的角色（含旁白）挑 3 个候选音色并合成试听；人听完点确认。
 * 这是配音前的硬闸门——一个没确认，「配音」按钮都是灰的。
 */
export function CastingBoard({ project, initial }: { project: Project; initial: Status }) {
  const { act, pending } = useAct();
  const [st, setSt] = useState<Status>(initial);
  const [options, setOptions] = useState<VoiceOption[] | null>(null);
  const [manual, setManual] = useState<Record<string, string>>({});
  const [provider, setProvider] = useState<ChatProviderName>("chat");

  useEffect(() => setSt(initial), [initial]);
  // 选角在跑：每 4 秒拉一次
  useEffect(() => {
    if (!st.running) return;
    const t = setInterval(() => getCastingStatus(project.id).then(setSt), 4000);
    return () => clearInterval(t);
  }, [st.running, project.id]);
  useEffect(() => {
    getVoiceOptions().then((r) => setOptions(Array.isArray(r) ? r : []));
  }, []);

  const confirmedCount = st.roles.filter((r) => r.confirmed).length;
  const optionsByName = useMemo(() => new Map((options ?? []).map((o) => [o.voiceId, o.name])), [options]);

  return (
    <>
      <Slate
        eyebrow="Casting · 选角"
        title="声音选角"
        meta={[
          ["角色", st.roles.length],
          ["已确认", `${confirmedCount}/${st.roles.length}`],
          ["状态", st.ready ? "可以配音" : "未完成"],
        ]}
        actions={
          <div className="flex items-center gap-2">
            <select value={provider} onChange={(e) => setProvider(e.target.value as ChatProviderName)} disabled={st.running} className="h-8 rounded-sm border border-line bg-panel px-1.5 font-mono text-[11px]" title="挑候选用哪个模型">
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <Button variant="primary" disabled={pending || st.running || !st.roles.length} onClick={() => act(() => runCasting(project.id, provider))}>
              {st.running ? "Agent 选角中…" : st.roles.some((r) => r.candidates.length) ? "重新让 Agent 选角" : "让 Agent 选角"}
            </Button>
          </div>
        }
      />
      <main className="mx-auto max-w-[1500px] px-6 py-6">
        {st.roles.length === 0 && <Placeholder className="h-40" label="还没有可配音的内容：先到章节页贴原文、拆页" />}
        {st.roles.length > 0 && (
          <div className={cx("mb-4 border px-3 py-2 text-[12.5px]", st.ready ? "border-moss/40 bg-moss-wash text-moss" : "border-amber/40 bg-amber-wash text-amber")}>
            {st.ready ? "所有角色都确认了音色，可以去章节页配音。" : `还有 ${st.roles.length - confirmedCount} 个角色没确认音色：${st.roles.filter((r) => !r.confirmed).map((r) => r.name).join("、")}。听候选，或在右侧手动选一个。`}
          </div>
        )}
        <div className="flex flex-col gap-4">
          {st.roles.map((r) => (
            <section key={r.key} className={cx("border bg-panel p-4", r.confirmed ? "border-moss/50" : "border-line")}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <Avatar name={r.name} size={36} />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-serif text-[16px] font-bold">{r.name}</span>
                      <Mono className="text-[10.5px] text-ink-3">{r.lines} 条</Mono>
                      {r.confirmed ? <Stamp tone="moss">已确认 · {r.voiceLabel.replace(/^MiniMax · /, "")}</Stamp> : r.voiceId ? <Stamp tone="amber">已选未确认</Stamp> : <Stamp tone="neutral">未选</Stamp>}
                    </div>
                    <p className="mt-0.5 text-[12px] text-ink-2">{r.description || "（无描述）"}</p>
                    <p className="mt-1 font-serif text-[12.5px] text-ink">「{r.sampleLine}」</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <select
                    value={manual[r.key] ?? ""}
                    onChange={(e) => setManual((m) => ({ ...m, [r.key]: e.target.value }))}
                    className="w-56 rounded-sm border border-line bg-paper px-2 py-1 text-[12px]"
                    title="不用候选，直接从音色库里挑一个"
                  >
                    <option value="">手动选音色…</option>
                    {(options ?? []).map((o) => (
                      <option key={o.voiceId} value={o.voiceId}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" disabled={pending || !manual[r.key]} onClick={() => act(() => confirmVoice(project.id, r.key, manual[r.key], optionsByName.get(manual[r.key]) ?? manual[r.key]))}>
                    用这个
                  </Button>
                  {r.confirmed && (
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => unconfirmVoice(project.id, r.key))}>
                      取消确认
                    </Button>
                  )}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-3">
                {r.candidates.length === 0 && <div className="col-span-3 text-[12px] text-ink-3">{st.running ? "Agent 正在挑候选、合成试听…" : "还没有候选。点右上角「让 Agent 选角」，或手动选一个。"}</div>}
                {r.candidates.map((c, i) => {
                  const chosen = r.voiceId === c.voiceId;
                  return (
                    <div key={c.voiceId} className={cx("border p-3", chosen ? "border-cinnabar bg-paper" : "border-line bg-paper")}>
                      <div className="flex items-center justify-between">
                        <span className="font-serif text-[13px] font-bold">
                          {i + 1}. {c.name}
                        </span>
                        <Mono className="text-[10px] text-ink-3">{c.voiceId}</Mono>
                      </div>
                      <p className="mt-1 min-h-[2.6em] text-[11.5px] leading-relaxed text-ink-2">{c.reason}</p>
                      {c.sampleUrl ? <audio controls preload="none" src={c.sampleUrl} className="mt-2 h-8 w-full" /> : <div className="mt-2 text-[11px] text-ink-3">试听合成失败</div>}
                      <div className="mt-2 flex justify-end">
                        <Button size="sm" variant={chosen && r.confirmed ? "outline" : "primary"} disabled={pending || (chosen && r.confirmed)} onClick={() => act(() => confirmVoice(project.id, r.key, c.voiceId, c.name))}>
                          {chosen && r.confirmed ? "采用中" : "确认用这个"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </main>
    </>
  );
}
