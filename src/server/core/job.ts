import type { Prisma } from "@prisma/client";

/**
 * 任务基类。
 *
 * 队列（jobs/runner.ts）只认识「type + 一个异步函数」，Job 把那个函数包成对象，
 * 让每个任务能拥有自己的字段、私有方法和继承关系，而不是一堆平铺的闭包。
 */
export interface JobContext {
  /** Job 表里的行 id */
  id: string;
  /** 第几次尝试，从 1 开始 */
  attempts: number;
}

export abstract class Job<P = Record<string, unknown>> {
  /** 队列里的任务类型名，必须全局唯一 */
  abstract readonly type: string;

  abstract run(payload: P, ctx: JobContext): Promise<void>;

  /** 交给 runner 注册用的裸函数 */
  toHandler() {
    return (payload: Record<string, unknown>, ctx: JobContext) => this.run(payload as P, ctx);
  }
}

/** 事务里要一起执行的写操作 */
export type Writes = Prisma.PrismaPromise<unknown>[];

/** 统一的错误文案裁剪：实体上留短的给人看，生成记录里留长的给排查 */
export function errText(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return { short: msg.slice(0, 500), long: msg.slice(0, 2000), raw: msg };
}
