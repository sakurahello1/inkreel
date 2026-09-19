import { describe, expect, it } from "vitest";
import { MAX_CUE_CHARS, chunkByComma, splitCue, splitSentences } from "./cues";

describe("splitSentences", () => {
  it("按句末标点拆句并保留标点", () => {
    expect(splitSentences("你好。再见！真的吗？")).toEqual(["你好。", "再见！", "真的吗？"]);
  });
  it("没有标点整段返回", () => {
    expect(splitSentences("  没有标点的一段 ")).toEqual(["没有标点的一段"]);
  });
});

describe("chunkByComma", () => {
  it("按逗号贪心拼到上限", () => {
    const s = "一二三四五六七八九十，一二三四五六七八九十，一二三四五六七八九十，一二三四五六七八九十。";
    const out = chunkByComma(s, 24);
    expect(out.every((x) => x.length <= 24)).toBe(true);
    expect(out.join("")).toBe(s);
  });
  it("没有逗号原样返回", () => {
    expect(chunkByComma("没有逗号的很长很长的一句话没有逗号的很长很长的一句话", 10)).toEqual(["没有逗号的很长很长的一句话没有逗号的很长很长的一句话"]);
  });
});

describe("splitCue", () => {
  it("短的原样一条", () => {
    expect(splitCue("短句。", 1, 3)).toEqual([{ text: "短句。", start: 1, end: 3 }]);
  });
  it("长段按句切开，时间连续覆盖原区间", () => {
    const text = "2009年12月，临安一中，高三四班。冬日上午的阳光斜穿过窗户，吊扇在天花板上慢慢转着，粉笔灰在光柱里浮动。顾言趴在最后一排的课桌上睡得正沉。";
    const out = splitCue(text, 0.5, 10.5);
    expect(out.length).toBeGreaterThan(2);
    expect(out.every((c) => c.text.length <= MAX_CUE_CHARS)).toBe(true);
    expect(out[0].start).toBe(0.5);
    expect(out[out.length - 1].end).toBeCloseTo(10.5, 6);
    for (let i = 1; i < out.length; i++) expect(out[i].start).toBeCloseTo(out[i - 1].end, 6);
    expect(out.map((c) => c.text).join("")).toBe(text);
  });
  it("字多的句子分到的时间更长", () => {
    const out = splitCue("短。这是一句明显更长更长更长的句子。", 0, 10, 4);
    expect(out[1].end - out[1].start).toBeGreaterThan(out[0].end - out[0].start);
  });
});
