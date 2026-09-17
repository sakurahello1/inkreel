import { notFound } from "next/navigation";
import { getProjectView } from "@/server/queries";
import { PropLibrary } from "./library";

export const dynamic = "force-dynamic";

export default async function PropsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProjectView(id);
  if (!project) notFound();
  return <PropLibrary project={project} />;
}
