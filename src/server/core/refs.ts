import { readAsset } from "../storage";
import type { ImageRef } from "../providers/image";

type AssetLike = { path: string; mime: string } | null | undefined;

/**
 * 参考图装配器。
 *
 * 四个出图任务都要干同一件事：按固定顺序往请求里塞参考图，并同步维护一份
 * 人类可读的名字列表（提示词里那句「参考图依次为：…」靠它）。图和名字必须
 * 严格同序，以前是两个数组手动 push，很容易在改动时错位——这里锁死在一起。
 *
 * gpt-image-2 最多收 16 张，实际用不到那么多；上限由调用方通过 limit 控制。
 */
export class RefBuilder {
  private readonly refs: ImageRef[] = [];
  private readonly names: string[] = [];

  constructor(private readonly max = 9) {}

  /** 还能再放几张 */
  get room() {
    return Math.max(0, this.max - this.refs.length);
  }

  get size() {
    return this.refs.length;
  }

  /** 加一张。asset 为空或已满则静默跳过，返回是否真的加了 */
  async add(asset: AssetLike, opts: { fileName: string; label: string }) {
    if (!asset || this.room === 0) return false;
    this.refs.push({ buffer: await readAsset(asset.path), mime: asset.mime, name: opts.fileName });
    this.names.push(opts.label);
    return true;
  }

  /** 直接塞一张内存里的图。用于临时截出来、不打算落成资产的图，比如上一镜成片的末帧 */
  addBuffer(buffer: Buffer, mime: string, opts: { fileName: string; label: string }) {
    if (this.room === 0) return false;
    this.refs.push({ buffer, mime, name: opts.fileName });
    this.names.push(opts.label);
    return true;
  }

  /** 批量加，按传入顺序 */
  async addAll<T>(items: T[], pick: (item: T) => { asset: AssetLike; fileName: string; label: string }) {
    for (const it of items) {
      if (this.room === 0) break;
      const { asset, fileName, label } = pick(it);
      await this.add(asset, { fileName, label });
    }
    return this;
  }

  /** 画风参考图。放在最后，因为它只影响观感，不决定人物身份 */
  async addStyleRefs(styleRefs: Array<{ asset: { path: string; mime: string } }>, limit: number) {
    return this.addAll(styleRefs.slice(0, limit), (sr) => ({ asset: sr.asset, fileName: "style.png", label: "画风参考" }));
  }

  build() {
    return { refs: this.refs, names: this.names };
  }
}
