import { notFound } from "next/navigation";
import { getProjectView } from "@/server/queries";
import { CharacterWorkbench } from "./workbench";

export const dynamic = "force-dynamic";

export default async function CharactersPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ c?: string }> }) {
  const { id } = await params;
  const { c } = await searchParams;
  const project = await getProjectView(id);
  if (!project) notFound();
  return <CharacterWorkbench project={project} initialId={c ?? null} />;
}
