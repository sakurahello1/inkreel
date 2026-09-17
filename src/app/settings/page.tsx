import { Button, Field, Input, Mono, Section, Slate, Stamp } from "@/components/ui";

export default function SettingsPage() {
  return (
    <>
      <Slate eyebrow="Settings · 设置" title="全局设置" />
      <main className="mx-auto grid max-w-[1500px] grid-cols-1 gap-6 px-6 py-8 lg:grid-cols-2">
        <Section title="API Key" aside={<Mono className="text-[10.5px] text-ink-3">存于服务端 .env，不入库</Mono>}>
          <div className="flex flex-col gap-3">
            <Field label="OpenAI" hint="gpt-6-astra · gpt-image-2">
              <div className="flex items-center gap-2">
                <Input readOnly value="sk-••••••••••••••••••••" />
                <Stamp tone="moss">已连接</Stamp>
              </div>
            </Field>
            <Field label="MiniMax" hint="H3 · T2A">
              <div className="flex items-center gap-2">
                <Input readOnly value="eyJ••••••••••••••••••••" />
                <Stamp tone="moss">已连接</Stamp>
              </div>
            </Field>
          </div>
        </Section>
        <Section title="用量与预算">
          <dl className="grid grid-cols-2 gap-y-2 font-mono text-[12px]">
            <dt className="text-ink-3">本月累计</dt>
            <dd>$ 128.40</dd>
            <dt className="text-ink-3">视频</dt>
            <dd>$ 96.20</dd>
            <dt className="text-ink-3">生图</dt>
            <dd>$ 21.10</dd>
            <dt className="text-ink-3">文本</dt>
            <dd>$ 11.10</dd>
          </dl>
          <Field label="每章提醒阈值" hint="USD" className="mt-4">
            <Input defaultValue="30" />
          </Field>
          <div className="mt-4 flex justify-end">
            <Button size="sm">保存</Button>
          </div>
        </Section>
      </main>
    </>
  );
}
