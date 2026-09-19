import Link from "next/link";
import { listProjects } from "@/server/queries";
import { createProject } from "@/server/actions";
import { Button, Mono, Placeholder, Slate } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const projects = await listProjects();
  return (
    <>
      <Slate
        eyebrow="Projects · 项目"
        title="全部项目"
        meta={[
          ["项目", projects.length],
          ["进行中", projects.filter((p) => p.chapters.length > 0).length],
        ]}
        actions={
          <form action={createProject} className="flex items-center gap-2">
            <input name="title" placeholder="项目名" className="h-8 w-40 rounded-sm border border-line bg-panel px-2.5 text-[13px] outline-none focus:border-line-strong" />
            <select name="kind" defaultValue="drama" className="h-8 rounded-sm border border-line bg-panel px-1.5 text-[12px] outline-none focus:border-line-strong" title="短剧：分镜 → 首帧 → 视频；说书：拆页 → 出图 → 选角 → 配音 → 页视频">
              <option value="drama">短剧</option>
              <option value="narrated">说书</option>
            </select>
            <Button variant="primary" type="submit">
              新建项目
            </Button>
          </form>
        }
      />
      <main className="mx-auto max-w-[1500px] px-6 py-8">
        <div className="stagger grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {projects.map((p, idx) => {
            const shots = p.chapters.reduce((a, c) => a + c.shots.length, 0);
            const done = p.chapters.reduce((a, c) => a + c.shots.filter((s) => s.status === "done").length, 0);
            return (
              <Link key={p.id} href={`/projects/${p.id}/world`} className="group block" style={{ "--i": idx } as React.CSSProperties}>
                <div className="lift relative border border-line-strong bg-panel p-1.5 group-hover:border-cinnabar">
                  {p.poster ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.poster} alt="" className="block w-full object-cover" style={{ aspectRatio: "9 / 16" }} loading="lazy" />
                  ) : (
                    <Placeholder label="POSTER 9:16" ratio="9/16" hint="封面待生成" className="border-0" />
                  )}
                  <div className="absolute left-3 top-3 font-mono text-[10px] tracking-wider text-ink-2">NO.{String(idx + 1).padStart(3, "0")}</div>
                </div>
                <div className="mt-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate font-serif text-[16px] font-bold tracking-wide group-hover:text-cinnabar">{p.title}</h2>
                    <div className="mt-0.5 truncate text-[11.5px] text-ink-2">{p.genre.join(" · ") || "未设置题材"}</div>
                  </div>
                  <Mono className="shrink-0 text-[10.5px] text-ink-3">
                    {p.kind === "narrated" ? <span className="mr-1 border border-line px-1 text-ink-2">说书</span> : null}
                    {p.orientation}
                  </Mono>
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-1 border-t border-line pt-2 font-mono text-[10.5px]">
                  <div>
                    <dt className="text-ink-3">章节</dt>
                    <dd>
                      {p.chapters.length}/{p.targetEpisodes}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-3">镜头</dt>
                    <dd>
                      {done}/{shots}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-3">人物</dt>
                    <dd>{p.characters.length}</dd>
                  </div>
                </dl>
                <div className="mt-1 h-[3px] w-full bg-line">
                  <div className="h-full bg-cinnabar" style={{ width: shots ? `${(done / shots) * 100}%` : "0%" }} />
                </div>
                <Mono className="mt-1.5 block text-[10px] text-ink-3">{p.updatedAt}</Mono>
              </Link>
            );
          })}
          {projects.length === 0 && (
            <div className="col-span-full py-16 text-center text-[13px] text-ink-2">
              还没有项目。右上角新建一个，或调用 <Mono>POST /api/dev/seed</Mono> 写入示例数据。
            </div>
          )}
        </div>
      </main>
    </>
  );
}
