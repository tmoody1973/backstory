import { describe, expect, it } from "vitest";
import {
  actionKindValidator, entityTypeValidator, placeCategoryValidator, topicValidator,
} from "../convex/schema";
import { ACTION_KINDS, ENTITY_TYPES, PLACE_CATEGORIES } from "../convex/lib/shows";
import { TOPIC_VALUES } from "../convex/lib/taxonomy";
import { makeTest, seedStory } from "./helpers";

const values = (validator: { members: Array<{ value: unknown }> }) =>
  validator.members.map((member) => member.value);

describe("schema", () => {
  it("keeps its literal lists in sync with the shared vocabularies", () => {
    expect(values(topicValidator)).toEqual([...TOPIC_VALUES]);
    expect(values(entityTypeValidator)).toEqual([...ENTITY_TYPES]);
    expect(values(placeCategoryValidator)).toEqual([...PLACE_CATEGORIES]);
    expect(values(actionKindValidator)).toEqual([...ACTION_KINDS]);
  });

  it("stores a new story as pending and usable", async () => {
    const t = makeTest();
    const storyId = await seedStory(t);
    const story = await t.run((ctx) => ctx.db.get("stories", storyId));
    expect(story?.reviewStatus).toBe("pending");
    expect(story?.doNotUse).toBe(false);
  });
});
