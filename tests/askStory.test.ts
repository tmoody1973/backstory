import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { blockedNames, mentionsBlocked, trimPassage } from "../convex/lib/askStory";
import { makeTest, saveRun, seedStory, type TestConvex } from "./helpers";

const REVIEWER = { email: "tarik@radiomilwaukee.org", emailVerified: true, subject: "u", issuer: "https://clerk.test" };
beforeEach(() => {
  process.env.BACKSTORY_REVIEWER_EMAILS = "tarik@radiomilwaukee.org";
});
afterEach(() => {
  delete process.env.BACKSTORY_REVIEWER_EMAILS;
});

const STROMBOLI = "Honestly the stromboli at Bread House is the deal of the year.";

async function published(t: TestConvex, overrides = {}) {
  const storyId = await seedStory(t, overrides);
  await saveRun(t, storyId, "run-1");
  await t.run(async (ctx) => {
    await ctx.db.patch("stories", storyId, { stage: "geocoded" });
    for (const p of await ctx.db.query("places").take(10)) await ctx.db.patch("places", p._id, { geocodeConfidence: 0.9, lat: 43, lng: -87.9 });
  });
  await t.withIdentity(REVIEWER).mutation(api.reviewMutations.approveEpisode, { storyId, runId: "run-1", summary: "The hosts preview a festival." });
  return storyId;
}

async function segments(t: TestConvex, storyId: Id<"stories">, rows: { text: string; startMs: number; speaker?: string }[]) {
  await t.run(async (ctx) => {
    const existing = await ctx.db.query("transcriptSegments").withIndex("by_storyId_and_idx", (q) => q.eq("storyId", storyId)).collect();
    let idx = existing.length;
    for (const row of rows) {
      await ctx.db.insert("transcriptSegments", { storyId, idx: idx++, speaker: row.speaker ?? "spk_1", startMs: row.startMs, endMs: row.startMs + 5000, text: row.text });
    }
  });
}

const ask = (t: TestConvex, storyId: string, question: string) => t.query(api.public.askStory, { storyId, question });

describe("public.askStory", () => {
  it("answers a This Bites detail question with the episode's own words and the moment", async () => {
    const t = makeTest();
    const storyId = await published(t);
    await segments(t, storyId, [{ text: STROMBOLI, startMs: 1_122_000 }]);
    expect(await ask(t, storyId, "What did they say about the stromboli?")).toEqual({
      status: "ok",
      passages: [{ text: STROMBOLI, startMs: 1_122_000, speaker: null }],
    });
  });

  it("UM defaults to off; an editor can switch an episode on", async () => {
    const t = makeTest();
    const storyId = await published(t, { showSlug: "uniquely-milwaukee" });
    await segments(t, storyId, [{ text: STROMBOLI, startMs: 1000 }]);
    expect(await ask(t, storyId, "stromboli")).toEqual({ status: "not_allowed", passages: [] });
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.setDetailedAnswers, { storyId, allow: true });
    expect((await ask(t, storyId, "stromboli")).status).toBe("ok");
  });

  it("an editor can switch a This Bites episode off", async () => {
    const t = makeTest();
    const storyId = await published(t);
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.setDetailedAnswers, { storyId, allow: false });
    expect((await ask(t, storyId, "stromboli")).status).toBe("not_allowed");
  });

  it("not found: unpublished, do-not-use, or not a story id", async () => {
    const t = makeTest();
    const pending = await seedStory(t);
    expect((await ask(t, pending, "stromboli")).status).toBe("not_found");
    const off = await published(t, { cdsId: "fis-2" });
    await t.run((ctx) => ctx.db.patch("stories", off, { doNotUse: true }));
    expect((await ask(t, off, "stromboli")).status).toBe("not_found");
    expect((await ask(t, "garbage", "stromboli")).status).toBe("not_found");
  });

  it("never returns a passage naming a rejected person, even as a possessive", async () => {
    const t = makeTest();
    const storyId = await published(t);
    await t.run(async (ctx) => {
      const joe = (await ctx.db.query("mentions").collect()).find((m) => m.name === "Joe Sasto")!;
      await ctx.db.patch("mentions", joe._id, { reviewStatus: "rejected", removeReason: "wrong" });
    });
    await segments(t, storyId, [
      { text: "Joe Sasto's stromboli was the talk of the festival.", startMs: 1000 },
      { text: STROMBOLI, startMs: 2000 },
    ]);
    expect((await ask(t, storyId, "stromboli")).passages.map((p) => p.startMs)).toEqual([2000]);
  });

  it("never returns a passage naming a kept-off-Alexa place, whatever the accents", async () => {
    const t = makeTest();
    const storyId = await published(t);
    await t.run(async (ctx) => {
      for (const table of ["places", "mentions"] as const) {
        for (const row of await ctx.db.query(table).collect()) {
          if (row.name === "Café Corazón") await ctx.db.patch(table, row._id, { reviewStatus: "rejected", removeReason: "sensitive" });
        }
      }
    });
    await segments(t, storyId, [{ text: "The stromboli at Cafe Corazon was great.", startMs: 1000 }]);
    expect((await ask(t, storyId, "stromboli")).passages).toEqual([]);
  });

  it("never returns a passage naming a do-not-use mention", async () => {
    const t = makeTest();
    const storyId = await published(t);
    await t.run(async (ctx) => {
      const joe = (await ctx.db.query("mentions").collect()).find((m) => m.name === "Joe Sasto")!;
      await ctx.db.patch("mentions", joe._id, { doNotUse: true });
    });
    await segments(t, storyId, [{ text: "Joe Sasto makes the stromboli.", startMs: 1000 }]);
    expect((await ask(t, storyId, "stromboli")).passages).toEqual([]);
  });

  it("names the speaker only when an editor confirmed it, and the guard beats the name", async () => {
    const t = makeTest();
    const storyId = await published(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("speakerNames", { storyId, label: "spk_1", name: "Ann Christenson", source: "editor" });
      await ctx.db.insert("speakerNames", { storyId, label: "spk_2", name: "Somebody Guessed", source: "suggested" });
      await ctx.db.insert("speakerNames", { storyId, label: "spk_0", name: "Joe Sasto", source: "editor" });
      const joe = (await ctx.db.query("mentions").collect()).find((m) => m.name === "Joe Sasto")!;
      await ctx.db.patch("mentions", joe._id, { reviewStatus: "rejected", removeReason: "sensitive" });
    });
    await segments(t, storyId, [
      { text: "The stromboli is wonderful.", startMs: 1000, speaker: "spk_1" },
      { text: "I love the stromboli too.", startMs: 2000, speaker: "spk_2" },
      { text: "My stromboli recipe is secret.", startMs: 3000, speaker: "spk_0" },
    ]);
    expect((await ask(t, storyId, "stromboli")).passages).toEqual([
      { text: "The stromboli is wonderful.", startMs: 1000, speaker: "Ann Christenson" },
      { text: "I love the stromboli too.", startMs: 2000, speaker: null },
    ]);
  });

  it("an unrelated question finds nothing; at most 3 passages, in episode order", async () => {
    const t = makeTest();
    const storyId = await published(t);
    await segments(t, storyId, [5000, 1000, 4000, 2000].map((startMs) => ({ text: `More about the stromboli at ${startMs}.`, startMs })));
    expect((await ask(t, storyId, "parking downtown")).passages).toEqual([]);
    const { passages } = await ask(t, storyId, "the stromboli");
    expect(passages).toHaveLength(3);
    expect(passages.map((p) => p.startMs)).toEqual([...passages.map((p) => p.startMs)].sort((a, b) => a - b));
  });
});

describe("setDetailedAnswers", () => {
  it("refuses anyone who isn't a reviewer", async () => {
    const t = makeTest();
    const storyId = await published(t);
    await expect(t.mutation(api.reviewMutations.setDetailedAnswers, { storyId, allow: true })).rejects.toThrow(/not_signed_in/);
  });
});

describe("askStory helpers", () => {
  it("matches blocked names whole-word, normalized, including possessives", () => {
    expect(mentionsBlocked("Joe Sasto's stromboli", ["joe sasto"])).toBe(true);
    expect(mentionsBlocked("Café Corazón", ["cafe corazon"])).toBe(true);
    expect(mentionsBlocked("Joey Sastoro", ["joe sasto"])).toBe(false);
  });
  it("trims a long passage at a sentence boundary", () => {
    const long = `${"A first sentence that goes on for a while. ".repeat(5)}${"x".repeat(200)}`;
    const trimmed = trimPassage(long);
    expect(trimmed.length).toBeLessThanOrEqual(300);
    expect(trimmed.endsWith(".")).toBe(true);
  });
});

describe("askStory guard (review fixes)", () => {
  const rejectJoe = (t: TestConvex) => t.run(async (ctx) => {
    const joe = (await ctx.db.query("mentions").collect()).find((m) => m.name === "Joe Sasto")!;
    await ctx.db.patch("mentions", joe._id, { reviewStatus: "rejected", removeReason: "sensitive" });
  });

  it("blocks a removed person's first name or last name on its own", async () => {
    const t = makeTest();
    const storyId = await published(t);
    await rejectJoe(t);
    await segments(t, storyId, [
      { text: "Joe told me the stromboli is secret.", startMs: 1000 },
      { text: "Mr. Sasto's stromboli recipe.", startMs: 2000 },
      { text: STROMBOLI, startMs: 3000 },
    ]);
    expect((await ask(t, storyId, "stromboli")).passages.map((p) => p.startMs)).toEqual([3000]);
  });

  it("never blocks on a host's name or a short word", () => {
    const blocked = blockedNames([{ name: "Ann Lee", entityType: "person", reviewStatus: "rejected", doNotUse: false }], []);
    expect(blocked).toContain("lee");
    expect(blocked).not.toContain("ann");
  });

  it("still blocks the transcript's spelling after an editor renamed the mention", async () => {
    const t = makeTest();
    const storyId = await published(t);
    const joeId = await t.run(async (ctx) => (await ctx.db.query("mentions").collect()).find((m) => m.name === "Joe Sasto")!._id);
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.renameMention, { mentionId: joeId, name: "Jo Saasto" });
    await t.run((ctx) => ctx.db.patch("mentions", joeId, { reviewStatus: "rejected", removeReason: "sensitive" }));
    await segments(t, storyId, [{ text: "Sasto makes the stromboli.", startMs: 1000 }]);
    expect((await ask(t, storyId, "stromboli")).passages).toEqual([]);
  });

  it("skips a removed person's own words even when their speaker name was only suggested", async () => {
    const t = makeTest();
    const storyId = await published(t);
    await rejectJoe(t);
    await t.run((ctx) => ctx.db.insert("speakerNames", { storyId, label: "spk_3", name: "Joe Sasto", source: "suggested" }));
    await segments(t, storyId, [{ text: "My stromboli recipe is secret.", startMs: 1000, speaker: "spk_3" }]);
    expect((await ask(t, storyId, "stromboli")).passages).toEqual([]);
  });

  it("a removal in a re-processed (not yet republished) run counts right away", async () => {
    const t = makeTest();
    const storyId = await published(t);
    await saveRun(t, storyId, "run-2");
    await t.run(async (ctx) => {
      const joe2 = (await ctx.db.query("mentions").collect()).find((m) => m.name === "Joe Sasto" && m.runId === "run-2")!;
      await ctx.db.patch("mentions", joe2._id, { reviewStatus: "rejected", removeReason: "sensitive" });
    });
    await segments(t, storyId, [{ text: "Joe Sasto and the stromboli.", startMs: 1000 }]);
    expect((await ask(t, storyId, "stromboli")).passages).toEqual([]);
  });

  it("refuses an over-long question and survives a many-word one", async () => {
    const t = makeTest();
    const storyId = await published(t);
    await segments(t, storyId, [{ text: STROMBOLI, startMs: 1000 }]);
    await expect(ask(t, storyId, "x".repeat(501))).rejects.toThrow(/question_too_long/);
    const many = `stromboli ${Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ")}`;
    expect((await ask(t, storyId, many)).status).toBe("ok");
  });
});

