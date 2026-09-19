import { describe, expect, it } from "vitest";
import { alignCues, textSimilarity } from "./subtitles";

const words = (s: string, start = 0, step = 0.3) => [...s].map((ch, i) => ({ text: ch, start: start + i * step, end: start + (i + 1) * step }));

describe("alignCues", () => {
  it("每句对到识别出的字的起止时间", () => {
    const cues = alignCues(["你好。", "再见。"], words("你好再见", 1));
    expect(cues.length).toBe(2);
    expect(cues[0].start).toBeLessThan(cues[1].start);
    expect(cues[0].end).toBeLessThanOrEqual(cues[1].start + 0.001);
    expect(cues[1].end).toBeGreaterThan(cues[1].start);
  });
  it("识别错几个字也能定位", () => {
    const cues = alignCues(["顾言，醒醒，你压到我头发了。"], words("故言醒醒你压到我头发了", 2));
    expect(cues.length).toBe(1);
    expect(cues[0].start).toBeCloseTo(2, 0);
  });
  it("没念到的句子按邻句插值，不会消失", () => {
    const cues = alignCues(["第一句。", "完全没念的句子。", "第三句。"], [...words("第一句", 0), ...words("第三句", 5)]);
    expect(cues.length).toBe(3);
    expect(cues[1].start).toBeGreaterThanOrEqual(cues[0].end - 0.5);
    expect(cues[1].end).toBeLessThanOrEqual(cues[2].start + 0.5);
  });
});

describe("textSimilarity", () => {
  it("相同为 1，差异越大越小", () => {
    expect(textSimilarity("你好世界", "你好世界")).toBe(1);
    expect(textSimilarity("你好世界", "完全不同")).toBeLessThan(0.3);
  });
});
