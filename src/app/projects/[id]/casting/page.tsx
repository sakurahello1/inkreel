import { notFound } from "next/navigation";
import { getProjectView } from "@/server/queries";
import { getCastingStatus } from "@/server/actions";
import { CastingBoard } from "./board";

export const dynamic = "force-dynamic";

export default async function CastingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProjectView(id);
  if (!project) notFound();
  const status = await getCastingStatus(id);
  return <CastingBoard project={project} initial={status} />;
}
