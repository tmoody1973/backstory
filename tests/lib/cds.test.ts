import { describe, expect, it, vi } from "vitest";
import { buildShowQueryUrl, fetchCds, parseEpisode, stripHtml, type CdsDocument } from "../../convex/lib/cds";
import fixture from "../fixtures/cds-this-bites-episode.json";

const doc = fixture as CdsDocument;

describe("buildShowQueryUrl", () => {
  it("asks for podcast episodes in the show's channel, newest first", () => {
    const url = new URL(buildShowQueryUrl("718413877", 10));
    expect(url.origin + url.pathname).toBe("https://content.api.npr.org/v1/documents");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      collectionIds: "718413877", profileIds: "podcast-episode", sort: "publishDateTime:desc", limit: "10",
    });
  });
});

describe("parseEpisode", () => {
  it("reads the fields Backstory needs from a real This Bites document", () => {
    expect(parseEpisode(doc)).toEqual({
      cdsId: "fis-718413877-f1a11b199499737e74c6c94583b15dba",
      title: "Freshwater Food & Wine Festival, Café Corazón and turkey talk",
      teaserText:
        "In this episode's serving of the latest Milwaukee food news and festival highlights: We break down the Freshwater Food & Wine Festival happening on the Summerfest grounds. We bid a bittersweet farewell to Café Corazón in Bay View.",
      publishedAt: Date.UTC(2026, 8, 18, 15),
      audioUrl: "https://dts.podtrac.com/redirect.mp3/dovetail.prxu.org/13397/aa88e568-7b82-41aa-bac6-62a39b740d7c/ThisBites_091826_FullPodcast.mp3",
      durationSec: 999,
      permalink: "https://play.prx.org/listen?ge=prx_13397_aa88e568-7b82-41aa-bac6-62a39b740d7c&uf=https%3A%2F%2Fpublicfeeds.net%2Ff%2F13397%2Fthis-bites",
    });
  });

  it("returns null for a document with no audio to transcribe", () => {
    expect(parseEpisode({ ...doc, audio: [] })).toBeNull();
  });
});

describe("stripHtml", () => {
  it("removes tags and decodes entities", () => {
    expect(stripHtml("<p>Food &amp; Wine&nbsp;<b>Fest</b></p>")).toBe("Food & Wine Fest");
  });
});

describe("fetchCds", () => {
  const ok = { ok: true, status: 200, json: async () => ({ resources: [] }) } as Response;
  const unavailable = { ok: false, status: 503 } as Response;

  it("retries 503s with growing waits, then returns the body", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(unavailable).mockResolvedValueOnce(unavailable).mockResolvedValueOnce(ok);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(fetchCds("https://cds/x", "token", fetchImpl, sleep)).resolves.toEqual({ resources: [] });
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
    expect(fetchImpl).toHaveBeenCalledWith("https://cds/x", { headers: { Authorization: "Bearer token" } });
  });

  it("fails immediately on other errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response);
    await expect(fetchCds("https://cds/x", "token", fetchImpl, vi.fn())).rejects.toThrow("CDS request failed: HTTP 401");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gives up after three retries", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(unavailable);
    await expect(fetchCds("https://cds/x", "token", fetchImpl, vi.fn().mockResolvedValue(undefined))).rejects.toThrow("HTTP 503");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});
