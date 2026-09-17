import Link from "next/link";
import { notFound } from "next/navigation";
import { getProjectView } from "@/server/queries";
import { STATUS_ORDER, STATUS_TONE, formatTimecode } from "@/lib/status";
import { Button, Mono, cx } from "@/components/ui";

export const dynamic = "force-dynamic";

const TONE_BAR: Record<string, string> = {
  neutral: "bg-ink-3",
  amber: "bg-amber",
  indigo: "bg-indigo",
  moss: "bg-moss",
  cinnabar: "bg-cinnabar",
};

export default async function ChaptersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProjectView(id);
  if (!project) notFound();

  return (
    <main className="mx-auto max-w-[1500px] px-6 py-6">
      <div className="rounded-sm border border-line bg-panel">
        <table className="ledger w-full text-[13px]">
          <thead>
            <tr className="border-b border-line-strong text-left text-[10.5px] tracking-wider text-ink-2">
              <th className="w-16 px-4 py-2 font-mono font-normal">NO.</th>
              <th className="px-2 py-2 font-normal">章节</th>
              <th className="w-24 px-2 py-2 font-mono font-normal">镜头</th>
              <th className="w-24 px-2 py-2 font-mono font-normal">时长</th>
              <th className="w-[260px] px-2 py-2 font-normal">进度</th>
              <th className="w-24 px-2 py-2 font-mono font-normal">费用</th>
              <th className="w-40 px-2 py-2 font-mono font-normal">更新</th>
              <th className="w-24 px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {project.chapters.map((ch) => {
              const total = ch.shots.length;
              const dur = ch.shots.reduce((a, s) => a + s.duration, 0);
              const cost = ch.shots.reduce((a, s) => a + s.cost, 0);
              const done = ch.shots.filter((s) => s.status === "done").length;
              const chars = ch.sourceText.join("").length;
              return (
                <tr key={ch.id} className="group hover:bg-paper">
                  <td className="px-4 py-3 align-top font-mono text-ink-2">{String(ch.index).padStart(2, "0")}</td>
                  <td className="px-2 py-3 align-top">
                    <Link href={`/projects/${project.id}/chapters/${ch.id}`} className="font-serif text-[15px] font-bold tracking-wide hover:text-cinnabar">
                      {ch.title}
                    </Link>
                    <div className="mt-0.5 text-[11.5px] text-ink-3">
                      {chars > 0 ? `${chars} 字原文 · ${ch.units.length} 个戏剧单元` : "尚未导入原文"}
                      {ch.agentStatus === "running" && <span className="ml-2 text-indigo">Agent 拆镜中…</span>}
                      {ch.agentStatus === "failed" && <span className="ml-2 text-cinnabar">拆镜失败</span>}
                    </div>
                  </td>
                  <td className="px-2 py-3 align-top font-mono">
                    {done}/{total}
                  </td>
                  <td className="px-2 py-3 align-top font-mono">{formatTimecode(dur)}</td>
                  <td className="px-2 py-3 align-top">
                    {total > 0 ? (
                      <div className="flex h-[6px] w-full overflow-hidden bg-line">
                        {STATUS_ORDER.map((st) => {
                          const n = ch.shots.filter((s) => s.status === st).length;
                          if (!n) return null;
                          return <div key={st} className={cx("h-full", TONE_BAR[STATUS_TONE[st]])} style={{ width: `${(n / total) * 100}%` }} title={`${st} × ${n}`} />;
                        })}
                      </div>
                    ) : (
                      <Mono className="text-[10.5px] text-ink-3">—</Mono>
                    )}
                  </td>
                  <td className="px-2 py-3 align-top font-mono">$ {cost.toFixed(2)}</td>
                  <td className="px-2 py-3 align-top font-mono text-[11.5px] text-ink-2">{ch.updatedAt}</td>
                  <td className="px-4 py-3 text-right align-top">
                    <Button size="sm" href={`/projects/${project.id}/chapters/${ch.id}`}>
                      打开
                    </Button>
                  </td>
                </tr>
              );
            })}
            {project.chapters.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-[12.5px] text-ink-3">
                  还没有章节，点右上角「新建章节」。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-4 font-mono text-[10.5px] text-ink-3">
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-[6px] w-4 bg-amber" />
          待审
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-[6px] w-4 bg-indigo" />
          生成中
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-[6px] w-4 bg-ink-3" />
          已审
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-[6px] w-4 bg-moss" />
          完成
        </span>
      </div>
    </main>
  );
}
