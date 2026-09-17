import { Button, Mono } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-6">
      <form method="post" action="/api/auth" className="rounded-sm border border-line-strong bg-panel p-6">
        <Mono className="block text-[10.5px] uppercase text-ink-2">Access</Mono>
        <h1 className="mt-1 font-serif text-[22px] font-bold tracking-wide">进入工作台</h1>
        <p className="mt-2 text-[12.5px] text-ink-2">这台服务器对公网开放，请输入访问口令。</p>
        <input type="hidden" name="next" value={next ?? "/"} />
        <input
          type="password"
          name="password"
          autoFocus
          placeholder="访问口令"
          className="mt-4 w-full rounded-sm border border-line bg-paper px-3 py-2 text-[14px] outline-none focus:border-line-strong"
        />
        {error && <p className="mt-2 font-mono text-[11px] text-cinnabar">口令不对</p>}
        <Button variant="primary" type="submit" className="mt-4 w-full">
          进入
        </Button>
      </form>
    </main>
  );
}
