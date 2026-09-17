"use client";

import { usePathname } from "next/navigation";
import { TabNav } from "@/components/ui";

export function ProjectTabs({ base, counts }: { base: string; counts: { characters: number; chapters: number; music: number; props: number; scenes: number } }) {
  const pathname = usePathname();
  return (
    <TabNav
      current={pathname}
      items={[
        { href: `${base}/world`, label: "世界观" },
        { href: `${base}/characters`, label: "人物库", count: counts.characters },
        { href: `${base}/scenes`, label: "场景库", count: counts.scenes },
        { href: `${base}/props`, label: "道具库", count: counts.props },
        { href: `${base}/music`, label: "音乐库", count: counts.music },
        { href: `${base}/chapters`, label: "章节", count: counts.chapters },
        { href: `${base}/timeline`, label: "时间线" },
        { href: `${base}/watch`, label: "成片" },
        { href: `${base}/settings`, label: "项目设置" },
      ]}
    />
  );
}
