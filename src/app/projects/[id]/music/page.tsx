import { notFound } from "next/navigation";
import { getProjectView } from "@/server/queries";
import { MusicLibrary } from "./library";

export const dynamic = "force-dynamic";

export default async function MusicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProjectView(id);
  if (!project) notFound();
  return <MusicLibrary project={project} />;
}
