import { describe, expect, it } from "vitest";
import { buildAss, buildGalgameAss, resolveTrim, wrapCjk } from "./ffmpeg";

describe("wrapCjk", () => {
  it("短句不断", () => {
    expect(wrapCjk("短句", 10)).toEqual(["短句"]);
  });
  it("优先在标点后断行，且每行不超上限", () => {
    const lines = wrapCjk("第一段很长的话，第二段也很长的话，第三段。", 12);
    // 标点允许悬挂在行尾：最多比上限多出那一个标点
    expect(lines.every((l) => l.length <= 12 || (l.length === 13 && /[，。！？、；：]$/.test(l)))).toBe(true);
    expect(lines[0].endsWith("，")).toBe(true);
    expect(lines.join("")).toBe("第一段很长的话，第二段也很长的话，第三段。");
  });
  it("没有标点就硬断", () => {
    const lines = wrapCjk("一二三四五六七八九十一二", 5);
    expect(lines).toEqual(["一二三四五", "六七八九十", "一二"]);
  });
});

describe("resolveTrim", () => {
  it("入点出点夹在时长内", () => {
    expect(resolveTrim(10, 2, 8)).toEqual({ start: 2, end: 8, len: 6 });
    expect(resolveTrim(10, -3, null)).toEqual({ start: 0, end: 10, len: 10 });
    expect(resolveTrim(10, 4, 4.1)).toEqual({ start: 4, end: 10, len: 6 });
  });
});

describe("buildAss", () => {
  it("有对齐时间的按时间出条，落在段外的丢弃", () => {
    const ass = buildAss([{ offset: 10, len: 5, lines: ["甲", "乙"], cues: [{ text: "甲", start: 0.5, end: 2 }, { text: "乙", start: 2.5, end: 4 }, { text: "丙", start: 4.9, end: 5 }] }], { fontName: "F", width: 1920, height: 1080 });
    const events = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(events.length).toBe(2);
    expect(events[0]).toContain("0:00:10.50,0:00:12.00");
    expect(events[1]).toContain("乙");
  });
  it("没有对齐时间的按字数比例铺满，并按句拆条", () => {
    const ass = buildAss([{ offset: 0, len: 6, lines: ["第一句。第二句更长一些。"] }], { fontName: "F", width: 1080, height: 1920 });
    const events = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(events.length).toBe(2);
  });
  it("片尾字卡逐行错开", () => {
    const ass = buildAss([], { fontName: "F", width: 1080, height: 1920, endCard: { at: 30, seconds: 4, lines: ["大字", "小字"] } });
    const events = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(events.length).toBe(2);
    expect(events[0]).toContain("EndBig");
    expect(events[1]).toContain("EndSmall");
  });
});

describe("buildGalgameAss", () => {
  const opts = { fontName: "F", width: 1920, height: 1080 };
  it("台词有名牌、逐字卡拉 OK 标签数等于字数", () => {
    const ass = buildGalgameAss([{ kind: "line", name: "楚薇薇", pieces: [{ text: "你压到我头发了。", start: 0, end: 2 }] }], opts);
    expect(ass).toContain("楚薇薇");
    const text = ass.split("\n").find((l) => l.includes(",Text,"))!;
    const ks = text.match(/\{\\k\d+\}/g) ?? [];
    // 从 0 秒开始没有前导停顿，卡拉 OK 标签数正好等于字数
    expect(ks.length).toBe("你压到我头发了。".length);
    expect(ass.split("\n").filter((l) => l.startsWith("Dialogue:")).length).toBe(5);
  });
  it("旁白没有名牌，用 Narr 样式", () => {
    const ass = buildGalgameAss([{ kind: "narration", name: "", pieces: [{ text: "那天上午。", start: 0, end: 2 }] }], opts);
    expect(ass).toContain(",Narr,");
    expect(ass).not.toContain(",Name,");
    expect(ass.split("\n").filter((l) => l.startsWith("Dialogue:")).length).toBe(3);
  });
  it("超过一屏的长旁白分成多屏，屏与屏时间不重叠", () => {
    const long = "一二三四五六七八九十。".repeat(20);
    const ass = buildGalgameAss([{ kind: "narration", name: "", pieces: [{ text: long, start: 0, end: 40 }] }], opts);
    const texts = ass.split("\n").filter((l) => l.includes(",Narr,"));
    expect(texts.length).toBeGreaterThan(1);
    const times = texts.map((l) => l.split(",").slice(1, 3));
    for (let i = 1; i < times.length; i++) expect(times[i][0] >= times[i - 1][0]).toBe(true);
  });
  it("大括号被转义，不会破坏 ASS 标签", () => {
    const ass = buildGalgameAss([{ kind: "line", name: "甲", pieces: [{ text: "a{b}c", start: 0, end: 1 }] }], opts);
    const text = ass.split("\n").find((l) => l.includes(",Text,"))!;
    expect(text).not.toContain("{b}");
    expect(text.replace(/\{\\k\d+\}/g, "")).toContain("(b)");
  });
});
