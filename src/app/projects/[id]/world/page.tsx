import { notFound } from "next/navigation";
import { getProjectView } from "@/server/queries";
import { WorldEditor } from "./editor";

export const dynamic = "force-dynamic";

export default async function WorldPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProjectView(id);
  if (!project) notFound();
  return <WorldEditor project={project} />;
}
