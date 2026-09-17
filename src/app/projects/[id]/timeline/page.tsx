import Link from "next/link";
import { notFound } from "next/navigation";
import { getProjectView } from "@/server/queries";
import { Mono, cx } from "@/components/ui";
import { TimelineEditor } from "./editor";

export const dynamic = "force-dynamic";

export default async function TimelinePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ch?: string }> }) {
  const { id } = await params;
  const { ch } = await searchParams;
  const project = await getProjectView(id);
  if (!project) notFound();
  const chapter = project.chapters.find((c) => c.id === ch) ?? project.chapters[0] ?? null;

  return (
    <main className="mx-auto max-w-[1500px] px-6 py-6">
      <div className="mb-4 flex items-center gap-1 border-b border-line pb-2">
        <Mono className="mr-2 text-[10.5px] uppercase text-ink-3">Chapter</Mono>
        {project.chapters.map((c) => {
          const ready = c.shots.filter((s) => s.videoUrl).length;
          return (
            <Link
              key={c.id}
              href={`/projects/${project.id}/timeline?ch=${c.id}`}
              className={cx("rounded-sm border px-2.5 py-1 text-[12.5px]", chapter?.id === c.id ? "border-line-strong bg-panel text-ink" : "border-transparent text-ink-2 hover:text-ink")}
            >
              {String(c.index).padStart(2, "0")} {c.title}
              <Mono className="ml-1.5 text-[10px] text-ink-3">{ready} 段</Mono>
            </Link>
          );
        })}
        {project.chapters.length === 0 && <span className="text-[12px] text-ink-3">还没有章节</span>}
      </div>
      {chapter ? <TimelineEditor project={project} chapter={chapter} /> : null}
    </main>
  );
}
