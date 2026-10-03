import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
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

describe("reviewMutations.setReservationUrl", () => {
  it("saves a booking-site link that getStory and the review page return; clearing removes it", async () => {
    const t = makeTest();
    const storyId = await ready(t);
    const [place] = await rows(t, "places");
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.decideItem, { item: { table: "places", id: place._id }, status: "approved" });
    const url = "https://www.opentable.com/r/bread-house-milwaukee";
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.setReservationUrl, { placeId: place._id, url });
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.approveEpisode, { storyId, runId: "run-1", summary: SUMMARY });
    expect((await t.query(api.public.getStory, { storyId }))?.places[0].reservationUrl).toBe(url);
    expect((await t.withIdentity(REVIEWER).query(api.review.episode, { storyId }))?.places[0]).toMatchObject({ reservationUrl: url });
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.setReservationUrl, { placeId: place._id, url: null });
    expect((await t.query(api.public.getStory, { storyId }))?.places[0].reservationUrl).toBeNull();
  });

  it("only booking sites over https, and only reviewers", async () => {
    const t = makeTest();
    await ready(t);
    const [place] = await rows(t, "places");
    for (const url of ["https://evil.example/book", "http://www.opentable.com/r/x", "javascript:alert(1)", "https://opentable.com.evil.example/x"]) {
      await expect(t.withIdentity(REVIEWER).mutation(api.reviewMutations.setReservationUrl, { placeId: place._id, url })).rejects.toThrow(/invalid_reservation_url/);
    }
    for (const url of ["https://resy.com/cities/mke/venues/x", "https://www.exploretock.com/x", "https://www.sevenrooms.com/reservations/x"]) {
      await t.withIdentity(REVIEWER).mutation(api.reviewMutations.setReservationUrl, { placeId: place._id, url });
    }
    await expect(t.mutation(api.reviewMutations.setReservationUrl, { placeId: place._id, url: null })).rejects.toThrow(/not_signed_in/);
  });
});

describe("reviewMutations.savePin (Add location)", () => {
  const PIN = { lat: 43.0, lng: -88.02, label: "8004 W National Ave, West Allis, WI 53214", category: "venue" as const };

  it("turns an organization into a pinned, approved place that getStory returns", async () => {
    const t = makeTest();
    const storyId = await ready(t);
    const [joe] = (await rows(t, "mentions")).filter((m) => m.name === "Joe Sasto");
    await t.run((ctx) => ctx.db.patch("mentions", joe._id, { entityType: "organization" })); // stands in for an organization
    await t.mutation(internal.reviewMutations.savePin, { mentionId: joe._id, ...PIN });
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.approveEpisode, { storyId, runId: "run-1", summary: SUMMARY });
    const place = (await t.query(api.public.getStory, { storyId }))?.places.find((p) => p.name === "Joe Sasto");
    expect(place).toMatchObject({ lat: 43.0, lng: -88.02, category: "venue" });
  });

  it("corrects an existing place's pin instead of adding a second place", async () => {
    const t = makeTest();
    await ready(t);
    const [cafe] = (await rows(t, "mentions")).filter((m) => m.name === "Café Corazón");
    await t.mutation(internal.reviewMutations.savePin, { mentionId: cafe._id, ...PIN, category: "restaurant" });
    const places = await rows(t, "places");
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({ lat: 43.0, geocodeLabel: PIN.label, geocodeConfidence: 1, reviewStatus: "approved" });
  });

  it("refuses a mention from a superseded run", async () => {
    const t = makeTest();
    const storyId = await ready(t);
    const [joe] = (await rows(t, "mentions")).filter((m) => m.name === "Joe Sasto");
    await saveRun(t, storyId, "run-2");
    expect(await codeOf(t.mutation(internal.reviewMutations.savePin, { mentionId: joe._id, ...PIN }))).toBe("stale_run");
  });
});

describe("reviewMutations.renameMention (fix a spelling)", () => {
  it("corrects a person's name, and listeners can find the story by the right spelling", async () => {
    const t = makeTest();
    const storyId = await ready(t);
    const [joe] = (await rows(t, "mentions")).filter((m) => m.name === "Joe Sasto");
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.renameMention, { mentionId: joe._id, name: " Joe Sastoh " });
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.approveEpisode, { storyId, runId: "run-1", summary: SUMMARY });
    expect((await t.query(api.public.getStory, { storyId }))?.mentions.map((m) => m.name)).toContain("Joe Sastoh");
    expect((await t.query(api.public.searchStories, { text: "Sastoh" })).map((r) => r.storyId)).toEqual([storyId]);
  });

  it("renaming a place changes the name listeners hear, over the map's spelling", async () => {
    const t = makeTest();
    const storyId = await ready(t);
    const [cafe] = (await rows(t, "mentions")).filter((m) => m.name === "Café Corazón");
    await t.run(async (ctx) => {
      const place = (await ctx.db.query("places").take(1))[0];
      await ctx.db.patch("places", place._id, { officialName: "Cafe Corazon LLC", geocodeConfidence: 0.9, reviewStatus: "approved" });
    });
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.renameMention, { mentionId: cafe._id, name: "Café Corazón" });
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.approveEpisode, { storyId, runId: "run-1", summary: SUMMARY });
    expect((await t.query(api.public.getStory, { storyId }))?.places[0].name).toBe("Café Corazón");
  });

  it("refuses a blank or over-long name, and non-reviewers", async () => {
    const t = makeTest();
    await ready(t);
    const [joe] = (await rows(t, "mentions")).filter((m) => m.name === "Joe Sasto");
    expect(await codeOf(t.withIdentity(REVIEWER).mutation(api.reviewMutations.renameMention, { mentionId: joe._id, name: "  " }))).toBe("invalid_name");
    expect(await codeOf(t.withIdentity(REVIEWER).mutation(api.reviewMutations.renameMention, { mentionId: joe._id, name: "x".repeat(121) }))).toBe("invalid_name");
    expect(await codeOf(t.mutation(api.reviewMutations.renameMention, { mentionId: joe._id, name: "Joe" }))).toBe("not_signed_in");
  });
});

describe("reviewMutations.decideItem with a reason", () => {
  it("records why an item was removed, and clears the reason when it's kept again", async () => {
    const t = makeTest();
    await ready(t);
    const [topic] = await rows(t, "storyTopics");
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.decideItem, { item: { table: "storyTopics", id: topic._id }, status: "rejected", reason: "sensitive" });
    expect((await rows(t, "storyTopics"))[0]).toMatchObject({ reviewStatus: "rejected", removeReason: "sensitive" });
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.decideItem, { item: { table: "storyTopics", id: topic._id }, status: "approved" });
    expect((await rows(t, "storyTopics"))[0].removeReason).toBeUndefined();
  });

  it("a removal without a reason is recorded as wrong", async () => {
    const t = makeTest();
    await ready(t);
    const [action] = await rows(t, "storyActions");
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.decideItem, { item: { table: "storyActions", id: action._id }, status: "rejected" });
    expect((await rows(t, "storyActions"))[0].removeReason).toBe("wrong");
  });
});

describe("privacy guards on pins and re-processing", () => {
  const PIN = { lat: 43.0, lng: -88.02, label: "8004 W National Ave, West Allis, WI 53214", category: "venue" as const };

  it("refuses to pin a person: a person's location is never published", async () => {
    const t = makeTest();
    await ready(t);
    const [joe] = (await rows(t, "mentions")).filter((m) => m.name === "Joe Sasto");
    expect(await codeOf(t.mutation(internal.reviewMutations.savePin, { mentionId: joe._id, ...PIN }))).toBe("not_locatable");
    expect(await rows(t, "places")).toHaveLength(1); // only the sample restaurant
  });

  it("correcting the location of a removed place keeps it removed", async () => {
    const t = makeTest();
    await ready(t);
    const [place] = await rows(t, "places");
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.decideItem, { item: { table: "places", id: place._id }, status: "rejected", reason: "sensitive" });
    await t.mutation(internal.reviewMutations.savePin, { mentionId: place.mentionId, ...PIN, category: "restaurant" });
    expect((await rows(t, "places"))[0]).toMatchObject({ reviewStatus: "rejected", removeReason: "sensitive", lat: 43.0 });
  });

  it("a 'keep off Alexa' removal carries over when the episode is re-processed", async () => {
    const t = makeTest();
    const storyId = await ready(t);
    const [joe] = (await rows(t, "mentions")).filter((m) => m.name === "Joe Sasto");
    const [place] = await rows(t, "places");
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.decideItem, { item: { table: "mentions", id: joe._id }, status: "rejected", reason: "sensitive" });
    await t.withIdentity(REVIEWER).mutation(api.reviewMutations.decideItem, { item: { table: "places", id: place._id }, status: "rejected", reason: "sensitive" });
    await saveRun(t, storyId, "run-2");
    const newJoe = (await rows(t, "mentions")).find((m) => m.runId === "run-2" && m.name === "Joe Sasto");
    const newPlace = (await rows(t, "places")).find((p) => p.runId === "run-2");
    expect(newJoe).toMatchObject({ reviewStatus: "rejected", removeReason: "sensitive" });
    expect(newPlace).toMatchObject({ reviewStatus: "rejected", removeReason: "sensitive" });
    // a removal for being wrong is not carried: the new run may have fixed it
    expect((await rows(t, "storyTopics")).find((r) => r.runId === "run-2")?.reviewStatus).toBe("pending");
  });
});
