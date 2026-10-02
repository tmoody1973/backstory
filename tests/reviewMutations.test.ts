import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import type { Doc } from "../convex/_generated/dataModel";
import { makeTest, saveRun, seedStory, type TestConvex } from "./helpers";

const REVIEWER = { email: "tarik@radiomilwaukee.org", emailVerified: true, subject: "user_1", issuer: "https://clerk.test" };
const SUMMARY = "The hosts preview the Freshwater Food & Wine Festival.";

beforeEach(() => {
  process.env.BACKSTORY_REVIEWER_EMAILS = "tarik@radiomilwaukee.org";
});
afterEach(() => {
  delete process.env.BACKSTORY_REVIEWER_EMAILS;
});

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return error instanceof ConvexError ? (error.data as { code: string }).code : String(error);
  }
}

/** Saving a run sets stage "extracted"; the geocode step then sets "geocoded". */
async function ready(t: TestConvex) {
  const storyId = await seedStory(t);
  await saveRun(t, storyId, "run-1");
  await t.run((ctx) => ctx.db.patch("stories", storyId, { stage: "geocoded" }));
  return storyId;
}

type ItemTable = "mentions" | "places" | "storyTopics" | "storyActions";
const rows = <T extends ItemTable>(t: TestConvex, table: T) => t.run((ctx) => ctx.db.query(table).take(100)) as Promise<Doc<T>[]>;

describe("reviewMutations.approveEpisode", () => {
  it("publishes the run: getStory returns it with the editor's summary, and records who approved it", async () => {
    const t = makeTest();
    const storyId = await ready(t);
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.approveEpisode, { storyId, runId: "run-1", summary: `  ${SUMMARY}  ` });
    const story = await t.run((ctx) => ctx.db.get("stories", storyId));
    expect(story).toMatchObject({ reviewStatus: "approved", approvedRunId: "run-1", summary: SUMMARY, approvedBy: "tarik@radiomilwaukee.org" });
    expect((await t.query(api.public.getStory, { storyId }))?.summary).toBe(SUMMARY);
  });

  it("keeps what the editor rejected rejected, and approves the rest", async () => {
    const t = makeTest();
    const storyId = await ready(t);
    const [joe] = (await rows(t, "mentions")).filter((m) => m.name === "Joe Sasto");
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.decideItem, { item: { table: "mentions", id: joe._id }, status: "rejected" });
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.approveEpisode, { storyId, runId: "run-1", summary: SUMMARY });
    const story = await t.query(api.public.getStory, { storyId });
    expect(story?.mentions.map((m) => m.name)).not.toContain("Joe Sasto");
    expect((await rows(t, "storyTopics"))[0].reviewStatus).toBe("approved");
  });

  it("refuses a run that is no longer the latest (stale page)", async () => {
    const t = makeTest();
    const storyId = await ready(t);
    await saveRun(t, storyId, "run-2");
    expect(await codeOf(t.withIdentity(REVIEWER).mutation(api.reviewMutations.approveEpisode, { storyId, runId: "run-1", summary: SUMMARY }))).toBe("stale_run");
    expect((await t.run((ctx) => ctx.db.get("stories", storyId)))?.reviewStatus).toBe("pending");
  });

  it("refuses a run whose map pins are still being found, and writes nothing", async () => {
    const t = makeTest();
    const storyId = await seedStory(t);
    await saveRun(t, storyId, "run-1"); // stage "extracted": geocoding still queued
    expect(await codeOf(t.withIdentity(REVIEWER).mutation(api.reviewMutations.approveEpisode, { storyId, runId: "run-1", summary: SUMMARY }))).toBe("not_ready");
    expect((await t.run((ctx) => ctx.db.get("stories", storyId)))?.reviewStatus).toBe("pending");
    expect((await rows(t, "storyTopics"))[0].reviewStatus).toBe("pending");
  });

  it("refuses a blank or over-long summary and writes nothing", async () => {
    const t = makeTest();
    const storyId = await ready(t);
    for (const summary of ["   ", "x".repeat(1501)]) {
      expect(await codeOf(t.withIdentity(REVIEWER).mutation(api.reviewMutations.approveEpisode, { storyId, runId: "run-1", summary }))).toBe("invalid_summary");
    }
    expect((await rows(t, "storyTopics"))[0].reviewStatus).toBe("pending");
  });

  it("is safe to run twice", async () => {
    const t = makeTest();
    const storyId = await ready(t);
    const args = { storyId, runId: "run-1", summary: SUMMARY };
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.approveEpisode, args);
    expect(await codeOf(t.withIdentity(REVIEWER).mutation(api.reviewMutations.approveEpisode, args))).toBe("ok");
    expect((await t.query(api.public.getStory, { storyId }))?.summary).toBe(SUMMARY);
  });

  it("refuses anyone who is not a reviewer", async () => {
    const t = makeTest();
    const storyId = await ready(t);
    expect(await codeOf(t.mutation(api.reviewMutations.approveEpisode, { storyId, runId: "run-1", summary: SUMMARY }))).toBe("not_signed_in");
  });
});

describe("reviewMutations.decideItem", () => {
  it("rejecting an item in the live run takes it off the air immediately", async () => {
    const t = makeTest();
    const storyId = await ready(t);
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.approveEpisode, { storyId, runId: "run-1", summary: SUMMARY });
    const [action] = await rows(t, "storyActions");
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.decideItem, { item: { table: "storyActions", id: action._id }, status: "rejected" });
    expect((await t.query(api.public.getStory, { storyId }))?.actions).toEqual([]);
  });

  it("refuses a row from a superseded run", async () => {
    const t = makeTest();
    const storyId = await ready(t);
    const [oldTopic] = await rows(t, "storyTopics");
    await saveRun(t, storyId, "run-2");
    expect(await codeOf(t.withIdentity(REVIEWER).mutation(api.reviewMutations.decideItem, { item: { table: "storyTopics", id: oldTopic._id }, status: "approved" }))).toBe("stale_run");
  });
});

describe("reviewMutations.setSpeakerName", () => {
  it("saves an editor's name over a suggestion, and an empty name clears it", async () => {
    const t = makeTest();
    const storyId = await ready(t);
    await t.run((ctx) => ctx.db.insert("speakerNames", { storyId, label: "spk_1", name: "Anne Christensen", confidence: 0.7, source: "suggested" }));
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.setSpeakerName, { storyId, label: "spk_1", name: " Ann Christenson " });
    let names = await t.run((ctx) => ctx.db.query("speakerNames").take(10));
    expect(names).toMatchObject([{ label: "spk_1", name: "Ann Christenson", source: "editor" }]);
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.setSpeakerName, { storyId, label: "spk_1", name: "" });
    names = await t.run((ctx) => ctx.db.query("speakerNames").take(10));
    expect(names).toEqual([]);
  });
});

describe("reviewMutations.setPlaceNeighborhood and setDoNotUse", () => {
  it("sets a neighborhood that getStory then returns", async () => {
    const t = makeTest();
    const storyId = await ready(t);
    const [place] = await rows(t, "places");
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.decideItem, { item: { table: "places", id: place._id }, status: "approved" });
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.setPlaceNeighborhood, { placeId: place._id, neighborhood: "Bay View" });
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.approveEpisode, { storyId, runId: "run-1", summary: SUMMARY });
    expect((await t.query(api.public.getStory, { storyId }))?.places[0].neighborhood).toBe("Bay View");
  });

  it("a story marked do-not-use stays hidden even when approved", async () => {
    const t = makeTest();
    const storyId = await ready(t);
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.setDoNotUse, { target: { table: "stories", id: storyId }, doNotUse: true });
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.approveEpisode, { storyId, runId: "run-1", summary: SUMMARY });
    expect(await t.query(api.public.getStory, { storyId })).toBeNull();
  });
});
