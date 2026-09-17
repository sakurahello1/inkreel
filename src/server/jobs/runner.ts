import { db } from "../db";

export type JobHandler = (payload: Record<string, unknown>, job: { id: string; attempts: number }) => Promise<void>;

const handlers = new Map<string, JobHandler>();

const CONCURRENCY = Number(process.env.JOB_CONCURRENCY || 4);
const TICK_MS = 2000;

type RunnerState = { started: boolean; running: number; timer: NodeJS.Timeout | null };
const g = globalThis as unknown as { __jobRunner?: RunnerState };
const state: RunnerState = g.__jobRunner ?? { started: false, running: 0, timer: null };
g.__jobRunner = state;

export function registerJob(type: string, handler: JobHandler) {
  handlers.set(type, handler);
}

export async function enqueue(type: string, payload: Record<string, unknown>, opts: { delayMs?: number } = {}) {
  const job = await db.job.create({
    data: { type, payload: JSON.stringify(payload), runAt: new Date(Date.now() + (opts.delayMs ?? 0)) },
  });
  kick();
  return job;
}

export function startRunner() {
  if (state.started) return;
  state.started = true;
  // 进程重启后把卡在 running 的任务放回队列；没有外部任务号的 running 生成记录是被中断的孤儿，标记失败（重跑会新建记录）
  db.job
    .updateMany({ where: { status: "running" }, data: { status: "queued", lockedAt: null } })
    .catch(() => undefined);
  db.generation
    .updateMany({ where: { status: "running", externalTaskId: null }, data: { status: "failed", error: "服务重启中断，任务已自动重排", finishedAt: new Date() } })
    .catch(() => undefined);
  state.timer = setInterval(() => void tick(), TICK_MS);
  console.log(`[jobs] runner started, concurrency=${CONCURRENCY}`);
}

function kick() {
  if (state.started) void tick();
}

async function tick() {
  if (state.running >= CONCURRENCY) return;
  const free = CONCURRENCY - state.running;
  const due = await db.job.findMany({
    where: { status: "queued", runAt: { lte: new Date() } },
    orderBy: { runAt: "asc" },
    take: free,
  });
  for (const job of due) {
    const claimed = await db.job.updateMany({
      where: { id: job.id, status: "queued" },
      data: { status: "running", lockedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue;
    state.running += 1;
    void run(job.id, job.type, job.payload, job.attempts + 1).finally(() => {
      state.running -= 1;
    });
  }
}

async function run(id: string, type: string, payloadRaw: string, attempts: number) {
  const handler = handlers.get(type);
  if (!handler) {
    await db.job.update({ where: { id }, data: { status: "failed", error: `no handler for ${type}` } });
    return;
  }
  try {
    const payload = JSON.parse(payloadRaw) as Record<string, unknown>;
    await handler(payload, { id, attempts });
    await db.job.update({ where: { id }, data: { status: "done" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[jobs] ${type} failed:`, msg);
    await db.job.update({ where: { id }, data: { status: "failed", error: msg.slice(0, 2000) } });
  }
}
