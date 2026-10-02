import { describe, expect, it } from "vitest";
import { internal } from "../convex/_generated/api";
import { parseEpisode, type CdsDocument } from "../convex/lib/cds";
import fixture from "./fixtures/cds-this-bites-episode.json";
import { makeTest } from "./helpers";

const episode = parseEpisode(fixture as CdsDocument)!;

describe("stories.upsertEpisode", () => {
  it("creates a pending story, records its CDS source, and queues one transcription", async () => {
    const t = makeTest();
    const { storyId, created } = await t.mutation(internal.stories.upsertEpisode, { showSlug: "this-bites", ...episode });
    expect(created).toBe(true);
    const state = await t.run(async (ctx) => ({
      story: await ctx.db.get("stories", storyId),
      sources: await ctx.db.query("sources").collect(),
      jobs: await ctx.db.query("jobs").collect(),
    }));
    expect(state.story).toMatchObject({ stage: "ingested", reviewStatus: "pending", doNotUse: false, contentType: "episode" });
    expect(state.sources).toMatchObject([{ kind: "cds_document", ref: `https://content.api.npr.org/v1/documents/${episode.cdsId}` }]);
    expect(state.jobs).toMatchObject([{ kind: "transcribe", status: "queued" }]);
  });

  it("re-ingesting the same episode is a no-op apart from refreshed text", async () => {
    const t = makeTest();
    await t.mutation(internal.stories.upsertEpisode, { showSlug: "this-bites", ...episode });
    const again = await t.mutation(internal.stories.upsertEpisode, { showSlug: "this-bites", ...episode, title: "Corrected title" });
    expect(again.created).toBe(false);
    const state = await t.run(async (ctx) => ({
      stories: await ctx.db.query("stories").collect(),
      jobs: await ctx.db.query("jobs").collect(),
    }));
    expect(state.stories).toHaveLength(1);
    expect(state.stories[0].title).toBe("Corrected title");
    expect(state.jobs).toHaveLength(1);
  });
});
