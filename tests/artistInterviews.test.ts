import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import { getShowProfile, onShowPages } from "../convex/lib/shows";
import { makeTest } from "./helpers";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); delete process.env.NPR_CDS_TOKEN; });

const doc = (id: string, url: string, withAudio = true) => ({
  id, title: `Story ${id}`, teaser: "A teaser.", publishDateTime: "2026-10-01T12:01:13-05:00",
  webPages: [{ href: url, rels: ["canonical"] }],
  ...(withAudio ? { audio: [{ href: `#/assets/${id}-a` }], assets: { [`${id}-a`]: { duration: 600, enclosures: [{ href: `https://cpa.ds.npr.org/s921/audio/${id}.mp3`, type: "audio/mpeg" }] } } } : {}),
});

describe("artist interviews", () => {
  it("the profile keeps only radiomilwaukee.org artist-interview pages", () => {
    const profile = getShowProfile("artist-interviews");
    expect(onShowPages(profile, "https://radiomilwaukee.org/discover-music/artist-interviews/2026-10-01/brewers-playoffs-2026-chances-schedule")).toBe(true);
    expect(onShowPages(profile, "https://radiomilwaukee.org/concerts/2026-09-30/milwaukee-concerts-this-week")).toBe(false);
    expect(onShowPages(profile, "https://example.com/discover-music/artist-interviews/x")).toBe(false);
    expect(onShowPages(profile, undefined)).toBe(false);
    expect(onShowPages(getShowProfile("this-bites"), undefined)).toBe(true); // shows without a prefix keep everything
  });

  it("the daily import from the general feed creates interviews only", async () => {
    process.env.NPR_CDS_TOKEN = "token";
    const resources = [
      doc("g-1", "https://radiomilwaukee.org/discover-music/artist-interviews/2026-10-01/levering"),
      doc("g-2", "https://radiomilwaukee.org/concerts/2026-09-30/this-week"),
      doc("g-3", "https://radiomilwaukee.org/discover-music/artist-interviews/2026-09-16/hoyes"),
      doc("g-4", "https://radiomilwaukee.org/discover-music/artist-interviews/2026-09-10/no-audio", false),
    ];
    const fetch = vi.fn(async (url: string) => (url.includes("/documents?") ? new Response(JSON.stringify({ resources })) : new Response("nf", { status: 404 })));
    vi.stubGlobal("fetch", fetch);
    const t = makeTest();
    const { created } = await t.action(internal.ingest.ingestShow, { showSlug: "artist-interviews", limit: 50 });
    expect(created).toBe(2);
    const stories = await t.run((ctx) => ctx.db.query("stories").collect());
    expect(stories.map((s) => s.cdsId).sort()).toEqual(["g-1", "g-3"]);
    expect(stories.every((s) => s.showSlug === "artist-interviews")).toBe(true);
    expect(String(fetch.mock.calls.find((c) => String(c[0]).includes("/documents?"))?.[0])).toContain("collectionIds=319418027");
  });
});
