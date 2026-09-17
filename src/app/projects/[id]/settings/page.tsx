import { notFound } from "next/navigation";
import { getProjectView } from "@/server/queries";
import { ProjectSettings } from "./form";

export const dynamic = "force-dynamic";

export default async function ProjectSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProjectView(id);
  if (!project) notFound();
  return <ProjectSettings project={project} />;
}
