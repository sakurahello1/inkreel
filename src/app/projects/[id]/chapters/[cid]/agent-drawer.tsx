"use client";

import { useState } from "react";
import { useAutoRefresh } from "@/components/use-auto-refresh";
import type { Chapter, Project } from "@/lib/types";
import { runPages, runStoryboard, updateChapter } from "@/server/actions";
import type { ChatProviderName } from "@/server/providers/chat";
import { useAct } from "@/components/use-act";
import { Button, Field, Mono, Textarea, cx } from "@/components/ui";
import { PROVIDERS } from "./shared";

export function AgentDrawer({ project, chapter, onClose }: { project: Project; chapter: Chapter; onClose: () => void }) {
  const [instruction, setInstruction] = useState("");
  const [provider, setProvider] = useState<ChatProviderName>("chat");
  const { act, pending } = useAct();
  const running = chapter.agentStatus === "running";
  const narrated = project.kind === "narrated";
  const word = narrated ? "拆页" : "拆镜";
  const quick = narrated ? ["页再碎一点", "合并成更少页", "旁白精简一半", "多保留原文对白", "每页只放一个人"] : ["拆细一点", "合并成更少镜头", "多用特写", "全部改为直出", "重新选人设"];
  const rerun = () => (narrated ? runPages(project.id, chapter.id, { provider, instruction }) : runStoryboard(project.id, chapter.id, { provider, instruction }));
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line-strong bg-panel">
      <div className="mx-auto flex max-w-[1500px] items-start gap-4 px-6 py-4">
        <div className="w-44 shrink-0">
          <div className="font-serif text-[15px] font-bold tracking-wide">Agent 重新{word}</div>
          <select value={provider} onChange={(e) => setProvider(e.target.value as ChatProviderName)} className="mt-1 w-full rounded-sm border border-line bg-paper px-1.5 py-1 font-mono text-[10.5px]">
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink-2">{narrated ? "会按额外要求重新拆整章为页，现有页与配音将被替换。" : "会按额外要求重新拆整章，现有镜头与其状态将被替换。只想改一镜，用右栏的「让 Agent 重写本镜」。"}</p>
        </div>
        <div className="flex-1">
          <Textarea rows={3} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={narrated ? "例：旁白口语一点，像说书人；对白尽量保留原文；每页画面只突出一个人物。" : "例：整体再碎一点，对话全部切反打；沈昭全程用「入魔」人设；结尾拔剑给两个特写。"} />
          <div className="mt-2 flex items-center justify-between">
            <div className="flex flex-wrap gap-1.5">
              {quick.map((q) => (
                <button key={q} type="button" onClick={() => setInstruction((s) => (s ? `${s}；${q}` : q))} className="rounded-sm border border-line bg-paper px-2 py-0.5 text-[11.5px] text-ink-2 hover:border-line-strong hover:text-ink">
                  {q}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {running && <Mono className="text-[10.5px] text-indigo">{word}中…</Mono>}
              <Button size="sm" variant="ghost" onClick={onClose}>
                关闭
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={pending || running}
                onClick={() => {
                  if (confirm(narrated ? "重新拆页会替换现有全部页与配音，继续？" : "重新拆整章会替换现有全部镜头，继续？")) act(rerun);
                }}
              >
                重新{word}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */

export function EmptyChapter({ project, chapter }: { project: Project; chapter: Chapter }) {
  const [text, setText] = useState(chapter.sourceText.join("\n"));
  const [provider, setProvider] = useState<ChatProviderName>("chat");
  const { act, pending } = useAct();
  const running = chapter.agentStatus === "running";
  useAutoRefresh(running, 4000);
  const charsWithoutPersona = project.characters.filter((c) => c.personas.length === 0);
  const narrated = project.kind === "narrated";
  const word = narrated ? "拆页" : "拆镜";
  const start = () => (narrated ? runPages(project.id, chapter.id, { provider, sourceText: text }) : runStoryboard(project.id, chapter.id, { provider, sourceText: text }));

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[460px_1fr]">
      <aside className="flex min-h-0 flex-col border-r border-line bg-paper">
        <header className="flex items-center justify-between border-b border-line px-4 py-1.5">
          <span className="font-serif text-[13px] font-bold tracking-wide">原文</span>
          <Mono className="text-[10.5px] text-ink-3">{text.length} 字</Mono>
        </header>
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={running}
            className="min-h-0 flex-1 resize-none border-0 bg-transparent font-serif text-[14px] leading-[1.9] outline-none placeholder:text-ink-3"
            placeholder={narrated ? `把第 ${chapter.index} 章的小说原文贴到这里。\n\n一次一章，按空行或换行分段。Agent 会按情节切段，再拆成一页页：每页一张图、一段旁白、若干句对白。` : `把第 ${chapter.index} 章的小说原文贴到这里。\n\n一次一章，按空行或换行分段。Agent 会按情节节拍切段，再拆成 4–8 秒的镜头。`}
          />
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
            <div className="flex items-center gap-2">
              <select value={provider} onChange={(e) => setProvider(e.target.value as ChatProviderName)} disabled={running} className="rounded-sm border border-line bg-panel px-1.5 py-1 font-mono text-[11px]">
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <Mono className="text-[10.5px] text-ink-3">{PROVIDERS.find((p) => p.id === provider)?.hint}</Mono>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" disabled={pending || running || text === chapter.sourceText.join("\n")} onClick={() => act(() => updateChapter(project.id, chapter.id, { sourceText: text }))}>
                仅保存
              </Button>
              <Button variant="primary" disabled={pending || running || !text.trim()} onClick={() => act(start)}>
                {running ? `${word}中…` : narrated ? "让 Agent 拆页" : "让 Agent 拆分镜"}
              </Button>
            </div>
          </div>
        </div>
      </aside>
      <div className="flex items-center justify-center bg-panel p-10">
        <div className="max-w-[460px] text-center">
          {running ? (
            <>
              <div className="font-serif text-[22px] font-bold tracking-wide">Agent 正在{word}</div>
              <div className="tape mx-auto mt-4 max-w-[240px]" />
              <p className="mt-3 text-[12.5px] text-ink-2">通常 1–3 分钟。输出会经过 schema 校验，不合规自动回炉一次。</p>
            </>
          ) : (
            <>
              <div className="font-serif text-[22px] font-bold tracking-wide">{narrated ? "空白说书页" : "空白分镜页"}</div>
              {chapter.agentStatus === "failed" && chapter.agentError && <p className="mt-3 break-all rounded-sm border border-cinnabar/40 bg-cinnabar-wash px-3 py-2 text-left font-mono text-[11px] text-cinnabar">{chapter.agentError}</p>}
              <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
                {narrated ? (
                  <>
                    贴入原文后，Agent 会把这一章拆成一页页：每页一张画面提示词、一段说书人旁白、若干句保留原文的对白（带语气与表情）。
                    <br />
                    之后：出图 → 选角（人工确认音色）→ 配音 → 渲染页视频 → 导出。
                  </>
                ) : (
                  <>
                    贴入原文后，Agent 会输出：景别、运镜、时长、出场人物与人设 tag、台词、情绪、动作、环境音、首帧提示词、视频提示词。
                    <br />
                    全部字段可改，改完再审定。
                  </>
                )}
              </p>
              {project.characters.length === 0 && <p className="mt-3 text-[12px] text-cinnabar">人物库还是空的，Agent 无法安排出场人物。建议先建人物与人设。</p>}
              {charsWithoutPersona.length > 0 && <p className="mt-3 text-[12px] text-amber">这些人物还没有人设 tag，Agent 不会让他们出场：{charsWithoutPersona.map((c) => c.name).join("、")}</p>}
              <div className="mt-6 grid grid-cols-3 gap-3 text-[11.5px]">
                {(narrated ? ["审定页", "确认音色", "验收页视频"] : ["审定分镜", "审定首帧", "验收视频"]).map((g, i) => (
                  <div key={g} className="border border-line bg-paper px-3 py-2">
                    <Mono className="block text-[10px] text-ink-3">GATE {i + 1}</Mono>
                    <span className="font-serif font-bold">{g}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

