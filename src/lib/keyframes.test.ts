import { describe, expect, it } from "vitest";
import { orderKeyframes, segmentsOf, videoRouteOf } from "./keyframes";

describe("videoRouteOf", () => {
  it("直出镜头一律 i2v", () => {
    expect(videoRouteOf({ frameMode: "text_only", frameId: null, keyframes: [{ at: -1, assetId: "a" }] })).toBe("i2v");
  });
  it("只有首帧 → i2v", () => {
    expect(videoRouteOf({ frameMode: "image", frameId: "f", keyframes: [] })).toBe("i2v");
  });
  it("只有已出图的尾帧 → flf；没出图的尾帧不算", () => {
    expect(videoRouteOf({ frameMode: "image", frameId: "f", keyframes: [{ at: -1, assetId: "e" }] })).toBe("flf");
    expect(videoRouteOf({ frameMode: "image", frameId: "f", keyframes: [{ at: -1, assetId: null }] })).toBe("i2v");
  });
  it("有已出图的中间帧 → segments", () => {
    expect(videoRouteOf({ frameMode: "image", frameId: "f", keyframes: [{ at: 5, assetId: "m" }] })).toBe("segments");
  });
});

describe("orderKeyframes / segmentsOf", () => {
  it("按时间排序，尾帧排最后", () => {
    const ordered = orderKeyframes([{ at: -1 }, { at: 8 }, { at: 3 }]);
    expect(ordered.map((k) => k.at)).toEqual([3, 8, -1]);
  });
  it("中间帧把镜头切成首尾相接的段", () => {
    const segs = segmentsOf([{ at: 5, assetId: "m" }, { at: -1, assetId: "e" }], 12);
    expect(segs.length).toBe(2);
    const total = segs.reduce((a, s) => a + (s.end - s.start), 0);
    expect(total).toBe(12);
    expect(segs[0].start).toBe(0);
    expect(segs[segs.length - 1].end).toBe(12);
  });
});
