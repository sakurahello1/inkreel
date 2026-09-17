import { Placeholder, Slate, Button } from "@/components/ui";

export default function AssetsPage() {
  return (
    <>
      <Slate eyebrow="Assets · 资产库" title="全部资产" meta={[["镜头", 8], ["首帧", 11], ["三视图", 4], ["音频", 3]]} actions={<Button>筛选</Button>} />
      <main className="mx-auto max-w-[1500px] px-6 py-8">
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
          {Array.from({ length: 16 }).map((_, i) => (
            <Placeholder key={i} ratio={i % 3 === 0 ? "3/2" : "9/16"} label={i % 3 === 0 ? "SHEET" : "SHOT"} />
          ))}
        </div>
        <p className="mt-6 text-[11.5px] text-ink-3">跨项目的镜头、首帧、三视图、音频。M3 实现搜索与回收。</p>
      </main>
    </>
  );
}
