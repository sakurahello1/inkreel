/**
 * BGM 连续段落计算：相邻镜头用同一首曲子时接着上一镜的位置继续取，
 * 换曲（或中间有镜头不配乐）则从曲子开头重新开始。
 *
 * 导出与「把本镜的 BGM 送给视频模型」共用这套规则，区别只在传入的 len：
 *  - 导出：实际视频时长 + 入点出点裁剪后的长度
 *  - 送模型：分镜阶段的计划时长（此时还没有视频）
 */

export interface BgmRunInput {
  id: string;
  bgmTrackId: string | null;
  len: number;
}

export interface BgmPlacement {
  shotId: string;
  trackId: string;
  /** 从曲子的第几秒开始取 */
  trackStart: number;
  /** 铺到成片时间线的第几秒 */
  at: number;
  len: number;
  /** 是否是这一段连续 BGM 的开头 / 结尾 */
  isRunStart: boolean;
  isRunEnd: boolean;
}

export function computeBgmPlacements(shots: BgmRunInput[]): Map<string, BgmPlacement> {
  const out = new Map<string, BgmPlacement>();
  let at = 0;
  let runTrack: string | null = null;
  let runOffset = 0;
  shots.forEach((s, i) => {
    if (s.bgmTrackId) {
      const isRunStart = s.bgmTrackId !== runTrack;
      if (isRunStart) {
        runTrack = s.bgmTrackId;
        runOffset = 0;
      }
      const next = shots[i + 1];
      out.set(s.id, {
        shotId: s.id,
        trackId: s.bgmTrackId,
        trackStart: Math.round(runOffset * 1000) / 1000,
        at: Math.round(at * 1000) / 1000,
        len: Math.round(s.len * 1000) / 1000,
        isRunStart,
        isRunEnd: !next || next.bgmTrackId !== s.bgmTrackId,
      });
      runOffset += s.len;
    } else {
      runTrack = null;
      runOffset = 0;
    }
    at += s.len;
  });
  return out;
}
