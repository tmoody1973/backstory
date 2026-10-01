# Backstory Plan 1: Core Engine + This Bites + Uniquely Milwaukee — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn new This Bites and Uniquely Milwaukee episodes in NPR CDS into transcribed, evidence-checked, geocoded story data in Convex, readable by the Alexa MCP server only after an editor approves it.

**Architecture:** A daily Convex cron per show asks CDS for the newest This Bites and Uniquely Milwaukee episodes and writes each new one as a pending story. Each story then moves through three background steps, each tracked as a row in a `jobs` table with retries: **transcribe** (download the MP3 → S3 → Amazon Transcribe with speaker labels), **extract** (one Amazon Nova Micro call on Bedrock returns people, places, dishes, topics, actions and a summary, and an automatic evidence check drops anything whose quote is not in the transcript), **geocode** (Amazon Location finds coordinates for each place). Two public Convex queries (`getStory`, `searchStories`) are the contract with the MCP server: they return only rows from the run an editor approved.

**Tech Stack:** TypeScript, Convex (database, scheduler, cron), Vitest + convex-test, zod v4, AWS SDK v3 (`client-s3`, `client-transcribe`, `client-bedrock-runtime`, `client-geo-places`).

**Spec:** `docs/Radio Milwaukee Backstory PRD-2.md` (the PRD) and `docs/Backstory_Review_UI.docx` (review UI, used by Plan 2). Decisions made with Tarik on 2026-10-01 that override the PRD are listed under Global Constraints and written up in Task 10.

**Where this sits:** Plan 1 of 5. Plan 2 = review UI at Field Guide `/admin/backstory` (Clerk-checked review mutations). Plan 3 = the remaining station podcasts (Ladies First first) via show profiles. Plan 4 = music coverage (premieres, Concert Picks, Sessions). Plan 5 = post-hackathon (backfill, coverage dashboard, story map, field locks, edit history).

**Why the tasks run "backwards":** each pipeline step is built before the step that hands work to it (geocode → extract → transcribe → ingest). That way every reference to the next step already exists and the code typechecks after every task.

## Global Constraints

- **No airing log exists** (Tarik, 2026-10-01). No `airings` table, no `find_story_aired`. Do not add them.
- **Every episode is transcribed with Amazon Transcribe** (Tarik, 2026-10-01). CDS carries show notes, never a transcript. Show notes may be passed to the model as spelling hints only and are **never** evidence.
- **Evidence or it's dropped:** every mention, topic and action carries a verbatim quote of at least 4 words that is found in the transcript. 100%, enforced in code, not sampled.
- **Nothing public without approval:** public queries return a row only if its story has `reviewStatus: "approved"`, `doNotUse: false`, and the row belongs to `story.approvedRunId` with `reviewStatus: "approved"` and (mentions) `doNotUse: false`.
- **Topics only from the Field Guide vocabulary:** `music, comedy, sports, festival, family, food-drink, arts, community, other`. At most 3 per story. The model never invents one.
- **Places are public only:** category is one of `restaurant, bar, venue, park, organization`. Never a home address.
- **Opinions stay opinions:** every story returned to the MCP server carries an attribution string ("This Bites, September 2026").
- **CDS:** always pass `sort=publishDateTime:desc` (unsorted results come back oldest first); retry 503s with backoff; Backstory uses its own CDS token (`NPR_CDS_TOKEN`), not a person's.
- **Two shows, one pipeline:** This Bites (CDS `718413877`) and Uniquely Milwaukee (CDS `718414860`) differ only by their profile in `convex/lib/shows.ts`. No show-specific branches in pipeline code.
- **Station audio only:** both shows are station-produced. Never download NPR network audio.
- **Budget:** hackathon volume must fit the $150 AWS credit. 10 episodes per show ≈ 240 minutes of Transcribe ≈ $6.
- **Style:** 2-space TypeScript, camelCase Convex module names (they become API paths), conventional commits.

## Review Focus

1. **Transcribe and the model write the same words differently.** Accents ("Café Corazón" vs "cafe corazon"), curly apostrophes, punctuation, and quotes that cross a speaker turn should all still match; a fabricated or partial-word quote must not. → Task 3 tests.
2. **Re-processing an approved episode.** A second extraction run must not change what listeners hear until an editor approves the new run. → Task 9 test "re-processing keeps the approved run live".
3. **The model returns broken or empty output.** Malformed tool output must never write partial rows; after 3 failed attempts the story is flagged `needs_editor`, and the pipeline doesn't crash. → Task 4 tests (retry → needs_editor), Task 6 test (zod rejects off-vocabulary output).
4. **The daily cron overlaps a manual ingest.** Ingesting the same episode twice must not create a second story or a second transcription bill. → Task 8 test "re-ingesting the same episode is a no-op".
5. **Same-name restaurants and out-of-town matches.** Café Corazón has three locations; geocoding can land in another city. Weak or distant matches must score low (flagged for the editor in Plan 2), never silently pinned. → Task 5 tests.

---

## File Structure

```
backstory/
  package.json, tsconfig.json, vitest.config.ts, .gitignore, .env.example, README.md
  .github/workflows/ci.yml
  convex/
    schema.ts              all tables + exported literal validators
    lib/                   pure logic, no Convex functions, no Node APIs
      taxonomy.ts          topic vocabulary (copied from Field Guide)
      shows.ts             show profiles + entity/place/action vocabularies
      evidence.ts          quote normalization + transcript matching
      steps.ts             step args + runStep (mark running, retry on failure)
      geocode.ts           candidate scoring
      extraction.ts        zod schema, prompt, evidence filter
      transcribeOutput.ts  Transcribe JSON → segments
      cds.ts               CDS URL, document parsing, 503 retry
      attribution.ts       "This Bites, September 2026"
    jobs.ts                enqueue, markDone, retry policy, job mutations
    geocoding.ts           geocode-step queries/mutations
    extractions.ts         extract-step query/mutation (writes a run)
    transcripts.ts         transcribe-step queries/mutations
    stories.ts             upsertEpisode
    ingest.ts              ingestShow action (CDS → stories)
    public.ts              getStory, searchStories  ← the MCP contract
    admin.ts               approveLatestRunForDemo (internal; Plan 2 replaces)
    crons.ts               daily ingest
    aws/                   "use node" actions; thin glue over AWS, verified live in Task 11
      geocode.ts, extract.ts, transcribe.ts
  tests/
    helpers.ts             makeTest, seedStory, SAMPLE_RESULT, saveRun
    fixtures/              segments.ts, cds-this-bites-episode.json, transcribe-output.json
    lib/*.test.ts, *.test.ts
  docs/decisions/001-005, docs/LEARNING-LOG.md
```

**Testing boundary:** everything in `convex/lib/` and every mutation and query is unit-tested. The `convex/aws/` actions only call AWS and then hand their results to tested code. Tests leave them out, and Task 11 checks them against real services.

---

### Task 1: Scaffold the repo and the shared vocabularies

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`
- Create: `convex/lib/taxonomy.ts`, `convex/lib/shows.ts`
- Test: `tests/lib/shows.test.ts`

**Interfaces:**
- Produces: `TOPIC_VALUES`, `Topic`; `ENTITY_TYPES`, `EntityType`, `PLACE_CATEGORIES`, `PlaceCategory`, `ACTION_KINDS`, `ActionKind`, `ShowProfile`, `SHOW_PROFILES`, `getShowProfile(slug: string): ShowProfile`

- [ ] **Step 1: Initialize git, npm, and dependencies**

```bash
cd ~/Projects/backstory
git init -b main
cat > package.json <<'EOF'
{
  "name": "backstory",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "convex dev",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
EOF
npm install convex zod @aws-sdk/client-s3 @aws-sdk/client-transcribe @aws-sdk/client-bedrock-runtime @aws-sdk/client-geo-places
npm install -D typescript vitest convex-test @edge-runtime/vm @types/node
```

Confirm `zod` installed at v4 or later (`npm ls zod`). Task 6 uses `z.toJSONSchema`, which only exists in v4.

- [ ] **Step 2: Create the Convex project (Tarik runs this; it opens a browser login)**

```bash
npx convex dev --once --configure=new
```

Choose a new project named `backstory`. This creates `convex/`, `convex/_generated/`, and `.env.local` (which holds `CONVEX_DEPLOYMENT`). It only touches Tarik's personal dev deployment.

- [ ] **Step 3: Write config files**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true,
    "types": ["vite/client", "node"]
  },
  "include": ["convex", "tests"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime", // convex-test runs functions in Convex's runtime shape
    server: { deps: { inline: ["convex-test"] } },
    include: ["tests/**/*.test.ts"],
  },
});
```

`.gitignore`:
```
node_modules/
.env.local
.DS_Store
coverage/
```

`.env.example` (these are **Convex** environment variables, set with `npx convex env set NAME value`, not a local `.env`):
```
# Backstory's own CDS client token (not a person's)
NPR_CDS_TOKEN=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=us-east-1
# S3 bucket for episode audio and Transcribe output
BACKSTORY_S3_BUCKET=
# Optional: Transcribe custom vocabulary of Milwaukee names
TRANSCRIBE_VOCABULARY_NAME=
# Optional: defaults to us.amazon.nova-micro-v1:0
BEDROCK_MODEL_ID=
```

- [ ] **Step 4: Write the failing test**

`tests/lib/shows.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { getShowProfile } from "../../convex/lib/shows";
import { TOPIC_VALUES } from "../../convex/lib/taxonomy";

describe("show profiles", () => {
  it("returns the This Bites profile with its CDS podcast channel", () => {
    const profile = getShowProfile("this-bites");
    expect(profile.name).toBe("This Bites");
    expect(profile.cdsCollectionId).toBe("718413877");
    expect(profile.entityTypes).toContain("dish");
    expect(profile.actionKinds).toContain("reserve");
  });

  it("returns the Uniquely Milwaukee profile: community stories, no dishes or reservations", () => {
    const profile = getShowProfile("uniquely-milwaukee");
    expect(profile.name).toBe("Uniquely Milwaukee");
    expect(profile.cdsCollectionId).toBe("718414860");
    expect(profile.entityTypes).toEqual(["person", "organization", "place", "event"]);
    expect(profile.actionKinds).toEqual(["visit", "attend", "support", "remember"]);
  });

  it("throws a clear error for an unknown show", () => {
    expect(() => getShowProfile("nope")).toThrow('Unknown show "nope"');
  });
});

describe("topic vocabulary", () => {
  it("matches the Field Guide event categories exactly", () => {
    expect(TOPIC_VALUES).toEqual([
      "music", "comedy", "sports", "festival", "family", "food-drink", "arts", "community", "other",
    ]);
  });
});
```

- [ ] **Step 5: Run it to see it fail**

Run: `npx vitest run tests/lib/shows.test.ts`
Expected: FAIL, cannot resolve `../../convex/lib/shows`.

- [ ] **Step 6: Implement**

`convex/lib/taxonomy.ts`:
```ts
// Copied from mke-field-guide src/enrichment/tag.ts (CATEGORY_VALUES), 2026-10-01.
// Stories and events share one vocabulary so they join without a mapping layer.
// Adding a topic is an editor decision recorded here, never something the model invents.
export const TOPIC_VALUES = [
  "music", "comedy", "sports", "festival", "family", "food-drink", "arts", "community", "other",
] as const;

export type Topic = (typeof TOPIC_VALUES)[number];
```

`convex/lib/shows.ts`:
```ts
export const ENTITY_TYPES = ["person", "organization", "place", "event", "dish"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const PLACE_CATEGORIES = ["restaurant", "bar", "venue", "park", "organization"] as const;
export type PlaceCategory = (typeof PLACE_CATEGORIES)[number];

export const ACTION_KINDS = ["visit", "reserve", "attend", "support", "remember"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export interface ShowProfile {
  slug: string;
  name: string;
  /** CDS podcast-channel collection id. */
  cdsCollectionId: string;
  entityTypes: readonly EntityType[];
  actionKinds: readonly ActionKind[];
  /** Show-specific guidance appended to the extraction prompt. */
  extractionNotes: string;
  reviewer: string;
}

// Adding a show means adding a profile here, not changing pipeline code.
// Ladies First and the other station podcasts are added in Plan 3.
export const SHOW_PROFILES: Readonly<Record<string, ShowProfile>> = {
  "this-bites": {
    slug: "this-bites",
    name: "This Bites",
    cdsCollectionId: "718413877",
    entityTypes: ["person", "organization", "place", "event", "dish"],
    actionKinds: ["visit", "reserve", "attend"],
    extractionNotes:
      "This Bites is a weekly Milwaukee food show. Restaurants, cafes and bars are places with category restaurant or bar; festival grounds are venue. Chefs and owners are people. A dish is a dish mention whose relatedPlace is the restaurant that serves it. Food festivals and pop-ups are events. The hosts' opinions are opinions: never state them as facts in the summary.",
    reviewer: "Tarik Moody",
  },
  "uniquely-milwaukee": {
    slug: "uniquely-milwaukee",
    name: "Uniquely Milwaukee",
    cdsCollectionId: "718414860",
    entityTypes: ["person", "organization", "place", "event"],
    actionKinds: ["visit", "attend", "support", "remember"],
    extractionNotes:
      "Uniquely Milwaukee tells short stories about Milwaukee people, organizations and places. The people in a story are real residents: name them as they introduce themselves, and never record a private individual's home, street address or anything that would locate where they live. Nonprofits, programs, businesses and shops are organizations; give one a place mention too only if the story is set at its public location (category organization, venue or park). The episode host is a person but not the subject. Ignore underwriting and membership credits such as 'supported by our Radio Milwaukee members'. Support actions point to the organization named in the story; remember actions are for stories about history or a person's legacy.",
    // ponytail: reviewer not yet named by the content team (PRD open question); Plan 2 needs a real one
    reviewer: "Uniquely Milwaukee producer (to confirm)",
  },
};

export function getShowProfile(slug: string): ShowProfile {
  const profile = SHOW_PROFILES[slug];
  if (!profile) throw new Error(`Unknown show "${slug}"`);
  return profile;
}
```

- [ ] **Step 7: Run it to see it pass**

Run: `npx vitest run tests/lib/shows.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold backstory with Convex, Vitest and show vocabularies"
```

---

### Task 2: Convex schema and test helpers

**Files:**
- Create: `convex/schema.ts`
- Create: `tests/helpers.ts`
- Test: `tests/schema.test.ts`

**Interfaces:**
- Consumes: vocabularies from Task 1.
- Produces: tables `stories, sources, transcriptSegments, mentions, places, storyTopics, storyActions, jobs`; exported validators `reviewStatusValidator, entityTypeValidator, placeCategoryValidator, actionKindValidator, topicValidator, stageValidator, jobKindValidator, jobStatusValidator`; test helpers `makeTest()`, `seedStory(t, overrides?)`.

Key fields later tasks rely on: `stories.latestRunId` (newest extraction run), `stories.approvedRunId` (the run listeners see), `stories.proposedSummary` vs `stories.summary` (live), `stories.stage`, `reviewStatus` on stories/mentions/places/storyTopics/storyActions, `doNotUse` on stories and mentions (PRD "sensitive stories get a flag"; set by editors in Plan 2).

- [ ] **Step 1: Write the failing test**

`tests/schema.test.ts`:
```ts
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
    const story = await t.run((ctx) => ctx.db.get(storyId));
    expect(story?.reviewStatus).toBe("pending");
    expect(story?.doNotUse).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/schema.test.ts`
Expected: FAIL, cannot resolve `../convex/schema` / `./helpers`.

- [ ] **Step 3: Write the schema**

`convex/schema.ts`:
```ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Literal lists mirror convex/lib/shows.ts and convex/lib/taxonomy.ts.
// tests/schema.test.ts fails if they drift apart.
export const reviewStatusValidator = v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected"));
export const entityTypeValidator = v.union(
  v.literal("person"), v.literal("organization"), v.literal("place"), v.literal("event"), v.literal("dish"),
);
export const placeCategoryValidator = v.union(
  v.literal("restaurant"), v.literal("bar"), v.literal("venue"), v.literal("park"), v.literal("organization"),
);
export const actionKindValidator = v.union(
  v.literal("visit"), v.literal("reserve"), v.literal("attend"), v.literal("support"), v.literal("remember"),
);
export const topicValidator = v.union(
  v.literal("music"), v.literal("comedy"), v.literal("sports"), v.literal("festival"), v.literal("family"),
  v.literal("food-drink"), v.literal("arts"), v.literal("community"), v.literal("other"),
);
export const stageValidator = v.union(
  v.literal("ingested"), v.literal("transcribing"), v.literal("transcribed"),
  v.literal("extracted"), v.literal("geocoded"), v.literal("needs_editor"),
);
export const jobKindValidator = v.union(v.literal("transcribe"), v.literal("extract"), v.literal("geocode"));
export const jobStatusValidator = v.union(
  v.literal("queued"), v.literal("running"), v.literal("retrying"), v.literal("done"), v.literal("needs_editor"),
);

const quoteFields = { quote: v.string(), startMs: v.number() };

export default defineSchema({
  stories: defineTable({
    cdsId: v.string(),
    showSlug: v.string(),
    contentType: v.literal("episode"), // Plan 4 widens this for premieres, picks and sessions
    title: v.string(),
    teaserText: v.string(), // CDS show notes: spelling hints for the model, never evidence
    publishedAt: v.number(),
    audioUrl: v.string(),
    durationSec: v.number(),
    permalink: v.optional(v.string()),
    stage: stageValidator,
    proposedSummary: v.optional(v.string()), // from the latest extraction run
    summary: v.optional(v.string()), // the approved summary listeners hear
    latestRunId: v.optional(v.string()),
    approvedRunId: v.optional(v.string()),
    reviewStatus: reviewStatusValidator,
    doNotUse: v.boolean(),
  })
    .index("by_cdsId", ["cdsId"])
    .index("by_show_published", ["showSlug", "publishedAt"]),

  sources: defineTable({
    storyId: v.id("stories"),
    kind: v.union(v.literal("cds_document"), v.literal("transcript")),
    ref: v.string(),
    fetchedAt: v.number(),
  }).index("by_story", ["storyId"]),

  transcriptSegments: defineTable({
    storyId: v.id("stories"),
    idx: v.number(),
    speaker: v.string(), // Transcribe label (spk_0); editors map to names in Plan 2
    startMs: v.number(),
    endMs: v.number(),
    text: v.string(),
  }).index("by_story_idx", ["storyId", "idx"]),

  mentions: defineTable({
    storyId: v.id("stories"),
    runId: v.string(),
    entityType: entityTypeValidator,
    name: v.string(),
    ...quoteFields,
    speaker: v.string(),
    relatedPlace: v.optional(v.string()), // dish → the restaurant that serves it
    reviewStatus: reviewStatusValidator,
    doNotUse: v.boolean(),
    searchText: v.string(), // normalized name + related place + quote
  })
    .index("by_story_run", ["storyId", "runId"])
    .searchIndex("search_text", { searchField: "searchText", filterFields: ["reviewStatus"] }),

  places: defineTable({
    storyId: v.id("stories"),
    runId: v.string(),
    mentionId: v.id("mentions"),
    name: v.string(),
    category: placeCategoryValidator,
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    geocodeLabel: v.optional(v.string()),
    geocodeConfidence: v.optional(v.number()), // 0–1; unset until the geocode step runs
    neighborhood: v.optional(v.string()), // set by editors in Plan 2
    fieldGuideVenueId: v.optional(v.string()), // matched in Plan 2
    lastConfirmedAt: v.optional(v.number()), // restaurant freshness, Plan 5
    reviewStatus: reviewStatusValidator,
  }).index("by_story_run", ["storyId", "runId"]),

  storyTopics: defineTable({
    storyId: v.id("stories"),
    runId: v.string(),
    topic: topicValidator,
    confidence: v.number(),
    ...quoteFields,
    basis: v.literal("transcript"),
    reviewStatus: reviewStatusValidator,
  }).index("by_story_run", ["storyId", "runId"]),

  storyActions: defineTable({
    storyId: v.id("stories"),
    runId: v.string(),
    kind: actionKindValidator,
    label: v.string(),
    placeMentionId: v.optional(v.id("mentions")),
    ...quoteFields,
    reviewStatus: reviewStatusValidator,
  }).index("by_story_run", ["storyId", "runId"]),

  jobs: defineTable({
    kind: jobKindValidator,
    storyId: v.id("stories"),
    status: jobStatusValidator,
    attempts: v.number(),
    lastError: v.optional(v.string()),
    externalId: v.optional(v.string()), // Transcribe job name
    updatedAt: v.number(),
  }).index("by_story", ["storyId"]),
});
```

- [ ] **Step 4: Write the test helpers**

`tests/helpers.ts`:
```ts
import { convexTest } from "convex-test";
import type { WithoutSystemFields } from "convex/server";
import { vi } from "vitest";
import type { Doc } from "../convex/_generated/dataModel";
import schema from "../convex/schema";

// The convex/aws actions only call live AWS services, so tests never load them.
export const modules = import.meta.glob(["../convex/**/*.*s", "!../convex/aws/**"]);

export function makeTest() {
  vi.useFakeTimers(); // scheduled pipeline steps stay queued instead of firing mid-test
  return convexTest(schema, modules);
}

export type TestConvex = ReturnType<typeof makeTest>;

export async function seedStory(
  t: TestConvex,
  overrides: Partial<WithoutSystemFields<Doc<"stories">>> = {},
) {
  return t.run((ctx) =>
    ctx.db.insert("stories", {
      cdsId: "fis-test-1",
      showSlug: "this-bites",
      contentType: "episode",
      title: "Freshwater Food & Wine Festival, Café Corazón and turkey talk",
      teaserText: "We bid a bittersweet farewell to Café Corazón in Bay View.",
      publishedAt: Date.UTC(2026, 8, 18, 15),
      audioUrl: "https://example.com/this-bites.mp3",
      durationSec: 999,
      stage: "ingested",
      reviewStatus: "pending",
      doNotUse: false,
      ...overrides,
    }),
  );
}
```

- [ ] **Step 5: Push the schema and regenerate types**

Run: `npx convex dev --once`
Expected: "Convex functions ready". `convex/_generated/dataModel.d.ts` now has the tables.

- [ ] **Step 6: Run the test to see it pass**

Run: `npx vitest run tests/schema.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add Backstory Convex schema and test helpers"
```

---

### Task 3: The evidence check

This is the engine's trust guarantee. A quote counts only if its words appear in the transcript, in order, as whole words. Case, accents, apostrophes, punctuation and spacing are ignored when comparing.

**Files:**
- Create: `convex/lib/evidence.ts`
- Create: `tests/fixtures/segments.ts`
- Test: `tests/lib/evidence.test.ts`

**Interfaces:**
- Produces: `Segment { speaker: string; startMs: number; endMs: number; text: string }`, `MIN_QUOTE_WORDS = 4`, `normalizeForMatch(text: string): string`, `buildTranscriptIndex(segments: Segment[]): TranscriptIndex`, `findEvidence(index: TranscriptIndex, quote: string): { startMs: number; speaker: string } | null`

- [ ] **Step 1: Write the shared transcript fixture**

`tests/fixtures/segments.ts`:
```ts
import type { Segment } from "../../convex/lib/evidence";

// Shaped like Transcribe output for the 2026-09-18 This Bites episode.
export const TEST_SEGMENTS: Segment[] = [
  { speaker: "spk_0", startMs: 0, endMs: 4000, text: "Welcome back to This Bites." },
  { speaker: "spk_1", startMs: 4000, endMs: 9000, text: "We bid a bittersweet farewell to Café Corazón in Bay View," },
  { speaker: "spk_1", startMs: 9000, endMs: 14000, text: "but their Riverwest and Brown Deer locations remain open." },
  { speaker: "spk_0", startMs: 14000, endMs: 20000, text: "Ordering a morning milkshake at Ted's is a local tradition." },
  { speaker: "spk_0", startMs: 20000, endMs: 26000, text: "The live cooking battle pits chefs Joe Sasto and Dan Jacobs against each other." },
  { speaker: "spk_1", startMs: 26000, endMs: 32000, text: "Café Colada serves churros and empanadas in Cathedral Square Park." },
];
```

- [ ] **Step 2: Write the failing test**

`tests/lib/evidence.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildTranscriptIndex, findEvidence, normalizeForMatch } from "../../convex/lib/evidence";
import { TEST_SEGMENTS } from "../fixtures/segments";

const index = buildTranscriptIndex(TEST_SEGMENTS);

describe("normalizeForMatch", () => {
  it("drops case, accents, apostrophes and punctuation", () => {
    expect(normalizeForMatch("  Café Corazón — Walker’s Point!  ")).toBe("cafe corazon walkers point");
  });
});

describe("findEvidence", () => {
  it("accepts a verbatim quote and returns where it starts", () => {
    expect(findEvidence(index, "a bittersweet farewell to Café Corazón")).toEqual({ startMs: 4000, speaker: "spk_1" });
  });

  it("accepts the same quote with different spacing, case, punctuation and accents", () => {
    expect(findEvidence(index, "A  bittersweet farewell to cafe corazon!")).toEqual({ startMs: 4000, speaker: "spk_1" });
  });

  it("accepts curly apostrophes", () => {
    expect(findEvidence(index, "a morning milkshake at Ted’s")).toEqual({ startMs: 14000, speaker: "spk_0" });
  });

  it("accepts a quote that runs across two segments", () => {
    expect(findEvidence(index, "Corazón in Bay View, but their Riverwest")).toEqual({ startMs: 4000, speaker: "spk_1" });
  });

  it("rejects a fabricated quote", () => {
    expect(findEvidence(index, "Café Corazón is closing all of its locations")).toBeNull();
  });

  it("rejects a quote that only matches part of a word", () => {
    expect(findEvidence(index, "bittersweet farewell to Café Corazó")).toBeNull();
  });

  it("rejects quotes shorter than four words", () => {
    expect(findEvidence(index, "Café Corazón")).toBeNull();
  });

  it("finds nothing in an empty transcript", () => {
    expect(findEvidence(buildTranscriptIndex([]), "a bittersweet farewell to Café Corazón")).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run tests/lib/evidence.test.ts`
Expected: FAIL, cannot resolve `../../convex/lib/evidence`.

- [ ] **Step 4: Implement**

`convex/lib/evidence.ts`:
```ts
export interface Segment {
  speaker: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface EvidenceMatch {
  startMs: number;
  speaker: string;
}

/** Shorter quotes ("Bay View") match by accident and prove nothing. */
export const MIN_QUOTE_WORDS = 4;

/** Lowercase, strip accents, drop apostrophes, turn every other non-alphanumeric run into one space. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’‘`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface TranscriptIndex {
  text: string;
  starts: Array<{ offset: number; segment: Segment }>;
}

/** One normalized string for the whole transcript, plus where each segment begins in it. */
export function buildTranscriptIndex(segments: Segment[]): TranscriptIndex {
  let text = "";
  const starts: TranscriptIndex["starts"] = [];
  for (const segment of segments) {
    const normalized = normalizeForMatch(segment.text);
    if (!normalized) continue;
    if (text) text += " ";
    starts.push({ offset: text.length, segment });
    text += normalized;
  }
  return { text, starts };
}

/** Where the quote starts in the transcript, or null if it isn't there word for word. */
export function findEvidence(index: TranscriptIndex, quote: string): EvidenceMatch | null {
  const normalized = normalizeForMatch(quote);
  if (normalized.split(" ").length < MIN_QUOTE_WORDS) return null;
  // Padding both sides with spaces forces whole-word matches.
  const offset = ` ${index.text} `.indexOf(` ${normalized} `);
  if (offset === -1) return null;
  let hit = index.starts[0];
  for (const start of index.starts) {
    if (start.offset > offset) break;
    hit = start;
  }
  return { startMs: hit.segment.startMs, speaker: hit.segment.speaker };
}
```

- [ ] **Step 5: Run it to see it pass**

Run: `npx vitest run tests/lib/evidence.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add convex/lib/evidence.ts tests/fixtures/segments.ts tests/lib/evidence.test.ts
git commit -m "feat: add transcript evidence check for extracted quotes"
```

---

### Task 4: Job tracking and retries

Each pipeline step for a story is a `jobs` row. A step that throws is retried after 1, then 4 minutes. On the third failure the job and the story are marked `needs_editor` so a person can look. This mirrors the PRD's "3 attempts, then flagged" and the Field Guide's exponential backoff.

**Files:**
- Create: `convex/lib/steps.ts`
- Create: `convex/jobs.ts`
- Test: `tests/jobs.test.ts`

**Interfaces:**
- Consumes: schema (Task 2).
- Produces:
  - `convex/lib/steps.ts`: `stepArgs` (Convex validator object `{ jobId, storyId }`), `type StepArgs`, `type StepRef = FunctionReference<"action","internal",StepArgs>`, `runStep(ctx: ActionCtx, args: StepArgs, retryWith: StepRef, work: () => Promise<void>): Promise<void>`
  - `convex/jobs.ts`: `MAX_ATTEMPTS = 3`, `retryDelayMs(attempt: number): number`, `enqueue(ctx: MutationCtx, kind: JobKind, storyId: Id<"stories">, step: StepRef): Promise<Id<"jobs">>`, `markDone(ctx: MutationCtx, jobId: Id<"jobs">): Promise<void>`, internal mutations `jobs.markRunning({ jobId })` and `jobs.fail({ jobId, error }) → { retry: boolean; delayMs: number }`

- [ ] **Step 1: Write the failing test**

`tests/jobs.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { internal } from "../convex/_generated/api";
import { retryDelayMs } from "../convex/jobs";
import { makeTest, seedStory, type TestConvex } from "./helpers";

async function seedJob(t: TestConvex, attempts = 0) {
  const storyId = await seedStory(t);
  const jobId = await t.run((ctx) =>
    ctx.db.insert("jobs", { kind: "extract", storyId, status: "running", attempts, updatedAt: 0 }),
  );
  return { storyId, jobId };
}

describe("retryDelayMs", () => {
  it("waits 1, 4, then 16 minutes", () => {
    expect([1, 2, 3].map(retryDelayMs)).toEqual([60_000, 240_000, 960_000]);
  });
});

describe("jobs.fail", () => {
  it("schedules a retry after the first failure", async () => {
    const t = makeTest();
    const { jobId } = await seedJob(t);
    const result = await t.mutation(internal.jobs.fail, { jobId, error: "Bedrock throttled" });
    expect(result).toEqual({ retry: true, delayMs: 60_000 });
    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job).toMatchObject({ status: "retrying", attempts: 1, lastError: "Bedrock throttled" });
  });

  it("hands the story to an editor after the third failure", async () => {
    const t = makeTest();
    const { jobId, storyId } = await seedJob(t, 2);
    const result = await t.mutation(internal.jobs.fail, { jobId, error: "model returned no tool call" });
    expect(result.retry).toBe(false);
    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({ status: "needs_editor", attempts: 3 });
    expect((await t.run((ctx) => ctx.db.get(storyId)))?.stage).toBe("needs_editor");
  });
});

describe("jobs.markRunning", () => {
  it("marks a queued job running", async () => {
    const t = makeTest();
    const { jobId } = await seedJob(t);
    await t.mutation(internal.jobs.markRunning, { jobId });
    expect((await t.run((ctx) => ctx.db.get(jobId)))?.status).toBe("running");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/jobs.test.ts`
Expected: FAIL, cannot resolve `../convex/jobs`.

- [ ] **Step 3: Implement the step runner**

`convex/lib/steps.ts`:
```ts
import type { FunctionReference } from "convex/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";

export const stepArgs = { jobId: v.id("jobs"), storyId: v.id("stories") };
export type StepArgs = { jobId: Id<"jobs">; storyId: Id<"stories"> };
export type StepRef = FunctionReference<"action", "internal", StepArgs>;

/**
 * Runs one pipeline step. If `work` throws, the job records the error and, while
 * attempts remain, `retryWith` is scheduled again after the backoff delay.
 * `work` is responsible for marking the job done (inside the mutation that saves its output).
 */
export async function runStep(
  ctx: ActionCtx,
  args: StepArgs,
  retryWith: StepRef,
  work: () => Promise<void>,
): Promise<void> {
  await ctx.runMutation(internal.jobs.markRunning, { jobId: args.jobId });
  try {
    await work();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[backstory] job ${args.jobId} failed: ${message}`);
    const { retry, delayMs } = await ctx.runMutation(internal.jobs.fail, { jobId: args.jobId, error: message });
    if (retry) await ctx.scheduler.runAfter(delayMs, retryWith, args);
  }
}
```

- [ ] **Step 4: Implement the job mutations**

`convex/jobs.ts`:
```ts
import { v, type Infer } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { StepRef } from "./lib/steps";
import type { jobKindValidator } from "./schema";

export type JobKind = Infer<typeof jobKindValidator>;

export const MAX_ATTEMPTS = 3;

/** 1, 4, then 16 minutes: long enough for AWS throttling to clear. */
export function retryDelayMs(attempt: number): number {
  return 60_000 * 4 ** (attempt - 1);
}

/** Records a queued job and schedules its step to run now. */
export async function enqueue(
  ctx: MutationCtx,
  kind: JobKind,
  storyId: Id<"stories">,
  step: StepRef,
): Promise<Id<"jobs">> {
  const jobId = await ctx.db.insert("jobs", { kind, storyId, status: "queued", attempts: 0, updatedAt: Date.now() });
  await ctx.scheduler.runAfter(0, step, { jobId, storyId });
  return jobId;
}

export async function markDone(ctx: MutationCtx, jobId: Id<"jobs">): Promise<void> {
  await ctx.db.patch(jobId, { status: "done", updatedAt: Date.now() });
}

export const markRunning = internalMutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    await ctx.db.patch(jobId, { status: "running", updatedAt: Date.now() });
  },
});

export const fail = internalMutation({
  args: { jobId: v.id("jobs"), error: v.string() },
  handler: async (ctx, { jobId, error }) => {
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    const attempts = job.attempts + 1;
    const retry = attempts < MAX_ATTEMPTS;
    await ctx.db.patch(jobId, {
      attempts,
      lastError: error.slice(0, 2000),
      status: retry ? "retrying" : "needs_editor",
      updatedAt: Date.now(),
    });
    if (!retry) await ctx.db.patch(job.storyId, { stage: "needs_editor" });
    return { retry, delayMs: retry ? retryDelayMs(attempts) : 0 };
  },
});
```

- [ ] **Step 5: Regenerate types and run the test**

Run: `npx convex dev --once && npx vitest run tests/jobs.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add convex/lib/steps.ts convex/jobs.ts tests/jobs.test.ts convex/_generated
git commit -m "feat: add pipeline job tracking with retries and editor hand-off"
```

---

### Task 5: Geocoding

The geocode step looks up each place from the latest extraction run with Amazon Location's text search, biased toward downtown Milwaukee. It scores the best result by how many of the place's name words appear in the result's title, and scores 0 for anything more than 40 km away. Places with no good match are stored with confidence 0 rather than a guessed pin. Plan 2's review screen shows low-confidence places first.

**Files:**
- Create: `convex/lib/geocode.ts`
- Create: `convex/geocoding.ts`
- Create: `convex/aws/geocode.ts`
- Test: `tests/lib/geocode.test.ts`, `tests/geocoding.test.ts`

**Interfaces:**
- Consumes: `normalizeForMatch` (Task 3), `stepArgs`/`runStep` (Task 4), `markDone` (Task 4).
- Produces: `MILWAUKEE_CENTER: [lng, lat]`, `LOW_CONFIDENCE = 0.6`, `GeoCandidate`, `scoreCandidate(name, candidate): number`, `pickBest(name, candidates): { candidate: GeoCandidate; confidence: number } | null`, `isLowConfidence(confidence): boolean`; internal `geocoding.placesToGeocode({ storyId }) → Array<{ placeId; name }>`, `geocoding.savePlaceGeocode({ placeId, lat?, lng?, label?, confidence })`, `geocoding.finish({ jobId, storyId })`; action `internal.aws.geocode.run(stepArgs)`.

- [ ] **Step 1: Write the failing pure test**

`tests/lib/geocode.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { isLowConfidence, pickBest, scoreCandidate, type GeoCandidate } from "../../convex/lib/geocode";

const near = (title: string, distanceM = 3000): GeoCandidate => ({ title, position: [-87.9, 43.03], distanceM });

describe("scoreCandidate", () => {
  it("scores an exact name match nearby as 1", () => {
    expect(scoreCandidate("Café Corazón", near("Cafe Corazon"))).toBe(1);
  });

  it("scores a result that shares only one name word low", () => {
    expect(scoreCandidate("Hong Anh Palace", near("Palace Theater"))).toBeCloseTo(1 / 3);
  });

  it("scores anything more than 40 km from Milwaukee as 0", () => {
    expect(scoreCandidate("Café Corazón", near("Café Corazón", 120_000))).toBe(0);
  });
});

describe("pickBest", () => {
  it("chooses the strongest candidate", () => {
    const best = pickBest("Hong Anh Palace", [near("Palace Theater"), near("Hong Anh Palace Restaurant")]);
    expect(best?.candidate.title).toBe("Hong Anh Palace Restaurant");
    expect(best?.confidence).toBe(1);
  });

  it("returns null when there are no candidates", () => {
    expect(pickBest("Café Corazón", [])).toBeNull();
  });
});

describe("isLowConfidence", () => {
  it("flags weak matches for the editor", () => {
    expect(isLowConfidence(1 / 3)).toBe(true);
    expect(isLowConfidence(1)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/lib/geocode.test.ts`
Expected: FAIL, cannot resolve `../../convex/lib/geocode`.

- [ ] **Step 3: Implement the scoring**

`convex/lib/geocode.ts`:
```ts
import { normalizeForMatch } from "./evidence";

/** [longitude, latitude] of downtown Milwaukee, the order Amazon Location uses. */
export const MILWAUKEE_CENTER: [number, number] = [-87.9065, 43.0389];
export const MAX_DISTANCE_M = 40_000;
export const LOW_CONFIDENCE = 0.6;

// Words too generic to tell two places apart.
const STOP_WORDS = new Set(["the", "and", "of", "a", "cafe", "restaurant", "bar", "grill", "milwaukee"]);

export interface GeoCandidate {
  title: string;
  position: [number, number];
  distanceM?: number;
  label?: string;
}

function nameWords(text: string): Set<string> {
  return new Set(normalizeForMatch(text).split(" ").filter((word) => word && !STOP_WORDS.has(word)));
}

/** Share of the place's distinctive name words found in the result title; 0 if it's out of town. */
// ponytail: word overlap, not fuzzy matching; switch to trigram similarity if misspelled names show up in review
export function scoreCandidate(placeName: string, candidate: GeoCandidate): number {
  if (candidate.distanceM !== undefined && candidate.distanceM > MAX_DISTANCE_M) return 0;
  const want = nameWords(placeName);
  if (want.size === 0) return 0;
  const got = nameWords(candidate.title);
  let found = 0;
  for (const word of want) if (got.has(word)) found++;
  return found / want.size;
}

export function pickBest(
  placeName: string,
  candidates: GeoCandidate[],
): { candidate: GeoCandidate; confidence: number } | null {
  let best: { candidate: GeoCandidate; confidence: number } | null = null;
  for (const candidate of candidates) {
    const confidence = scoreCandidate(placeName, candidate);
    if (!best || confidence > best.confidence) best = { candidate, confidence };
  }
  return best;
}

export function isLowConfidence(confidence: number): boolean {
  return confidence < LOW_CONFIDENCE;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run tests/lib/geocode.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Write the failing Convex test**

`tests/geocoding.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { internal } from "../convex/_generated/api";
import { makeTest, seedStory, type TestConvex } from "./helpers";

async function seedPlace(t: TestConvex, runId = "run-1") {
  const storyId = await seedStory(t, { stage: "extracted", latestRunId: "run-1" });
  return t.run(async (ctx) => {
    const mentionId = await ctx.db.insert("mentions", {
      storyId, runId, entityType: "place", name: "Café Corazón",
      quote: "a bittersweet farewell to Café Corazón in Bay View", startMs: 4000, speaker: "spk_1",
      reviewStatus: "pending", doNotUse: false, searchText: "cafe corazon",
    });
    const placeId = await ctx.db.insert("places", {
      storyId, runId, mentionId, name: "Café Corazón", category: "restaurant", reviewStatus: "pending",
    });
    const jobId = await ctx.db.insert("jobs", { kind: "geocode", storyId, status: "running", attempts: 0, updatedAt: 0 });
    return { storyId, placeId, jobId };
  });
}

describe("geocoding", () => {
  it("lists places from the latest run that have not been geocoded", async () => {
    const t = makeTest();
    const { storyId, placeId } = await seedPlace(t);
    expect(await t.query(internal.geocoding.placesToGeocode, { storyId })).toEqual([{ placeId, name: "Café Corazón" }]);
  });

  it("ignores places from older runs", async () => {
    const t = makeTest();
    const { storyId } = await seedPlace(t, "run-0");
    expect(await t.query(internal.geocoding.placesToGeocode, { storyId })).toEqual([]);
  });

  it("does not retry a place that found no match", async () => {
    const t = makeTest();
    const { storyId, placeId } = await seedPlace(t);
    await t.mutation(internal.geocoding.savePlaceGeocode, { placeId, confidence: 0 });
    expect(await t.query(internal.geocoding.placesToGeocode, { storyId })).toEqual([]);
    expect((await t.run((ctx) => ctx.db.get(placeId)))?.lat).toBeUndefined();
  });

  it("stores coordinates and confidence", async () => {
    const t = makeTest();
    const { placeId } = await seedPlace(t);
    await t.mutation(internal.geocoding.savePlaceGeocode, {
      placeId, lat: 43.0, lng: -87.9, label: "2394 S Kinnickinnic Ave", confidence: 1,
    });
    expect(await t.run((ctx) => ctx.db.get(placeId))).toMatchObject({ lat: 43.0, lng: -87.9, geocodeConfidence: 1 });
  });

  it("finishes the step: story geocoded, job done", async () => {
    const t = makeTest();
    const { storyId, jobId } = await seedPlace(t);
    await t.mutation(internal.geocoding.finish, { jobId, storyId });
    expect((await t.run((ctx) => ctx.db.get(storyId)))?.stage).toBe("geocoded");
    expect((await t.run((ctx) => ctx.db.get(jobId)))?.status).toBe("done");
  });
});
```

- [ ] **Step 6: Implement the Convex functions**

`convex/geocoding.ts`:
```ts
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { markDone } from "./jobs";

export const placesToGeocode = internalQuery({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }) => {
    const story = await ctx.db.get(storyId);
    const runId = story?.latestRunId;
    if (!runId) return [];
    const places = await ctx.db
      .query("places")
      .withIndex("by_story_run", (q) => q.eq("storyId", storyId).eq("runId", runId))
      .collect();
    return places
      .filter((place) => place.geocodeConfidence === undefined)
      .map((place) => ({ placeId: place._id, name: place.name }));
  },
});

export const savePlaceGeocode = internalMutation({
  args: {
    placeId: v.id("places"),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    label: v.optional(v.string()),
    confidence: v.number(),
  },
  handler: async (ctx, { placeId, lat, lng, label, confidence }) => {
    await ctx.db.patch(placeId, { lat, lng, geocodeLabel: label, geocodeConfidence: confidence });
  },
});

export const finish = internalMutation({
  args: { jobId: v.id("jobs"), storyId: v.id("stories") },
  handler: async (ctx, { jobId, storyId }) => {
    await ctx.db.patch(storyId, { stage: "geocoded" });
    await markDone(ctx, jobId);
  },
});
```

`convex/aws/geocode.ts`:
```ts
"use node";

import { GeoPlacesClient, SearchTextCommand } from "@aws-sdk/client-geo-places";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { MILWAUKEE_CENTER, pickBest, type GeoCandidate } from "../lib/geocode";
import { runStep, stepArgs } from "../lib/steps";

export const run = internalAction({
  args: stepArgs,
  handler: async (ctx, args) => {
    await runStep(ctx, args, internal.aws.geocode.run, async () => {
      const client = new GeoPlacesClient({ region: process.env.AWS_REGION });
      const places = await ctx.runQuery(internal.geocoding.placesToGeocode, { storyId: args.storyId });
      for (const place of places) {
        const response = await client.send(
          new SearchTextCommand({
            QueryText: `${place.name}, Milwaukee, WI`,
            BiasPosition: [...MILWAUKEE_CENTER],
            Filter: { IncludeCountries: ["USA"] },
            MaxResults: 5,
            IntendedUse: "Storage", // we keep the coordinates, which this pricing tier allows
          }),
        );
        const candidates: GeoCandidate[] = (response.ResultItems ?? []).flatMap((item) =>
          item.Title && item.Position
            ? [{ title: item.Title, position: [item.Position[0], item.Position[1]], distanceM: item.Distance, label: item.Address?.Label }]
            : [],
        );
        const best = pickBest(place.name, candidates);
        await ctx.runMutation(
          internal.geocoding.savePlaceGeocode,
          best
            ? {
                placeId: place.placeId,
                lng: best.candidate.position[0],
                lat: best.candidate.position[1],
                label: best.candidate.label,
                confidence: best.confidence,
              }
            : { placeId: place.placeId, confidence: 0 },
        );
      }
      await ctx.runMutation(internal.geocoding.finish, args);
    });
  },
});
```

- [ ] **Step 7: Regenerate types and run both tests**

Run: `npx convex dev --once && npx vitest run tests/lib/geocode.test.ts tests/geocoding.test.ts`
Expected: PASS (11 tests). `npx convex dev --once` must report no type errors in `convex/aws/geocode.ts`.

- [ ] **Step 8: Commit**

```bash
git add convex/lib/geocode.ts convex/geocoding.ts convex/aws/geocode.ts tests/lib/geocode.test.ts tests/geocoding.test.ts convex/_generated
git commit -m "feat: geocode extracted places with Amazon Location and confidence scoring"
```

---

### Task 6: Extraction with the evidence filter

One Bedrock call per episode returns a summary plus mentions, topics and actions. Each one must include its quote. The output is checked against a zod schema (anything off-vocabulary fails and the step retries). Then every quote goes through the Task 3 evidence check, and anything unsupported is dropped and logged. The survivors are saved as a new **run** (`runId`). A run is a complete set of rows from one extraction. New runs never touch older ones, which is how an approved story stays live while it's re-processed (Task 9).

**Files:**
- Create: `convex/lib/extraction.ts`
- Create: `convex/extractions.ts`
- Create: `convex/aws/extract.ts`
- Modify: `tests/helpers.ts` (append `SAMPLE_RESULT`, `saveRun`)
- Test: `tests/lib/extraction.test.ts`, `tests/extractions.test.ts`

**Interfaces:**
- Consumes: vocabularies (Task 1), validators (Task 2), `buildTranscriptIndex`/`findEvidence`/`normalizeForMatch`/`MIN_QUOTE_WORDS`/`Segment` (Task 3), `enqueue`/`markDone`/`runStep`/`stepArgs` (Task 4), `internal.aws.geocode.run` (Task 5).
- Produces: `extractionSchema`, `type Extraction`, `extractionJsonSchema()`, `buildExtractionPrompt({ profile, title, teaserText, publishedAt, segments }): string`, `applyEvidence(extraction, index, profile): CheckedExtraction` (`{ summary, mentions, topics, actions, dropped }`); internal `extractions.loadInput({ storyId })`, `extractions.save({ jobId, storyId, runId, result })`; action `internal.aws.extract.run(stepArgs)`.

- [ ] **Step 1: Write the failing pure test**

`tests/lib/extraction.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildTranscriptIndex } from "../../convex/lib/evidence";
import {
  applyEvidence, buildExtractionPrompt, extractionJsonSchema, extractionSchema, type Extraction,
} from "../../convex/lib/extraction";
import { getShowProfile } from "../../convex/lib/shows";
import { TEST_SEGMENTS } from "../fixtures/segments";

const profile = getShowProfile("this-bites");
const index = buildTranscriptIndex(TEST_SEGMENTS);

const raw: Extraction = {
  summary: "The hosts preview a food festival. They say goodbye to one Café Corazón location.",
  mentions: [
    { entityType: "place", name: "Café Corazón", placeCategory: "restaurant", relatedPlace: null, quote: "a bittersweet farewell to Café Corazón in Bay View" },
    { entityType: "dish", name: "churros", placeCategory: null, relatedPlace: "Café Colada", quote: "Café Colada serves churros and empanadas" },
    { entityType: "person", name: "Gordon Ramsay", placeCategory: null, relatedPlace: null, quote: "Gordon Ramsay cooked at the festival" },
    { entityType: "place", name: "Bay View Market", placeCategory: null, relatedPlace: null, quote: "farewell to Café Corazón in Bay View" },
    { entityType: "dish", name: "empanadas", placeCategory: null, relatedPlace: null, quote: "serves churros and empanadas in Cathedral" },
  ],
  topics: [{ topic: "food-drink", confidence: 0.9, quote: "a bittersweet farewell to Café Corazón" }],
  actions: [
    { kind: "visit", label: "Visit Café Corazón in Riverwest", placeName: "Café Corazón", quote: "their Riverwest and Brown Deer locations remain open" },
    { kind: "support", label: "Donate", placeName: null, quote: "their Riverwest and Brown Deer locations remain open" },
    { kind: "attend", label: "Catch the cooking battle", placeName: "Summerfest grounds", quote: "The live cooking battle pits chefs Joe Sasto" },
  ],
};

describe("applyEvidence", () => {
  const checked = applyEvidence(raw, index, profile);

  it("keeps supported mentions and records where their quotes start", () => {
    expect(checked.mentions.map((m) => m.name)).toEqual(["Café Corazón", "churros"]);
    expect(checked.mentions[0]).toMatchObject({ startMs: 4000, speaker: "spk_1" });
  });

  it("drops a mention whose quote is not in the transcript", () => {
    expect(checked.dropped).toContainEqual({ kind: "mention", name: "Gordon Ramsay", reason: "quote not found in transcript" });
  });

  it("drops a place with no category and a dish with no restaurant", () => {
    expect(checked.dropped).toContainEqual({ kind: "mention", name: "Bay View Market", reason: "place without a category" });
    expect(checked.dropped).toContainEqual({ kind: "mention", name: "empanadas", reason: "dish without the place that serves it" });
  });

  it("drops action kinds the show does not use", () => {
    expect(checked.actions.map((a) => a.kind)).toEqual(["visit", "attend"]);
    expect(checked.dropped).toContainEqual({ kind: "action", name: "Donate", reason: "action kind support not in show profile" });
  });

  it("keeps an action's place only if that place survived the check", () => {
    expect(checked.actions[0].placeName).toBe("Café Corazón");
    expect(checked.actions[1].placeName).toBeNull();
  });

  it("keeps supported topics", () => {
    expect(checked.topics).toEqual([
      { topic: "food-drink", confidence: 0.9, quote: "a bittersweet farewell to Café Corazón", startMs: 4000, speaker: "spk_1" },
    ]);
  });
});

describe("applyEvidence with the Uniquely Milwaukee profile", () => {
  it("drops entity types that show does not use", () => {
    const checked = applyEvidence(raw, index, getShowProfile("uniquely-milwaukee"));
    expect(checked.mentions.map((m) => m.name)).toEqual(["Café Corazón"]);
    expect(checked.dropped).toContainEqual({ kind: "mention", name: "churros", reason: "entity type dish not in show profile" });
    expect(checked.actions.map((a) => a.kind)).toEqual(["visit", "support", "attend"]);
  });
});

describe("extractionSchema", () => {
  it("rejects a topic outside the Field Guide vocabulary", () => {
    const bad = { ...raw, topics: [{ topic: "civic-life", confidence: 0.8, quote: "x" }] };
    expect(extractionSchema.safeParse(bad).success).toBe(false);
  });

  it("produces a Bedrock-ready JSON schema without the $schema key", () => {
    const schema = extractionJsonSchema();
    expect(schema).not.toHaveProperty("$schema");
    expect(schema).toHaveProperty(["properties", "summary"]);
  });
});

describe("buildExtractionPrompt", () => {
  const prompt = buildExtractionPrompt({
    profile, title: "Test", teaserText: "Show notes text", publishedAt: Date.UTC(2026, 8, 18), segments: TEST_SEGMENTS,
  });

  it("labels each transcript line with speaker and time", () => {
    expect(prompt).toContain("[spk_1 00:04] We bid a bittersweet farewell to Café Corazón in Bay View,");
  });

  it("forbids quoting the show notes", () => {
    expect(prompt).toContain("SHOW NOTES are for spelling names correctly only. Never quote them.");
    expect(prompt).toContain("Show notes text");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/lib/extraction.test.ts`
Expected: FAIL, cannot resolve `../../convex/lib/extraction`.

- [ ] **Step 3: Implement the pure extraction module**

`convex/lib/extraction.ts`:
```ts
import { z } from "zod";
import { buildTranscriptIndex, findEvidence, MIN_QUOTE_WORDS, normalizeForMatch, type EvidenceMatch, type Segment, type TranscriptIndex } from "./evidence";
import { ACTION_KINDS, ENTITY_TYPES, PLACE_CATEGORIES, type ShowProfile } from "./shows";
import { TOPIC_VALUES } from "./taxonomy";

export const MAX_TOPICS = 3;

export const extractionSchema = z.object({
  summary: z.string().min(1).max(600),
  mentions: z
    .array(
      z.object({
        entityType: z.enum(ENTITY_TYPES),
        name: z.string().min(1),
        quote: z.string(),
        placeCategory: z.enum(PLACE_CATEGORIES).nullable(),
        relatedPlace: z.string().nullable(),
      }),
    )
    .max(40),
  topics: z
    .array(z.object({ topic: z.enum(TOPIC_VALUES), confidence: z.number().min(0).max(1), quote: z.string() }))
    .max(MAX_TOPICS),
  actions: z
    .array(
      z.object({ kind: z.enum(ACTION_KINDS), label: z.string().min(1), placeName: z.string().nullable(), quote: z.string() }),
    )
    .max(10),
});

export type Extraction = z.infer<typeof extractionSchema>;

/** The tool input schema sent to Bedrock, which rejects a top-level $schema key. */
export function extractionJsonSchema(): Record<string, unknown> {
  const { $schema: _unused, ...schema } = z.toJSONSchema(extractionSchema) as Record<string, unknown>;
  return schema;
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function buildExtractionPrompt(input: {
  profile: ShowProfile;
  title: string;
  teaserText: string;
  publishedAt: number;
  segments: Segment[];
}): string {
  const transcript = input.segments
    .map((segment) => `[${segment.speaker} ${formatTimestamp(segment.startMs)}] ${segment.text}`)
    .join("\n");
  return [
    `You extract verified story data from one episode of the Radio Milwaukee podcast "${input.profile.name}".`,
    `Episode: "${input.title}", published ${new Date(input.publishedAt).toISOString().slice(0, 10)}.`,
    "",
    "Rules:",
    `- Every quote must be copied word for word from the TRANSCRIPT: at least ${MIN_QUOTE_WORDS} consecutive words, no paraphrasing. Anything whose quote is not in the transcript is discarded automatically.`,
    "- SHOW NOTES are for spelling names correctly only. Never quote them.",
    `- Allowed mention types: ${input.profile.entityTypes.join(", ")}.`,
    "- Places are public businesses, venues, parks and organizations only, never a private home or home address. Every place needs a placeCategory; use null for anything that is not a place.",
    "- A dish must name the place that serves it in relatedPlace; otherwise leave the dish out.",
    `- Up to ${MAX_TOPICS} topics, only from: ${TOPIC_VALUES.join(", ")}. Each needs a supporting quote.`,
    `- Actions a listener could take, only of kinds: ${input.profile.actionKinds.join(", ")}. Set placeName to the place exactly as named in mentions when the action has one.`,
    "- summary: two sentences describing the episode. It is labeled as a summary, so never present opinions as facts or put words in anyone's mouth.",
    `- ${input.profile.extractionNotes}`,
    "",
    "SHOW NOTES:",
    input.teaserText,
    "",
    "TRANSCRIPT:",
    transcript,
  ].join("\n");
}

export interface Dropped {
  kind: "mention" | "topic" | "action";
  name: string;
  reason: string;
}

type Checked<T> = T & EvidenceMatch;

export interface CheckedExtraction {
  summary: string;
  mentions: Array<Checked<Extraction["mentions"][number]>>;
  topics: Array<Checked<Extraction["topics"][number]>>;
  actions: Array<Checked<Extraction["actions"][number]>>;
  dropped: Dropped[];
}

/** Drops anything the show profile doesn't allow or whose quote isn't in the transcript. */
export function applyEvidence(extraction: Extraction, index: TranscriptIndex, profile: ShowProfile): CheckedExtraction {
  const dropped: Dropped[] = [];
  const drop = (kind: Dropped["kind"], name: string, reason: string) => {
    dropped.push({ kind, name, reason });
    return [];
  };
  const withEvidence = <T extends { quote: string }>(kind: Dropped["kind"], name: string, item: T): Array<Checked<T>> => {
    const match = findEvidence(index, item.quote);
    return match ? [{ ...item, ...match }] : drop(kind, name, "quote not found in transcript");
  };

  const mentions = extraction.mentions.flatMap((mention) => {
    if (!profile.entityTypes.includes(mention.entityType)) {
      return drop("mention", mention.name, `entity type ${mention.entityType} not in show profile`);
    }
    if (mention.entityType === "place" && !mention.placeCategory) return drop("mention", mention.name, "place without a category");
    if (mention.entityType === "dish" && !mention.relatedPlace) {
      return drop("mention", mention.name, "dish without the place that serves it");
    }
    return withEvidence("mention", mention.name, mention);
  });

  const topics = extraction.topics.flatMap((topic) => withEvidence("topic", topic.topic, topic));

  const keptPlaces = new Set(mentions.filter((m) => m.entityType === "place").map((m) => normalizeForMatch(m.name)));
  const actions = extraction.actions.flatMap((action) => {
    if (!profile.actionKinds.includes(action.kind)) {
      return drop("action", action.label, `action kind ${action.kind} not in show profile`);
    }
    const placeName = action.placeName && keptPlaces.has(normalizeForMatch(action.placeName)) ? action.placeName : null;
    return withEvidence("action", action.label, { ...action, placeName });
  });

  return { summary: extraction.summary, mentions, topics, actions, dropped };
}

export { buildTranscriptIndex };
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run tests/lib/extraction.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Append the sample run to the test helpers**

Add to the end of `tests/helpers.ts` (and add `import type { FunctionArgs } from "convex/server";` and `import type { Id } from "../convex/_generated/dataModel";` and `import { internal } from "../convex/_generated/api";` to its imports):
```ts
export type RunResult = FunctionArgs<typeof internal.extractions.save>["result"];

/** A checked extraction whose quotes all exist in tests/fixtures/segments.ts. */
export const SAMPLE_RESULT: RunResult = {
  summary: "The hosts preview the Freshwater Food & Wine Festival. They say goodbye to Café Corazón's Bay View location.",
  mentions: [
    { entityType: "place", name: "Café Corazón", placeCategory: "restaurant", relatedPlace: null, quote: "a bittersweet farewell to Café Corazón in Bay View", startMs: 4000, speaker: "spk_1" },
    { entityType: "person", name: "Joe Sasto", placeCategory: null, relatedPlace: null, quote: "chefs Joe Sasto and Dan Jacobs", startMs: 20000, speaker: "spk_0" },
  ],
  topics: [{ topic: "food-drink", confidence: 0.95, quote: "a bittersweet farewell to Café Corazón", startMs: 4000, speaker: "spk_1" }],
  actions: [
    { kind: "visit", label: "Visit Café Corazón in Riverwest", placeName: "Café Corazón", quote: "their Riverwest and Brown Deer locations remain open", startMs: 9000, speaker: "spk_1" },
  ],
};

/** Saves an extraction run the way the extract step does. */
export async function saveRun(t: TestConvex, storyId: Id<"stories">, runId: string, result: RunResult = SAMPLE_RESULT) {
  const jobId = await t.run((ctx) =>
    ctx.db.insert("jobs", { kind: "extract", storyId, status: "running", attempts: 0, updatedAt: 0 }),
  );
  await t.mutation(internal.extractions.save, { jobId, storyId, runId, result });
  return jobId;
}
```

- [ ] **Step 6: Write the failing Convex test**

`tests/extractions.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { internal } from "../convex/_generated/api";
import { TEST_SEGMENTS } from "./fixtures/segments";
import { makeTest, saveRun, seedStory } from "./helpers";

describe("extractions.loadInput", () => {
  it("returns the story and its transcript in order", async () => {
    const t = makeTest();
    const storyId = await seedStory(t, { stage: "transcribed" });
    await t.run(async (ctx) => {
      for (const [idx, segment] of TEST_SEGMENTS.entries()) await ctx.db.insert("transcriptSegments", { storyId, idx, ...segment });
    });
    const input = await t.query(internal.extractions.loadInput, { storyId });
    expect(input.showSlug).toBe("this-bites");
    expect(input.segments).toEqual(TEST_SEGMENTS);
  });
});

describe("extractions.save", () => {
  it("writes the run as pending rows and links the action to its place", async () => {
    const t = makeTest();
    const storyId = await seedStory(t, { stage: "transcribed" });
    const jobId = await saveRun(t, storyId, "run-1");

    const rows = await t.run(async (ctx) => ({
      story: await ctx.db.get(storyId),
      job: await ctx.db.get(jobId),
      mentions: await ctx.db.query("mentions").collect(),
      places: await ctx.db.query("places").collect(),
      actions: await ctx.db.query("storyActions").collect(),
      topics: await ctx.db.query("storyTopics").collect(),
      jobs: await ctx.db.query("jobs").collect(),
    }));

    expect(rows.story).toMatchObject({ stage: "extracted", latestRunId: "run-1", reviewStatus: "pending" });
    expect(rows.story?.proposedSummary).toContain("Freshwater");
    expect(rows.story?.summary).toBeUndefined();
    expect(rows.job?.status).toBe("done");
    expect(rows.mentions.map((m) => m.reviewStatus)).toEqual(["pending", "pending"]);
    expect(rows.places).toHaveLength(1);
    expect(rows.places[0].mentionId).toBe(rows.mentions[0]._id);
    expect(rows.actions[0].placeMentionId).toBe(rows.mentions[0]._id);
    expect(rows.topics[0]).toMatchObject({ topic: "food-drink", basis: "transcript" });
    expect(rows.jobs.filter((j) => j.kind === "geocode" && j.status === "queued")).toHaveLength(1);
  });

  it("leaves rows from an earlier run untouched", async () => {
    const t = makeTest();
    const storyId = await seedStory(t, { stage: "transcribed" });
    await saveRun(t, storyId, "run-1");
    await saveRun(t, storyId, "run-2");
    const mentions = await t.run((ctx) => ctx.db.query("mentions").collect());
    expect(mentions.map((m) => m.runId)).toEqual(["run-1", "run-1", "run-2", "run-2"]);
    expect((await t.run((ctx) => ctx.db.get(storyId)))?.latestRunId).toBe("run-2");
  });
});
```

- [ ] **Step 7: Implement the Convex functions**

`convex/extractions.ts`:
```ts
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { enqueue, markDone } from "./jobs";
import { normalizeForMatch } from "./lib/evidence";
import { actionKindValidator, entityTypeValidator, placeCategoryValidator, topicValidator } from "./schema";

export const loadInput = internalQuery({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }) => {
    const story = await ctx.db.get(storyId);
    if (!story) throw new Error(`Story ${storyId} not found`);
    const segments = await ctx.db
      .query("transcriptSegments")
      .withIndex("by_story_idx", (q) => q.eq("storyId", storyId))
      .collect();
    return {
      showSlug: story.showSlug,
      title: story.title,
      teaserText: story.teaserText,
      publishedAt: story.publishedAt,
      segments: segments.map(({ speaker, startMs, endMs, text }) => ({ speaker, startMs, endMs, text })),
    };
  },
});

const evidence = { quote: v.string(), startMs: v.number(), speaker: v.string() };

export const save = internalMutation({
  args: {
    jobId: v.id("jobs"),
    storyId: v.id("stories"),
    runId: v.string(),
    result: v.object({
      summary: v.string(),
      mentions: v.array(
        v.object({
          entityType: entityTypeValidator,
          name: v.string(),
          placeCategory: v.union(placeCategoryValidator, v.null()),
          relatedPlace: v.union(v.string(), v.null()),
          ...evidence,
        }),
      ),
      topics: v.array(v.object({ topic: topicValidator, confidence: v.number(), ...evidence })),
      actions: v.array(
        v.object({ kind: actionKindValidator, label: v.string(), placeName: v.union(v.string(), v.null()), ...evidence }),
      ),
    }),
  },
  handler: async (ctx, { jobId, storyId, runId, result }) => {
    const placeMentions = new Map<string, Id<"mentions">>();
    for (const mention of result.mentions) {
      const mentionId = await ctx.db.insert("mentions", {
        storyId,
        runId,
        entityType: mention.entityType,
        name: mention.name,
        quote: mention.quote,
        startMs: mention.startMs,
        speaker: mention.speaker,
        relatedPlace: mention.relatedPlace ?? undefined,
        reviewStatus: "pending",
        doNotUse: false,
        searchText: normalizeForMatch(`${mention.name} ${mention.relatedPlace ?? ""} ${mention.quote}`),
      });
      if (mention.entityType === "place" && mention.placeCategory) {
        placeMentions.set(normalizeForMatch(mention.name), mentionId);
        await ctx.db.insert("places", {
          storyId, runId, mentionId, name: mention.name, category: mention.placeCategory, reviewStatus: "pending",
        });
      }
    }
    for (const { speaker: _speaker, ...topic } of result.topics) {
      await ctx.db.insert("storyTopics", { storyId, runId, ...topic, basis: "transcript", reviewStatus: "pending" });
    }
    for (const action of result.actions) {
      await ctx.db.insert("storyActions", {
        storyId,
        runId,
        kind: action.kind,
        label: action.label,
        placeMentionId: action.placeName ? placeMentions.get(normalizeForMatch(action.placeName)) : undefined,
        quote: action.quote,
        startMs: action.startMs,
        reviewStatus: "pending",
      });
    }
    await ctx.db.patch(storyId, { proposedSummary: result.summary, latestRunId: runId, stage: "extracted" });
    await markDone(ctx, jobId);
    await enqueue(ctx, "geocode", storyId, internal.aws.geocode.run);
  },
});
```

`convex/aws/extract.ts`:
```ts
"use node";

import { BedrockRuntimeClient, ConverseCommand, type ToolInputSchema } from "@aws-sdk/client-bedrock-runtime";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { applyEvidence, buildExtractionPrompt, buildTranscriptIndex, extractionJsonSchema, extractionSchema } from "../lib/extraction";
import { getShowProfile } from "../lib/shows";
import { runStep, stepArgs } from "../lib/steps";

// Cross-region inference profile for Nova Micro. If Bedrock rejects it, check the console's model id for us-east-1.
const DEFAULT_MODEL_ID = "us.amazon.nova-micro-v1:0";
const TOOL_NAME = "record_extraction";

export const run = internalAction({
  args: stepArgs,
  handler: async (ctx, args) => {
    await runStep(ctx, args, internal.aws.extract.run, async () => {
      const input = await ctx.runQuery(internal.extractions.loadInput, { storyId: args.storyId });
      const profile = getShowProfile(input.showSlug);
      const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
      const response = await client.send(
        new ConverseCommand({
          modelId: process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL_ID,
          messages: [{ role: "user", content: [{ text: buildExtractionPrompt({ profile, ...input }) }] }],
          toolConfig: {
            tools: [
              {
                toolSpec: {
                  name: TOOL_NAME,
                  description: "Record the people, places, dishes, topics and actions in this episode, each with its verbatim transcript quote.",
                  inputSchema: { json: extractionJsonSchema() as ToolInputSchema.JsonMember["json"] },
                },
              },
            ],
            // If this model rejects a named tool choice, use { any: {} }: there is only one tool.
            toolChoice: { tool: { name: TOOL_NAME } },
          },
          inferenceConfig: { maxTokens: 4096, temperature: 0 },
        }),
      );
      const toolUse = response.output?.message?.content?.find((block) => block.toolUse)?.toolUse;
      if (!toolUse?.input) throw new Error(`Model returned no ${TOOL_NAME} call (stopReason: ${response.stopReason})`);
      const extraction = extractionSchema.parse(toolUse.input); // throws → retry → needs_editor
      const { dropped, ...result } = applyEvidence(extraction, buildTranscriptIndex(input.segments), profile);
      for (const item of dropped) console.log(`[backstory] ${args.storyId} dropped ${item.kind} "${item.name}": ${item.reason}`);
      await ctx.runMutation(internal.extractions.save, { ...args, runId: `${args.storyId}:${Date.now()}`, result });
    });
  },
});
```

- [ ] **Step 8: Regenerate types and run the tests**

Run: `npx convex dev --once && npx vitest run tests/lib/extraction.test.ts tests/extractions.test.ts`
Expected: PASS (14 tests). No type errors in `convex/aws/extract.ts`.

- [ ] **Step 9: Commit**

```bash
git add convex/lib/extraction.ts convex/extractions.ts convex/aws/extract.ts tests/helpers.ts tests/lib/extraction.test.ts tests/extractions.test.ts convex/_generated
git commit -m "feat: extract evidence-checked mentions, topics and actions with Nova Micro"
```

---

### Task 7: Transcription

The transcribe step downloads the episode MP3 (the CDS link redirects through Podtrac to PRX) and copies it to S3. It then starts an Amazon Transcribe job with speaker labels and checks back every minute. When the job finishes, it saves the transcript as numbered segments and queues extraction.

**Files:**
- Create: `convex/lib/transcribeOutput.ts`
- Create: `convex/transcripts.ts`
- Create: `convex/aws/transcribe.ts`
- Create: `tests/fixtures/transcribe-output.json`
- Test: `tests/lib/transcribeOutput.test.ts`, `tests/transcripts.test.ts`

**Interfaces:**
- Consumes: `Segment` (Task 3), `enqueue`/`markDone`/`runStep`/`stepArgs` (Task 4), `internal.aws.extract.run` (Task 6).
- Produces: `parseTranscribeOutput(json: unknown): Segment[]`; internal `transcripts.audioFor({ storyId }) → { audioUrl }`, `transcripts.jobExternalId({ jobId }) → { externalId }`, `transcripts.markTranscribing({ jobId, storyId, externalId })`, `transcripts.save({ jobId, storyId, ref, segments })`; actions `internal.aws.transcribe.start(stepArgs)`, `internal.aws.transcribe.poll({ ...stepArgs, polls })`.

- [ ] **Step 1: Write the fixture**

This follows the documented Transcribe format when `ShowSpeakerLabels` is on. Task 11 replaces it with a real file and re-runs this test.

`tests/fixtures/transcribe-output.json`:
```json
{
  "jobName": "backstory-test",
  "accountId": "000000000000",
  "status": "COMPLETED",
  "results": {
    "transcripts": [{ "transcript": "Welcome back to This Bites. We bid a bittersweet farewell to Café Corazón in Bay View." }],
    "speaker_labels": { "speakers": 2, "segments": [] },
    "items": [],
    "audio_segments": [
      { "id": 0, "transcript": "Welcome back to This Bites.", "start_time": "0.54", "end_time": "2.1", "speaker_label": "spk_0", "items": [0, 1, 2, 3, 4] },
      { "id": 1, "transcript": "We bid a bittersweet farewell to Café Corazón in Bay View.", "start_time": "2.3", "end_time": "6.85", "speaker_label": "spk_1", "items": [5, 6] },
      { "id": 2, "transcript": "  ", "start_time": "7.0", "end_time": "7.2", "speaker_label": "spk_1", "items": [] }
    ]
  }
}
```

- [ ] **Step 2: Write the failing pure test**

`tests/lib/transcribeOutput.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseTranscribeOutput } from "../../convex/lib/transcribeOutput";
import fixture from "../fixtures/transcribe-output.json";

describe("parseTranscribeOutput", () => {
  it("turns audio segments into speaker-labeled segments in milliseconds", () => {
    expect(parseTranscribeOutput(fixture)).toEqual([
      { speaker: "spk_0", startMs: 540, endMs: 2100, text: "Welcome back to This Bites." },
      { speaker: "spk_1", startMs: 2300, endMs: 6850, text: "We bid a bittersweet farewell to Café Corazón in Bay View." },
    ]);
  });

  it("explains what is wrong when speaker segments are missing", () => {
    expect(() => parseTranscribeOutput({ results: { transcripts: [] } })).toThrow(
      "Transcribe output has no audio_segments; was ShowSpeakerLabels on?",
    );
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run tests/lib/transcribeOutput.test.ts`
Expected: FAIL, cannot resolve `../../convex/lib/transcribeOutput`.

- [ ] **Step 4: Implement the parser**

`convex/lib/transcribeOutput.ts`:
```ts
import type { Segment } from "./evidence";

interface AudioSegment {
  transcript: string;
  start_time: string;
  end_time: string;
  speaker_label?: string;
}

const toMs = (seconds: string) => Math.round(Number.parseFloat(seconds) * 1000);

export function parseTranscribeOutput(json: unknown): Segment[] {
  const segments = (json as { results?: { audio_segments?: AudioSegment[] } })?.results?.audio_segments;
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error("Transcribe output has no audio_segments; was ShowSpeakerLabels on?");
  }
  return segments
    .filter((segment) => segment.transcript.trim())
    .map((segment) => ({
      speaker: segment.speaker_label ?? "spk_0",
      startMs: toMs(segment.start_time),
      endMs: toMs(segment.end_time),
      text: segment.transcript.trim(),
    }));
}
```

Add `"resolveJsonModule": true` to `compilerOptions` in `tsconfig.json` so the fixture import typechecks.

- [ ] **Step 5: Run it to see it pass**

Run: `npx vitest run tests/lib/transcribeOutput.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Write the failing Convex test**

`tests/transcripts.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { internal } from "../convex/_generated/api";
import { TEST_SEGMENTS } from "./fixtures/segments";
import { makeTest, seedStory } from "./helpers";

async function seedTranscribeJob(t: ReturnType<typeof makeTest>) {
  const storyId = await seedStory(t);
  const jobId = await t.run((ctx) =>
    ctx.db.insert("jobs", { kind: "transcribe", storyId, status: "running", attempts: 0, updatedAt: 0 }),
  );
  return { storyId, jobId };
}

describe("transcripts", () => {
  it("records the Transcribe job name and marks the story transcribing", async () => {
    const t = makeTest();
    const { storyId, jobId } = await seedTranscribeJob(t);
    await t.mutation(internal.transcripts.markTranscribing, { jobId, storyId, externalId: "backstory-x-1" });
    expect(await t.query(internal.transcripts.jobExternalId, { jobId })).toEqual({ externalId: "backstory-x-1" });
    expect((await t.run((ctx) => ctx.db.get(storyId)))?.stage).toBe("transcribing");
  });

  it("saves segments in order, records the source, and queues extraction", async () => {
    const t = makeTest();
    const { storyId, jobId } = await seedTranscribeJob(t);
    await t.mutation(internal.transcripts.save, { jobId, storyId, ref: "s3://bucket/transcripts/x.json", segments: TEST_SEGMENTS });
    const state = await t.run(async (ctx) => ({
      story: await ctx.db.get(storyId),
      job: await ctx.db.get(jobId),
      segments: await ctx.db.query("transcriptSegments").withIndex("by_story_idx", (q) => q.eq("storyId", storyId)).collect(),
      sources: await ctx.db.query("sources").collect(),
      jobs: await ctx.db.query("jobs").collect(),
    }));
    expect(state.story?.stage).toBe("transcribed");
    expect(state.job?.status).toBe("done");
    expect(state.segments.map((s) => s.idx)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(state.sources).toMatchObject([{ kind: "transcript", ref: "s3://bucket/transcripts/x.json" }]);
    expect(state.jobs.filter((j) => j.kind === "extract" && j.status === "queued")).toHaveLength(1);
  });

  it("replaces an earlier transcript instead of appending to it", async () => {
    const t = makeTest();
    const { storyId, jobId } = await seedTranscribeJob(t);
    await t.mutation(internal.transcripts.save, { jobId, storyId, ref: "s3://a", segments: TEST_SEGMENTS });
    await t.mutation(internal.transcripts.save, { jobId, storyId, ref: "s3://b", segments: TEST_SEGMENTS.slice(0, 2) });
    const count = (await t.run((ctx) => ctx.db.query("transcriptSegments").collect())).length;
    expect(count).toBe(2);
  });
});
```

- [ ] **Step 7: Implement the Convex functions**

`convex/transcripts.ts`:
```ts
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { enqueue, markDone } from "./jobs";

export const audioFor = internalQuery({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }) => {
    const story = await ctx.db.get(storyId);
    if (!story) throw new Error(`Story ${storyId} not found`);
    return { audioUrl: story.audioUrl };
  },
});

export const jobExternalId = internalQuery({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job?.externalId) throw new Error(`Job ${jobId} has no Transcribe job name`);
    return { externalId: job.externalId };
  },
});

export const markTranscribing = internalMutation({
  args: { jobId: v.id("jobs"), storyId: v.id("stories"), externalId: v.string() },
  handler: async (ctx, { jobId, storyId, externalId }) => {
    await ctx.db.patch(jobId, { externalId, updatedAt: Date.now() });
    await ctx.db.patch(storyId, { stage: "transcribing" });
  },
});

export const save = internalMutation({
  args: {
    jobId: v.id("jobs"),
    storyId: v.id("stories"),
    ref: v.string(),
    segments: v.array(v.object({ speaker: v.string(), startMs: v.number(), endMs: v.number(), text: v.string() })),
  },
  handler: async (ctx, { jobId, storyId, ref, segments }) => {
    const existing = await ctx.db
      .query("transcriptSegments")
      .withIndex("by_story_idx", (q) => q.eq("storyId", storyId))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);
    for (const [idx, segment] of segments.entries()) {
      await ctx.db.insert("transcriptSegments", { storyId, idx, ...segment });
    }
    await ctx.db.insert("sources", { storyId, kind: "transcript", ref, fetchedAt: Date.now() });
    await ctx.db.patch(storyId, { stage: "transcribed" });
    await markDone(ctx, jobId);
    await enqueue(ctx, "extract", storyId, internal.aws.extract.run);
  },
});
```

`convex/aws/transcribe.ts`:
```ts
"use node";

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GetTranscriptionJobCommand, StartTranscriptionJobCommand, TranscribeClient } from "@aws-sdk/client-transcribe";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { runStep, stepArgs } from "../lib/steps";
import { parseTranscribeOutput } from "../lib/transcribeOutput";

const POLL_EVERY_MS = 60_000;
const MAX_POLLS = 90; // a 30-minute episode normally finishes well inside 15

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing Convex env var ${name}`);
  return value;
}

const transcriptKey = (storyId: string) => `transcripts/${storyId}.json`;

export const start = internalAction({
  args: stepArgs,
  handler: async (ctx, args) => {
    await runStep(ctx, args, internal.aws.transcribe.start, async () => {
      const region = requireEnv("AWS_REGION");
      const bucket = requireEnv("BACKSTORY_S3_BUCKET");
      const { audioUrl } = await ctx.runQuery(internal.transcripts.audioFor, { storyId: args.storyId });
      const audio = await fetch(audioUrl); // Podtrac redirects to the PRX file; fetch follows redirects
      if (!audio.ok) throw new Error(`Audio download failed: HTTP ${audio.status} for ${audioUrl}`);
      const audioKey = `audio/${args.storyId}.mp3`;
      await new S3Client({ region }).send(
        new PutObjectCommand({ Bucket: bucket, Key: audioKey, Body: Buffer.from(await audio.arrayBuffer()), ContentType: "audio/mpeg" }),
      );
      const jobName = `backstory-${args.storyId}-${Date.now()}`;
      const vocabulary = process.env.TRANSCRIBE_VOCABULARY_NAME;
      await new TranscribeClient({ region }).send(
        new StartTranscriptionJobCommand({
          TranscriptionJobName: jobName,
          LanguageCode: "en-US",
          MediaFormat: "mp3",
          Media: { MediaFileUri: `s3://${bucket}/${audioKey}` },
          OutputBucketName: bucket,
          OutputKey: transcriptKey(args.storyId),
          Settings: { ShowSpeakerLabels: true, MaxSpeakerLabels: 6, ...(vocabulary ? { VocabularyName: vocabulary } : {}) },
        }),
      );
      await ctx.runMutation(internal.transcripts.markTranscribing, { ...args, externalId: jobName });
      await ctx.scheduler.runAfter(POLL_EVERY_MS, internal.aws.transcribe.poll, { ...args, polls: 1 });
    });
  },
});

export const poll = internalAction({
  args: { ...stepArgs, polls: v.number() },
  handler: async (ctx, { polls, ...args }) => {
    // A failed poll restarts from `start`: re-upload and re-transcribe.
    await runStep(ctx, args, internal.aws.transcribe.start, async () => {
      const region = requireEnv("AWS_REGION");
      const bucket = requireEnv("BACKSTORY_S3_BUCKET");
      const { externalId } = await ctx.runQuery(internal.transcripts.jobExternalId, { jobId: args.jobId });
      const { TranscriptionJob: job } = await new TranscribeClient({ region }).send(
        new GetTranscriptionJobCommand({ TranscriptionJobName: externalId }),
      );
      const status = job?.TranscriptionJobStatus;
      if (status === "FAILED") throw new Error(`Transcribe failed: ${job?.FailureReason ?? "no reason given"}`);
      if (status !== "COMPLETED") {
        if (polls >= MAX_POLLS) throw new Error(`Transcribe still ${status} after ${MAX_POLLS} polls`);
        await ctx.scheduler.runAfter(POLL_EVERY_MS, internal.aws.transcribe.poll, { ...args, polls: polls + 1 });
        return;
      }
      const key = transcriptKey(args.storyId);
      const object = await new S3Client({ region }).send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!object.Body) throw new Error(`Transcript ${key} is empty`);
      const segments = parseTranscribeOutput(JSON.parse(await object.Body.transformToString()));
      await ctx.runMutation(internal.transcripts.save, { ...args, ref: `s3://${bucket}/${key}`, segments });
    });
  },
});
```

- [ ] **Step 8: Regenerate types and run the tests**

Run: `npx convex dev --once && npx vitest run tests/lib/transcribeOutput.test.ts tests/transcripts.test.ts`
Expected: PASS (5 tests). No type errors in `convex/aws/transcribe.ts`.

- [ ] **Step 9: Commit**

```bash
git add convex/lib/transcribeOutput.ts convex/transcripts.ts convex/aws/transcribe.ts tests/fixtures/transcribe-output.json tests/lib/transcribeOutput.test.ts tests/transcripts.test.ts tsconfig.json convex/_generated
git commit -m "feat: transcribe episodes with Amazon Transcribe speaker labels"
```

---

### Task 8: Ingest both shows from CDS

The ingest action asks CDS for a show's newest episodes, newest first (the show's CDS channel comes from its profile, so one action serves both shows). It saves each new episode as a pending story and queues its transcription. Seeing the same episode again only refreshes its title and show notes. That matters because Transcribe bills per minute, and the daily cron and manual runs will overlap.

**Files:**
- Create: `convex/lib/cds.ts`
- Create: `convex/stories.ts`
- Create: `convex/ingest.ts`
- Create: `tests/fixtures/cds-this-bites-episode.json`
- Test: `tests/lib/cds.test.ts`, `tests/stories.test.ts`

**Interfaces:**
- Consumes: `getShowProfile` (Task 1), `enqueue` (Task 4), `internal.aws.transcribe.start` (Task 7).
- Produces: `CDS_BASE_URL`, `buildShowQueryUrl(collectionId, limit): string`, `stripHtml(html): string`, `type CdsDocument`, `type CdsEpisode`, `parseEpisode(doc): CdsEpisode | null`, `fetchCds(url, token, fetchImpl?, sleep?): Promise<unknown>`; internal `stories.upsertEpisode({ showSlug, ...CdsEpisode }) → { storyId, created }`; action `internal.ingest.ingestShow({ showSlug, limit? }) → { created }`.

- [ ] **Step 1: Write the fixture (real CDS document, fetched 2026-10-01; teaser shortened to two list items)**

`tests/fixtures/cds-this-bites-episode.json`:
```json
{
  "id": "fis-718413877-f1a11b199499737e74c6c94583b15dba",
  "title": "Freshwater Food & Wine Festival, Café Corazón and turkey talk",
  "profiles": [
    { "href": "/v1/profiles/document" },
    { "href": "/v1/profiles/podcast-episode", "rels": ["type"] },
    { "href": "/v1/profiles/publishable", "rels": ["interface"] },
    { "href": "/v1/profiles/listenable", "rels": ["interface"] },
    { "href": "/v1/profiles/has-audio", "rels": ["interface"] }
  ],
  "owners": [{ "href": "https://organization.api.npr.org/v4/services/s921" }],
  "publishDateTime": "2026-09-18T15:00:00.000Z",
  "collections": [{ "href": "/v1/documents/718413877", "rels": ["podcast-channel", "theme", "slug"] }],
  "audio": [{ "href": "#/assets/fis-718413877-f1a11b199499737e74c6c94583b15dba-enclosure-audio", "rels": ["headline", "primary"] }],
  "episodeGuid": "prx_13397_aa88e568-7b82-41aa-bac6-62a39b740d7c",
  "teaser": "<p>In this episode's serving of the latest Milwaukee food news and festival highlights:</p><ul>\n<li>We break down the Freshwater Food &amp; Wine Festival happening on the Summerfest grounds.</li>\n<li>We bid a bittersweet farewell to Café Corazón in Bay View.</li>\n</ul>",
  "webPages": [
    { "href": "https://play.prx.org/listen?ge=prx_13397_aa88e568-7b82-41aa-bac6-62a39b740d7c&uf=https%3A%2F%2Fpublicfeeds.net%2Ff%2F13397%2Fthis-bites", "rels": ["canonical"] }
  ],
  "assets": {
    "fis-718413877-f1a11b199499737e74c6c94583b15dba-enclosure-audio": {
      "duration": 999,
      "enclosures": [
        { "href": "https://dts.podtrac.com/redirect.mp3/dovetail.prxu.org/13397/aa88e568-7b82-41aa-bac6-62a39b740d7c/ThisBites_091826_FullPodcast.mp3", "type": "audio/mpeg" }
      ],
      "id": "fis-718413877-f1a11b199499737e74c6c94583b15dba-enclosure-audio",
      "isDownloadable": true
    }
  }
}
```

- [ ] **Step 2: Write the failing pure test**

`tests/lib/cds.test.ts`:
```ts
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
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run tests/lib/cds.test.ts`
Expected: FAIL, cannot resolve `../../convex/lib/cds`.

- [ ] **Step 4: Implement the CDS module**

`convex/lib/cds.ts`:
```ts
export const CDS_BASE_URL = "https://content.api.npr.org/v1";
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

interface CdsLink {
  href: string;
  rels?: string[];
}

interface CdsAudioAsset {
  duration?: number;
  enclosures?: Array<{ href: string; type?: string }>;
}

export interface CdsDocument {
  id: string;
  title: string;
  teaser?: string;
  publishDateTime: string;
  audio?: CdsLink[];
  assets?: Record<string, CdsAudioAsset>;
  webPages?: CdsLink[];
}

export interface CdsEpisode {
  cdsId: string;
  title: string;
  teaserText: string;
  publishedAt: number;
  audioUrl: string;
  durationSec: number;
  permalink?: string;
}

/** Always sort explicitly: without it CDS returned oldest first, despite its docs. */
export function buildShowQueryUrl(collectionId: string, limit: number): string {
  const params = new URLSearchParams({
    collectionIds: collectionId,
    profileIds: "podcast-episode",
    sort: "publishDateTime:desc",
    limit: String(limit),
  });
  return `${CDS_BASE_URL}/documents?${params}`;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,:;!?])/g, "$1")
    .trim();
}

/** Null when there is no audio: nothing to transcribe, so nothing to ingest. */
export function parseEpisode(doc: CdsDocument): CdsEpisode | null {
  const assetId = doc.audio?.[0]?.href.replace("#/assets/", "");
  const asset = assetId ? doc.assets?.[assetId] : undefined;
  const enclosure = asset?.enclosures?.find((e) => e.type === "audio/mpeg") ?? asset?.enclosures?.[0];
  if (!enclosure) return null;
  const permalink = doc.webPages?.find((page) => page.rels?.includes("canonical"))?.href;
  return {
    cdsId: doc.id,
    title: doc.title,
    teaserText: stripHtml(doc.teaser ?? ""),
    publishedAt: Date.parse(doc.publishDateTime),
    audioUrl: enclosure.href,
    durationSec: asset?.duration ?? 0,
    ...(permalink ? { permalink } : {}),
  };
}

/** CDS has no rate limit beyond 503s, so retry those with backoff and fail fast on anything else. */
export async function fetchCds(
  url: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    if (response.ok) return response.json();
    if (response.status !== 503 || attempt >= RETRY_DELAYS_MS.length) {
      throw new Error(`CDS request failed: HTTP ${response.status} for ${url}`);
    }
    await sleep(RETRY_DELAYS_MS[attempt]);
  }
}
```

- [ ] **Step 5: Run it to see it pass**

Run: `npx vitest run tests/lib/cds.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Write the failing Convex test**

`tests/stories.test.ts`:
```ts
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
      story: await ctx.db.get(storyId),
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
```

- [ ] **Step 7: Implement the Convex functions**

`convex/stories.ts`:
```ts
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { enqueue } from "./jobs";
import { CDS_BASE_URL } from "./lib/cds";

export const upsertEpisode = internalMutation({
  args: {
    showSlug: v.string(),
    cdsId: v.string(),
    title: v.string(),
    teaserText: v.string(),
    publishedAt: v.number(),
    audioUrl: v.string(),
    durationSec: v.number(),
    permalink: v.optional(v.string()),
  },
  handler: async (ctx, episode) => {
    // Convex runs mutations one at a time per document, so two overlapping ingests can't both insert.
    const existing = await ctx.db
      .query("stories")
      .withIndex("by_cdsId", (q) => q.eq("cdsId", episode.cdsId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { title: episode.title, teaserText: episode.teaserText });
      return { storyId: existing._id, created: false };
    }
    const storyId = await ctx.db.insert("stories", {
      ...episode,
      contentType: "episode",
      stage: "ingested",
      reviewStatus: "pending",
      doNotUse: false,
    });
    await ctx.db.insert("sources", {
      storyId, kind: "cds_document", ref: `${CDS_BASE_URL}/documents/${episode.cdsId}`, fetchedAt: Date.now(),
    });
    await enqueue(ctx, "transcribe", storyId, internal.aws.transcribe.start);
    return { storyId, created: true };
  },
});
```

`convex/ingest.ts`:
```ts
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { buildShowQueryUrl, fetchCds, parseEpisode, type CdsDocument } from "./lib/cds";
import { getShowProfile } from "./lib/shows";

export const ingestShow = internalAction({
  args: { showSlug: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { showSlug, limit }) => {
    const profile = getShowProfile(showSlug);
    const token = process.env.NPR_CDS_TOKEN;
    if (!token) throw new Error("Missing Convex env var NPR_CDS_TOKEN");
    const body = (await fetchCds(buildShowQueryUrl(profile.cdsCollectionId, limit ?? 10), token)) as {
      resources?: CdsDocument[];
    };
    let created = 0;
    for (const doc of body.resources ?? []) {
      const episode = parseEpisode(doc);
      if (!episode) continue;
      const result = await ctx.runMutation(internal.stories.upsertEpisode, { showSlug, ...episode });
      if (result.created) created++;
    }
    console.log(`[backstory] ingest ${showSlug}: ${body.resources?.length ?? 0} documents, ${created} new`);
    return { created };
  },
});
```

- [ ] **Step 8: Regenerate types and run the tests**

Run: `npx convex dev --once && npx vitest run tests/lib/cds.test.ts tests/stories.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 9: Commit**

```bash
git add convex/lib/cds.ts convex/stories.ts convex/ingest.ts tests/fixtures/cds-this-bites-episode.json tests/lib/cds.test.ts tests/stories.test.ts convex/_generated
git commit -m "feat: ingest podcast episodes from NPR CDS by show profile"
```

---

### Task 9: The listener-facing contract and demo approval

These are the only two queries the MCP server calls. They return nothing an editor hasn't approved. `approveLatestRunForDemo` is the PRD's fallback ("approve demo items directly"). It's internal, so only the CLI and dashboard can run it, and Plan 2 replaces it with Clerk-checked review per item.

**Files:**
- Create: `convex/lib/attribution.ts`
- Create: `convex/public.ts`
- Create: `convex/admin.ts`
- Test: `tests/lib/attribution.test.ts`, `tests/public.test.ts`

**Interfaces:**
- Consumes: `getShowProfile` (Task 1), `normalizeForMatch` (Task 3), `saveRun`/`SAMPLE_RESULT` (Task 6 helpers).
- Produces: `attribution(showName, publishedAt): string`; public `public.getStory({ storyId }) → StoryView | null`; public `public.searchStories({ text }) → Array<{ storyId; title; attribution; matched }>`; internal `admin.approveLatestRunForDemo({ storyId })`.

`StoryView` shape (the MCP server's contract — Plan 2 and the MCP server rely on these exact keys):
```ts
{
  storyId, show, title, summary, publishedAt, attribution, audioUrl, permalink: string | null,
  mentions: Array<{ entityType, name, quote, startMs, relatedPlace: string | null }>, // non-place mentions
  places: Array<{ name, category, lat: number | null, lng: number | null, neighborhood: string | null, quote }>,
  topics: Array<{ topic, confidence, quote }>,
  actions: Array<{ kind, label, quote, place: string | null }>,
}
```

- [ ] **Step 1: Write the failing attribution test**

`tests/lib/attribution.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { attribution } from "../../convex/lib/attribution";

describe("attribution", () => {
  it("names the show and the month the episode came out", () => {
    expect(attribution("This Bites", Date.UTC(2026, 8, 18, 15))).toBe("This Bites, September 2026");
  });
});
```

- [ ] **Step 2: Implement it**

`convex/lib/attribution.ts`:
```ts
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** How Alexa credits a recommendation: the hosts' view on a date, never a current rating. */
export function attribution(showName: string, publishedAt: number): string {
  const date = new Date(publishedAt);
  return `${showName}, ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
```

Run: `npx vitest run tests/lib/attribution.test.ts`
Expected: PASS (1 test).

- [ ] **Step 3: Write the failing contract test**

`tests/public.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { makeTest, SAMPLE_RESULT, saveRun, seedStory, type TestConvex } from "./helpers";

async function extractedStory(t: TestConvex) {
  const storyId = await seedStory(t, { stage: "geocoded" });
  await saveRun(t, storyId, "run-1");
  return storyId;
}

const approve = (t: TestConvex, storyId: Awaited<ReturnType<typeof extractedStory>>) =>
  t.mutation(internal.admin.approveLatestRunForDemo, { storyId });

describe("public.getStory", () => {
  it("returns nothing for an unapproved story", async () => {
    const t = makeTest();
    const storyId = await extractedStory(t);
    expect(await t.query(api.public.getStory, { storyId })).toBeNull();
  });

  it("returns the approved story with its place, action and attribution", async () => {
    const t = makeTest();
    const storyId = await extractedStory(t);
    await approve(t, storyId);
    const story = await t.query(api.public.getStory, { storyId });
    expect(story).toMatchObject({
      show: "This Bites",
      summary: SAMPLE_RESULT.summary,
      attribution: "This Bites, September 2026",
      places: [{ name: "Café Corazón", category: "restaurant", lat: null, quote: "a bittersweet farewell to Café Corazón in Bay View" }],
      mentions: [{ entityType: "person", name: "Joe Sasto" }],
      topics: [{ topic: "food-drink" }],
      actions: [{ kind: "visit", label: "Visit Café Corazón in Riverwest", place: "Café Corazón" }],
    });
  });

  it("re-processing keeps the approved run live until the new run is approved", async () => {
    const t = makeTest();
    const storyId = await extractedStory(t);
    await approve(t, storyId);
    await saveRun(t, storyId, "run-2", { ...SAMPLE_RESULT, summary: "A newer summary.", mentions: [], actions: [] });

    const during = await t.query(api.public.getStory, { storyId });
    expect(during?.summary).toBe(SAMPLE_RESULT.summary);
    expect(during?.places).toHaveLength(1);

    await approve(t, storyId);
    const after = await t.query(api.public.getStory, { storyId });
    expect(after?.summary).toBe("A newer summary.");
    expect(after?.places).toHaveLength(0);
  });

  it("hides a story an editor marked not for assistant use", async () => {
    const t = makeTest();
    const storyId = await extractedStory(t);
    await approve(t, storyId);
    await t.run((ctx) => ctx.db.patch(storyId, { doNotUse: true }));
    expect(await t.query(api.public.getStory, { storyId })).toBeNull();
  });

  it("hides a rejected or do-not-use mention, and the place and action that hang off it", async () => {
    const t = makeTest();
    const storyId = await extractedStory(t);
    await approve(t, storyId);
    await t.run(async (ctx) => {
      const mentions = await ctx.db.query("mentions").collect();
      await ctx.db.patch(mentions.find((m) => m.name === "Café Corazón")!._id, { doNotUse: true });
      await ctx.db.patch(mentions.find((m) => m.name === "Joe Sasto")!._id, { reviewStatus: "rejected" });
    });
    const story = await t.query(api.public.getStory, { storyId });
    expect(story?.mentions).toEqual([]);
    expect(story?.places).toEqual([]);
    expect(story?.actions).toEqual([]);
  });
});

describe("public.searchStories", () => {
  it("finds nothing before approval", async () => {
    const t = makeTest();
    await extractedStory(t);
    expect(await t.query(api.public.searchStories, { text: "Corazon" })).toEqual([]);
  });

  it("finds an approved story by place name, ignoring accents", async () => {
    const t = makeTest();
    const storyId = await extractedStory(t);
    await approve(t, storyId);
    expect(await t.query(api.public.searchStories, { text: "Corazon" })).toEqual([
      { storyId, title: expect.any(String), attribution: "This Bites, September 2026", matched: "Café Corazón" },
    ]);
  });
});

describe("admin.approveLatestRunForDemo", () => {
  it("refuses a story with no extraction yet", async () => {
    const t = makeTest();
    const storyId = await seedStory(t);
    await expect(approve(t, storyId)).rejects.toThrow("Story has no extraction run to approve yet");
  });
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `npx vitest run tests/public.test.ts`
Expected: FAIL, `api.public` / `internal.admin` don't exist.

- [ ] **Step 5: Implement the contract**

`convex/public.ts`:
```ts
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { attribution } from "./lib/attribution";
import { normalizeForMatch } from "./lib/evidence";
import { getShowProfile } from "./lib/shows";

// The contract with the Alexa MCP server: only rows from the editor-approved run, and
// nothing an editor rejected or marked not-for-assistant-use. These are public queries
// on purpose; they can only ever return approved data.

export const getStory = query({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }) => {
    const story = await ctx.db.get(storyId);
    const runId = story?.approvedRunId;
    if (!story || !runId || story.reviewStatus !== "approved" || story.doNotUse || !story.summary) return null;

    const inRun = <T extends { reviewStatus: string }>(rows: T[]) => rows.filter((row) => row.reviewStatus === "approved");
    const mentions = inRun(
      await ctx.db.query("mentions").withIndex("by_story_run", (q) => q.eq("storyId", storyId).eq("runId", runId)).collect(),
    ).filter((mention) => !mention.doNotUse);
    const liveMentions = new Map(mentions.map((mention) => [mention._id, mention]));
    const places = inRun(
      await ctx.db.query("places").withIndex("by_story_run", (q) => q.eq("storyId", storyId).eq("runId", runId)).collect(),
    ).filter((place) => liveMentions.has(place.mentionId));
    const topics = inRun(
      await ctx.db.query("storyTopics").withIndex("by_story_run", (q) => q.eq("storyId", storyId).eq("runId", runId)).collect(),
    );
    const actions = inRun(
      await ctx.db.query("storyActions").withIndex("by_story_run", (q) => q.eq("storyId", storyId).eq("runId", runId)).collect(),
    ).filter((action) => !action.placeMentionId || liveMentions.has(action.placeMentionId));

    const show = getShowProfile(story.showSlug).name;
    return {
      storyId,
      show,
      title: story.title,
      summary: story.summary,
      publishedAt: story.publishedAt,
      attribution: attribution(show, story.publishedAt),
      audioUrl: story.audioUrl,
      permalink: story.permalink ?? null,
      mentions: mentions
        .filter((mention) => mention.entityType !== "place")
        .map(({ entityType, name, quote, startMs, relatedPlace }) => ({
          entityType, name, quote, startMs, relatedPlace: relatedPlace ?? null,
        })),
      places: places.map((place) => ({
        name: place.name,
        category: place.category,
        lat: place.lat ?? null,
        lng: place.lng ?? null,
        neighborhood: place.neighborhood ?? null,
        quote: liveMentions.get(place.mentionId)!.quote,
      })),
      topics: topics.map(({ topic, confidence, quote }) => ({ topic, confidence, quote })),
      actions: actions.map((action) => ({
        kind: action.kind,
        label: action.label,
        quote: action.quote,
        place: action.placeMentionId ? liveMentions.get(action.placeMentionId)!.name : null,
      })),
    };
  },
});

export const searchStories = query({
  args: { text: v.string() },
  handler: async (ctx, { text }) => {
    const search = normalizeForMatch(text);
    if (!search) return [];
    const hits = await ctx.db
      .query("mentions")
      .withSearchIndex("search_text", (q) => q.search("searchText", search).eq("reviewStatus", "approved"))
      .take(50);
    const results = new Map<Id<"stories">, { storyId: Id<"stories">; title: string; attribution: string; matched: string }>();
    for (const mention of hits) {
      if (mention.doNotUse || results.has(mention.storyId)) continue;
      const story = await ctx.db.get(mention.storyId);
      if (!story || story.reviewStatus !== "approved" || story.doNotUse || story.approvedRunId !== mention.runId) continue;
      results.set(mention.storyId, {
        storyId: mention.storyId,
        title: story.title,
        attribution: attribution(getShowProfile(story.showSlug).name, story.publishedAt),
        matched: mention.name,
      });
    }
    return [...results.values()].slice(0, 10);
  },
});
```

`convex/admin.ts`:
```ts
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/**
 * PRD fallback for the demo: approve every pending row in a story's latest run at once.
 * Internal only, so it runs from the CLI or dashboard and never from a browser:
 *   npx convex run admin:approveLatestRunForDemo '{"storyId":"..."}'
 * Plan 2 replaces this with Clerk-checked, per-item review mutations.
 */
export const approveLatestRunForDemo = internalMutation({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }) => {
    const story = await ctx.db.get(storyId);
    if (!story?.latestRunId || !story.proposedSummary) throw new Error("Story has no extraction run to approve yet");
    const runId = story.latestRunId;
    const byRun = { storyId, runId };

    const mentions = await ctx.db.query("mentions").withIndex("by_story_run", (q) => q.eq("storyId", byRun.storyId).eq("runId", byRun.runId)).collect();
    for (const row of mentions) if (row.reviewStatus === "pending") await ctx.db.patch(row._id, { reviewStatus: "approved" });
    const places = await ctx.db.query("places").withIndex("by_story_run", (q) => q.eq("storyId", byRun.storyId).eq("runId", byRun.runId)).collect();
    for (const row of places) if (row.reviewStatus === "pending") await ctx.db.patch(row._id, { reviewStatus: "approved" });
    const topics = await ctx.db.query("storyTopics").withIndex("by_story_run", (q) => q.eq("storyId", byRun.storyId).eq("runId", byRun.runId)).collect();
    for (const row of topics) if (row.reviewStatus === "pending") await ctx.db.patch(row._id, { reviewStatus: "approved" });
    const actions = await ctx.db.query("storyActions").withIndex("by_story_run", (q) => q.eq("storyId", byRun.storyId).eq("runId", byRun.runId)).collect();
    for (const row of actions) if (row.reviewStatus === "pending") await ctx.db.patch(row._id, { reviewStatus: "approved" });

    await ctx.db.patch(storyId, { summary: story.proposedSummary, approvedRunId: runId, reviewStatus: "approved" });
  },
});
```

- [ ] **Step 6: Regenerate types and run the tests**

Run: `npx convex dev --once && npx vitest run tests/public.test.ts tests/lib/attribution.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 7: Run the whole suite and the typecheck**

Run: `npm test && npm run typecheck`
Expected: every test passes; `tsc` exits 0.

- [ ] **Step 8: Commit**

```bash
git add convex/lib/attribution.ts convex/public.ts convex/admin.ts tests/lib/attribution.test.ts tests/public.test.ts convex/_generated
git commit -m "feat: add approved-only story contract for the MCP server and demo approval"
```

---

### Task 10: Daily cron, CI, decision log, README

**Files:**
- Create: `convex/crons.ts`
- Create: `.github/workflows/ci.yml`
- Create: `docs/decisions/001-backstory-owns-its-convex-project.md` … `005-show-profiles-in-code.md`
- Create: `docs/LEARNING-LOG.md`, `README.md`

**Interfaces:**
- Consumes: `internal.ingest.ingestShow` (Task 8).
- Produces: daily crons `ingest This Bites` and `ingest Uniquely Milwaukee`.

- [ ] **Step 1: Add the cron**

`convex/crons.ts`:
```ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// PRD Operations: check CDS daily for new episodes. Upserts are idempotent, so overlapping runs are harmless.
crons.daily("ingest This Bites", { hourUTC: 12, minuteUTC: 0 }, internal.ingest.ingestShow, { showSlug: "this-bites", limit: 10 });
crons.daily("ingest Uniquely Milwaukee", { hourUTC: 12, minuteUTC: 15 }, internal.ingest.ingestShow, { showSlug: "uniquely-milwaukee", limit: 10 });

export default crons;
```

Run: `npx convex dev --once`
Expected: deploy succeeds; the Convex dashboard's Schedules → Cron Jobs shows both crons.

- [ ] **Step 2: Add CI**

`.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
```

`convex/_generated/` is committed (Convex's default), so CI typechecks without a deployment.

- [ ] **Step 3: Write the decision log entries**

Each one follows the format in Tarik's CLAUDE.md. **Leave "What actually happened" blank** — Tarik writes it.

`docs/decisions/001-backstory-owns-its-convex-project.md`:
```markdown
# 001: Backstory owns its own Convex project

**Decision:** Backstory's tables live in their own Convex project in this repo, not in a shared schema inside a main Alexa repo.

**Why this came up:** The PRD says the tables are "already defined in the shared Convex schema," but no such repo exists yet. Waiting for it would block every pipeline step.

**Options:**
- Own repo and Convex project now. Unblocks the build today; the MCP server reads Backstory's public queries over the network.
- Find or build the main monorepo first. Matches the PRD exactly, but setup work comes before any Backstory code.
- One shared Convex project for everything. Simplest reads for the MCP server, but every system's deploys and schema changes collide.

**What we chose and why:** Own repo (Tarik). The PRD's own boundary — "the engine writes, the MCP server only reads approved rows" — maps cleanly onto two public queries.

**What we gave up:** The MCP server calls Backstory's Convex deployment instead of reading tables directly, and if a monorepo appears later, these tables move.

**How we'll know if this was right:** The MCP server answers This Bites and Uniquely Milwaukee questions using only `public.getStory` and `public.searchStories`, with no direct table access.

**What actually happened:**
```

`docs/decisions/002-transcribe-every-episode.md`:
```markdown
# 002: Transcribe every episode; show notes are never evidence

**Decision:** Every audio episode goes through Amazon Transcribe. The show notes in CDS are passed to the model only to help it spell names, and nothing can be quoted from them.

**Why this came up:** The PRD planned to use a CDS transcript "when present." Checking a real This Bites document showed CDS has show notes and an MP3, but no transcript, and Tarik confirmed that's true across the station.

**Options:**
- Transcribe everything. Costs about $0.024 a minute (roughly $5 for 10 episodes) and every quote is checkable.
- Extract from show notes when they're detailed. Free, but show notes are written about the episode, not said in it, so "verbatim quote" would stop meaning anything.
- Mix the two, marking show-note facts as lower confidence. Two evidence standards for editors to keep straight.

**What we chose and why:** Transcribe everything (Tarik). The engine's promise is that every detail traces to something actually said on air.

**What we gave up:** Transcription cost and about 10–15 minutes per episode before it's ready for review. Backfilling the ~377 This Bites episodes will cost real money (see the PRD's budget question).

**How we'll know if this was right:** On the 20-episode labeled set, 100% of kept quotes are found in transcripts and editors rarely add a fact the pipeline missed because it was only in the show notes.

**What actually happened:**
```

`docs/decisions/003-convex-scheduler-for-jobs.md`:
```markdown
# 003: Pipeline jobs run on Convex's scheduler, not Trigger.dev

**Decision:** Each pipeline step is a Convex action, scheduled by Convex and tracked in a `jobs` table with retries.

**Why this came up:** The PRD says to reuse the Field Guide's job and backoff patterns; the Field Guide runs jobs on Trigger.dev against Neon. Backstory's data is in Convex.

**Options:**
- Convex scheduler + `jobs` table. One system; a step's output and its job status save in the same transaction.
- Trigger.dev, like the Field Guide. Better run dashboards and long-running tasks, but a second service writing into Convex over the network.
- A worker on the Hetzner box. Full control, but we'd own uptime.

**What we chose and why:** Convex scheduler (Claude, accepted with this plan). At one episode a week the simplest system wins, and saving data and finishing a job in one transaction means a crash can't leave them disagreeing.

**What we gave up:** Convex Node actions time out at 10 minutes, so Transcribe is polled once a minute instead of awaited, and there's no dedicated job dashboard beyond the `jobs` table.

**How we'll know if this was right:** The 10-episode hackathon run finishes with no job stuck in `running`, and any `needs_editor` story has a readable `lastError`.

**What actually happened:**
```

`docs/decisions/004-two-shows-first-no-airing-log.md`:
```markdown
# 004: This Bites and Uniquely Milwaukee go first; there is no airing log

**Decision:** The first build covers both This Bites and Uniquely Milwaukee as podcasts, and the airing log (recalling a short heard on 88Nine) is dropped.

**Why this came up:** The PRD scoped the hackathon to "one show, one flow." Its first open question was whether the station logs shorts when they air; it doesn't (Tarik). Tarik then made Uniquely Milwaukee a must-have alongside This Bites.

**Options:**
- Both shows now. One pipeline, two show profiles; proves early that a new show is a profile, not code. Two flows to review and demo.
- This Bites only. Smallest slice, but leaves out the station's core community storytelling.
- Uniquely Milwaukee only. Simplest entities, but loses the restaurant-to-reservation flow.

**What we chose and why:** Both (Tarik). Uniquely Milwaukee is central to the station's mission and funder story; This Bites has the largest archive and the reservation flow. Uniquely Milwaukee episodes run 3–5 minutes, so adding it costs pennies.

**What we gave up:** No "what did I just hear on 88Nine" answer, and editors review two shows from day one. Uniquely Milwaukee's reviewer is not named yet.

**How we'll know if this was right:** The demo answers both "where did This Bites recommend tacos in Bay View?" (a place, its date, a reserve or visit action) and "tell me about My Way Out" (a Uniquely Milwaukee story with a support action), and the second show needed no pipeline code.

**What actually happened:**
```

`docs/decisions/005-show-profiles-in-code.md`:
```markdown
# 005: Show profiles live in a code file, not a `shows` table

**Decision:** Each show's profile (CDS channel, entity types, action kinds, extraction notes, reviewer) is an entry in `convex/lib/shows.ts`, and stories store a `showSlug`.

**Why this came up:** The PRD lists both "profiles live in a config file" and a `shows` table. Keeping both means two places to update.

**Options:**
- Config file only. Changes go through a commit and review, and tests can read it.
- Table only. Editable without a deploy, but extraction rules change without review.
- Both. The PRD's literal wording; two sources of truth.

**What we chose and why:** Config file (Claude, accepted with this plan). Adding a show changes what the model extracts; that deserves a reviewed commit.

**What we gave up:** Adding or changing a show requires a deploy, and the reviewer list can't be edited from the admin UI.

**How we'll know if this was right:** Uniquely Milwaukee runs on the same pipeline as This Bites with only a profile entry, and Plan 3 adds Ladies First the same way.

**What actually happened:**
```

`docs/LEARNING-LOG.md`:
```markdown
# Learning log

Dated entries: what we expected, what happened, what we now believe.
```

- [ ] **Step 4: Write the README**

`README.md`:
```markdown
# Radio Milwaukee Backstory

The station's story engine: turns podcast episodes into transcribed, evidence-checked story data that the Alexa MCP server can read once an editor approves it. Spec: `docs/Radio Milwaukee Backstory PRD-2.md`.

## How an episode moves through it

1. A daily cron asks NPR CDS for the newest episodes of each show and saves new ones as pending stories.
2. **Transcribe:** the MP3 is copied to S3 and run through Amazon Transcribe with speaker labels.
3. **Extract:** one Amazon Nova Micro call proposes people, places, dishes, topics, actions and a summary. Anything whose quote isn't in the transcript is dropped.
4. **Geocode:** Amazon Location finds coordinates for each place, with a confidence score.
5. An editor approves the run. Only then do `public.getStory` and `public.searchStories` return it.

Each step is a row in the `jobs` table. Failures retry after 1 and 4 minutes; the third failure marks the story `needs_editor`.

## Setup

    npm install
    npx convex dev --once --configure=new   # first time only
    npx convex env set NPR_CDS_TOKEN ...     # see .env.example for every variable

## Commands

    npm test                 # unit tests (no AWS, no network)
    npm run typecheck
    npx convex run ingest:ingestShow '{"showSlug":"this-bites","limit":1}'
    npx convex run ingest:ingestShow '{"showSlug":"uniquely-milwaukee","limit":1}'
    npx convex run admin:approveLatestRunForDemo '{"storyId":"..."}'

Decisions and their reasoning: `docs/decisions/`.
```

- [ ] **Step 5: Verify and commit**

Run: `npm test && npm run typecheck`
Expected: all pass.

```bash
git add -A
git commit -m "chore: add daily ingest cron, CI, decision log and README"
```

- [ ] **Step 6: Put the repo on GitHub and prove CI (ask Tarik first: this creates a GitHub repo)**

```bash
gh repo create tmoody1973/backstory --private --source . --push
gh run watch   # expect the CI run to go green
```

To prove CI actually catches failures, change `expect(retryDelayMs(1))`'s expected value in `tests/jobs.test.ts` to `1` on a branch, push, and watch the run go red. Then revert. **Tarik:** turn on branch protection for `main` requiring the `check` job (GitHub → Settings → Branches). This is a manual settings step.

---

### Task 11: Live run on real episodes (manual; spends AWS money)

Nothing in this task is unit-tested. It's the check that the AWS glue in `convex/aws/` works against the real services. **Each step that creates AWS resources or spends money needs Tarik's go-ahead.** The expected total for 10 episodes of each show is about $6 of Transcribe (This Bites runs 12–28 minutes an episode, Uniquely Milwaukee 3–5) plus a few cents of Bedrock and Location, all inside the $150 credit.

- [ ] **Step 1: AWS prerequisites (Tarik, in us-east-1)**

1. Create the bucket: `aws s3 mb s3://radiomke-backstory-dev --region us-east-1`
2. Bedrock console → Model access → enable **Amazon Nova Micro**.
3. Create an IAM user for Backstory with this policy, then create an access key:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject"], "Resource": "arn:aws:s3:::radiomke-backstory-dev/*" },
    { "Effect": "Allow", "Action": ["transcribe:StartTranscriptionJob", "transcribe:GetTranscriptionJob"], "Resource": "*" },
    { "Effect": "Allow", "Action": ["bedrock:InvokeModel"], "Resource": "*" },
    { "Effect": "Allow", "Action": ["geo-places:SearchText"], "Resource": "*" }
  ]
}
```

4. Request a CDS token for Backstory's own client (not a personal one).

- [ ] **Step 2: Set Convex env vars and deploy**

```bash
npx convex env set NPR_CDS_TOKEN <token>
npx convex env set AWS_ACCESS_KEY_ID <key>
npx convex env set AWS_SECRET_ACCESS_KEY <secret>
npx convex env set AWS_REGION us-east-1
npx convex env set BACKSTORY_S3_BUCKET radiomke-backstory-dev
npx convex dev --once
```

- [ ] **Step 3: Ingest one episode of each show and watch them run**

```bash
npx convex run ingest:ingestShow '{"showSlug":"this-bites","limit":1}'
npx convex run ingest:ingestShow '{"showSlug":"uniquely-milwaukee","limit":1}'
npx convex logs        # leave running in another terminal
```

Expected: `{"created":1}` from each. Within about 15 minutes `npx convex data jobs` shows `transcribe`, `extract` and `geocode` all `done`, and `npx convex data stories` shows both stories at `stage: "geocoded"`. If a job says `needs_editor`, read its `lastError`. Common causes are a wrong model id (set `BEDROCK_MODEL_ID`), `toolChoice` not being supported (switch to `{ any: {} }` in `convex/aws/extract.ts`), or missing IAM permissions.

- [ ] **Step 4: Replace the transcript fixture with real Transcribe output**

```bash
aws s3 cp s3://radiomke-backstory-dev/transcripts/<storyId>.json tests/fixtures/transcribe-output.real.json
```

Append to `tests/lib/transcribeOutput.test.ts`:
```ts
import realFixture from "../fixtures/transcribe-output.real.json";

it("parses a real This Bites transcript into many labeled segments", () => {
  const segments = parseTranscribeOutput(realFixture);
  expect(segments.length).toBeGreaterThan(50);
  expect(new Set(segments.map((s) => s.speaker)).size).toBeGreaterThan(1);
});
```

Run: `npx vitest run tests/lib/transcribeOutput.test.ts`
Expected: PASS. This confirms the `audio_segments` format assumption from Task 7. If it fails, fix `parseTranscribeOutput` to match the real file.

- [ ] **Step 5: Check the extraction by eye**

Run: `npx convex data mentions` and search the logs for `dropped`.
Write down three numbers in `docs/LEARNING-LOG.md` as a dated entry: mentions kept, mentions dropped, and how many places have `geocodeConfidence` below 0.6. Record them per show. For the Uniquely Milwaukee story, also confirm by eye that no private person's home or street address was captured as a place, and that the host and the membership credit weren't extracted as story subjects. These numbers are the first input to the PRD's model-evaluation step.

- [ ] **Step 6: Approve and read it back through the contract**

```bash
npx convex run admin:approveLatestRunForDemo '{"storyId":"<storyId>"}'
npx convex run public:getStory '{"storyId":"<storyId>"}'
npx convex run public:searchStories '{"text":"<a restaurant named in the episode>"}'
```

Repeat for the Uniquely Milwaukee story, searching an organization it names.

Expected for each show: `getStory` returns a summary, at least one place with `lat`/`lng`, and at least one action, which is the PRD's hackathon acceptance criterion. A Uniquely Milwaukee story about a person with no public place may have zero places; it still needs an action. `searchStories` returns the story.

- [ ] **Step 7: Ingest the demo set (about $5 for This Bites, under $1 for Uniquely Milwaukee)**

```bash
npx convex run ingest:ingestShow '{"showSlug":"this-bites","limit":10}'
npx convex run ingest:ingestShow '{"showSlug":"uniquely-milwaukee","limit":10}'
```

Expected: `{"created":9}` from each (the first one already exists). All twenty reach `geocoded` or `needs_editor`.

- [ ] **Step 8: Commit**

```bash
git add tests/fixtures/transcribe-output.real.json tests/lib/transcribeOutput.test.ts docs/LEARNING-LOG.md
git commit -m "test: pin Transcribe parsing to a real This Bites transcript"
```

---

## Handoff to Plan 2

Plan 2 (review UI at Field Guide `/admin/backstory`) builds on:
- `stories.latestRunId` vs `approvedRunId`, `proposedSummary` vs `summary`, and `reviewStatus` on every row type. Plan 2's per-item approve and reject mutations, guarded by Clerk identity plus the staff allowlist checked **inside Convex**, replace `admin.approveLatestRunForDemo`.
- `places.geocodeConfidence` (sort low-confidence pins first), `neighborhood` and `fieldGuideVenueId` (set during review).
- `transcriptSegments.speaker` labels (Plan 2 adds speaker naming).
- `doNotUse` on stories and mentions (Plan 2 adds the toggle).
- `jobs` rows with `needs_editor` (Plan 2's queue shows them).
