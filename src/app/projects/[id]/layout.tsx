import { notFound } from "next/navigation";
import { getProjectView } from "@/server/queries";
import { Slate } from "@/components/ui";
import { ProjectTabs } from "./tabs";
import { NewChapterButton } from "./new-chapter";

export const dynamic = "force-dynamic";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProjectView(id);
  if (!project) notFound();

  const shots = project.chapters.reduce((a, c) => a + c.shots.length, 0);
  const done = project.chapters.reduce((a, c) => a + c.shots.filter((s) => s.status === "done").length, 0);
  const cost = project.chapters.reduce((a, c) => a + c.shots.reduce((x, s) => x + s.cost, 0), 0);

  return (
    <>
      <Slate
        eyebrow={`Project · ${project.id.slice(-6).toUpperCase()}`}
        title={
          <>
            {project.title}
            <span className="ml-3 align-middle text-[12px] font-normal text-ink-2">{project.genre.join(" · ")}</span>
          </>
        }
        meta={[
          ["画幅", project.orientation],
          ["章节", `${project.chapters.length}/${project.targetEpisodes}`],
          ["镜头", `${done}/${shots}`],
          ["累计费用", `$ ${cost.toFixed(2)}`],
        ]}
        actions={<NewChapterButton projectId={project.id} nextIndex={project.chapters.length + 1} />}
      />
      <ProjectTabs base={`/projects/${project.id}`} counts={{ characters: project.characters.length, chapters: project.chapters.length, music: project.bgmTracks?.length ?? 0, props: project.props?.length ?? 0, scenes: project.scenes?.length ?? 0 }} />
      {children}
    </>
  );
}
