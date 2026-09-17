import { db } from "../db";
import { saveAsset } from "../storage";

/**
 * 服务层基类。
 *
 * 业务逻辑住在服务里，Next 的 server action（actions.ts）只做两件事：
 * 转调服务、失效对应页面的缓存。这样业务逻辑不依赖 Next，可以单独测试，
 * 也不会再出现「同一段逻辑在两个 action 里各写一遍」。
 */
export abstract class Service {
  protected readonly db = db;

  /**
   * 从 FormData 里取文件存成资产。
   * 上传人设图、道具图、首帧、声音样本、BGM 都走这里，以前是抄了五遍。
   */
  protected async saveUpload(
    form: FormData,
    opts: { projectId: string; folder: string; kind: "image" | "audio" | "video"; field?: string; defaultMime?: string },
  ) {
    const file = form.get(opts.field ?? "file");
    if (!(file instanceof File) || file.size === 0) throw new Error("没有文件");
    const buffer = Buffer.from(await file.arrayBuffer());
    const mime = file.type || opts.defaultMime || (opts.kind === "audio" ? "audio/mpeg" : "image/png");
    const asset = await saveAsset({ buffer, mime, kind: opts.kind, projectId: opts.projectId, folder: opts.folder });
    return { asset, file };
  }

  /** 追加到末尾时的排序值 */
  protected async nextOrder(model: { count: (args: { where: Record<string, unknown> }) => Promise<number> }, where: Record<string, unknown>) {
    return model.count({ where });
  }
}
