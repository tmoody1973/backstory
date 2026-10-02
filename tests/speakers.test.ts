import { describe, expect, it } from "vitest";
import { internal } from "../convex/_generated/api";
import { makeTest, saveRun, seedStory } from "./helpers";

describe("speakers", () => {
  it("lists the people from the story's latest run as speaker candidates", async () => {
    const t = makeTest();
    const storyId = await seedStory(t, { stage: "transcribed" });
    await saveRun(t, storyId, "run-1");
    expect(await t.query(internal.speakers.peopleFor, { storyId })).toEqual(["Joe Sasto"]);
  });

  it("saves suggestions and replaces earlier suggestions on a re-run", async () => {
    const t = makeTest();
    const storyId = await seedStory(t);
    await t.mutation(internal.speakers.saveSuggestions, { storyId, suggestions: [{ label: "spk_0", name: "Tarik Moody", confidence: 0.9 }] });
    await t.mutation(internal.speakers.saveSuggestions, { storyId, suggestions: [{ label: "spk_1", name: "Ann Christensen", confidence: 0.8 }] });
    const rows = await t.run((ctx) => ctx.db.query("speakerNames").collect());
    expect(rows.map(({ label, name, source }) => ({ label, name, source }))).toEqual([
      { label: "spk_1", name: "Ann Christensen", source: "suggested" },
    ]);
  });

  it("never overwrites a name an editor confirmed", async () => {
    const t = makeTest();
    const storyId = await seedStory(t);
    await t.run((ctx) => ctx.db.insert("speakerNames", { storyId, label: "spk_0", name: "Ann Christensen", source: "editor" }));
    await t.mutation(internal.speakers.saveSuggestions, { storyId, suggestions: [{ label: "spk_0", name: "Tarik Moody", confidence: 0.9 }] });
    const rows = await t.run((ctx) => ctx.db.query("speakerNames").collect());
    expect(rows.map(({ label, name, source }) => ({ label, name, source }))).toEqual([
      { label: "spk_0", name: "Ann Christensen", source: "editor" },
    ]);
  });
});
