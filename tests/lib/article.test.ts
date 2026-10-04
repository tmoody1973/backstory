import { describe, expect, it } from "vitest";
import { articleParagraphs, isLyricBlock } from "../../convex/lib/article";
import fixture from "../fixtures/cds-premiere-glitzy.json";

describe("articleParagraphs", () => {
  it("drops italic <br> lyric blocks and keeps the writer's sentences, in layout order", () => {
    const paras = articleParagraphs(fixture as never);
    expect(paras.some((p) => p.includes("Unless I go back"))).toBe(false);
    expect(paras.some((p) => p.includes("Hey what do you call that"))).toBe(false);
    expect(paras).toContain("\"Effort\" falls on the janglier end of Glitzy's spectrum and splits into two soundscapes:");
    expect(paras.at(-1)).toMatch(/release party the same day at Sugar Maple/);
    expect(paras[0]).toMatch(/^Every week, the Milwaukee Music Premiere connects/);
  });
  it("plain paragraphs survive; lists flatten to one line per item", () => {
    const doc = { id: "x", layout: [{ href: "#/assets/a" }], assets: { a: { text: "<ol><li>\"Boxes & Squares\"</li><li>\"Move\"</li></ol>" } } };
    expect(articleParagraphs(doc as never)).toEqual(["\"Boxes & Squares\"", "\"Move\""]);
  });
});

describe("isLyricBlock", () => {
  it("only all-italic, line-broken blocks", () => {
    expect(isLyricBlock("<em>Unless I go back</em><br><em>Say 'sorry, you're right'</em>")).toBe(true);
    expect(isLyricBlock("<em>Every week, the </em><a>Milwaukee Music Premiere</a><em> connects…</em>")).toBe(false);
    expect(isLyricBlock("Plain sentence with <em>an album</em>.")).toBe(false);
  });
});
