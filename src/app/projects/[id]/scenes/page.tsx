import { notFound } from "next/navigation";
import { getProjectView } from "@/server/queries";
import { SceneLibrary } from "./library";

export const dynamic = "force-dynamic";

export default async function ScenesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProjectView(id);
  if (!project) notFound();
  return <SceneLibrary project={project} />;
}
