import { notFound } from "next/navigation";
import { getChapterView, getProjectView } from "@/server/queries";
import { Storyboard } from "./storyboard";

export const dynamic = "force-dynamic";

export default async function ChapterPage({ params }: { params: Promise<{ id: string; cid: string }> }) {
  const { id, cid } = await params;
  const [project, chapter] = await Promise.all([getProjectView(id), getChapterView(id, cid)]);
  if (!project || !chapter) notFound();
  return <Storyboard project={project} chapter={chapter} />;
}
