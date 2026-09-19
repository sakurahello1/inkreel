import { describe, expect, it } from "vitest";
import { CHARS_PER_SECOND, EXPRESSIONS, PAGE_GAP, PAGE_LEAD, PAGE_TAIL, estimatePageSeconds } from "./narrated";

describe("estimatePageSeconds", () => {
  it("空页给最短占位", () => {
    expect(estimatePageSeconds("", [])).toBe(3);
    expect(estimatePageSeconds("  ", ["", " "])).toBe(3);
  });
  it("按字数、条间停顿、页首页尾留白估算并取整", () => {
    const narration = "一".repeat(42);
    const lines = ["二".repeat(21)];
    const expected = Math.round(PAGE_LEAD + 42 / CHARS_PER_SECOND + 21 / CHARS_PER_SECOND + PAGE_GAP + PAGE_TAIL);
    expect(estimatePageSeconds(narration, lines)).toBe(expected);
  });
  it("最少两秒", () => {
    expect(estimatePageSeconds("嗯", [])).toBeGreaterThanOrEqual(2);
  });
});

describe("EXPRESSIONS", () => {
  it("包含默认表情平静且不重复", () => {
    expect(EXPRESSIONS).toContain("平静");
    expect(new Set(EXPRESSIONS).size).toBe(EXPRESSIONS.length);
  });
});
