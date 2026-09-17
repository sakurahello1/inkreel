import { notFound } from "next/navigation";
import { getProjectView } from "@/server/queries";
import { Watch } from "./watch";

export const dynamic = "force-dynamic";

export default async function WatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ch?: string }> }) {
  const { id } = await params;
  const { ch } = await searchParams;
  const project = await getProjectView(id);
  if (!project) notFound();
  return <Watch project={project} initialChapterId={ch ?? null} />;
}
