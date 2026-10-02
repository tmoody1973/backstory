# Backstory Plan 2: Review UI at Field Guide `/admin/backstory` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Editors sign into the MKE Field Guide admin they already use, open a queue of Backstory episodes, check each person, place, topic and action against its evidence quote, name the speakers, and approve the episode, after which (and only after which) the Alexa MCP server can read it.

**Architecture:** Two repos. **Backstory** (`~/Projects/backstory`, Convex) gains `convex/auth.config.ts` so Convex trusts Clerk sign-in tokens, a reviewer allowlist checked *inside every review function* (`convex/lib/reviewAuth.ts`), review read queries (`convex/review.ts`) and review write mutations (`convex/reviewMutations.ts`). **Field Guide** (`~/Projects/mke-field-guide`, Next.js 16 + Clerk, public repo) gains `/admin/backstory` pages whose server code calls Backstory's Convex with `fetchQuery`/`fetchMutation` from `convex/nextjs`, passing the signed-in editor's Clerk token and `BACKSTORY_CONVEX_URL`. The page gate (`requireStaff`) is convenience; the Convex check is the security boundary, because the MCP server trusts `reviewStatus: "approved"`.

**Tech Stack:** Backstory: Convex 1.x, convex-test + Vitest (edge-runtime), zod v4. Field Guide: Next 16.2.10 (App Router, server actions, `params`/`searchParams` are Promises), `@clerk/nextjs` 7, `convex` 1.42 (already a dependency), vendored RetroUI components (`@/components/ui/*`), Vitest 4 + PGlite, zod 4.

**Spec:** `docs/Backstory_Review_UI.docx` (read it; extracted text is 626 words) and Linear **MOO-853** (acceptance criteria + verification checklist, quoted in Task 9). Plan 1 for context: `docs/superpowers/plans/2026-10-01-backstory-plan-1-core-engine.md`.

## Global Constraints

- **"Check permissions in Convex, not just in the UI."** Every review query and mutation calls `requireReviewer(ctx)` first. No review function is `internal*`-only reachable through the page, and none accepts an email or user id as an argument (Convex guideline: derive identity from `ctx.auth.getUserIdentity()`).
- **The allowlist only trusts a verified email.** Matches Field Guide's `staff-guard.ts` rule ("The allowlist must never key off an unverified address"). `identity.emailVerified !== true` → refused.
- **"Nothing becomes readable by the MCP server until approved."** `convex/public.ts` is NOT edited in this plan. Its contract (approved run only, no rejected, no doNotUse) is already tested; new code only changes `reviewStatus`, `approvedRunId`, `summary`, `doNotUse`, `neighborhood`, speaker names.
- **"Each item shows its evidence quote."** Every item row in the episode page renders its `quote` and its `mm:ss` timestamp.
- **Field Guide is a PUBLIC repo and live on Vercel.** Never commit secrets, real transcripts, or private individuals' names. Test fixtures use only the synthetic This Bites sample already in Backstory's `tests/helpers.ts` (Café Corazón, Joe Sasto). `git add` scoped paths only (no `git add -A`) in the Field Guide. `.env.example` is append-only.
- **Field Guide AGENTS.md mandate:** "This is NOT the Next.js you know." Before writing a page or server action, read the matching guide in `node_modules/next/dist/docs/` (App Router pages, server actions, `revalidatePath`).
- **Field Guide idioms:** `'use server'` files export only async functions; types and pure parsing live in a sibling plain module (`admin-reviews.ts` / `admin-reviews-actions.ts` split). Forms use `useActionState` with an `{ ok: boolean; message: string }` envelope. Pages gate with `await requireStaff(...)`; actions check `currentStaffRole()`.
- **Backstory idioms:** `ctx.db.get("table", id)` / `ctx.db.patch("table", id, ...)` with the table name; `.take(cap)` never `.collect()`; index names list every field; read `convex/_generated/ai/guidelines.md` before Convex work.
- **No production writes during implementation.** The sanctioned ones all happen in Task 9, each named there: deploying Backstory's Convex functions, setting Convex env vars, activating Clerk's Convex integration (Tarik), setting a Vercel env var, and merging the Field Guide PR (Vercel auto-deploys `main` to production).
- Hackathon scope only. Out of scope (MOO-853): audio playback at timestamps, place map, field locks, edit history, restaurant freshness view, premiere and Concert Picks pages.

## Review Focus

1. **A stale page.** An editor has the episode open; a re-extraction lands; they click "Approve episode". Expected: refused with "This episode was re-processed since you opened it. Reload to review the new version." and nothing changes. Test: Task 3, `approveEpisode refuses a run that is no longer the latest`.
2. **Signed-in staff who are not Backstory reviewers, or whose email is unverified.** Expected: Convex refuses (and logs the refusal), the page shows "You're signed in, but not on the Backstory reviewer list." Tests: Task 1 (`requireReviewer`), Task 5 (`reviewErrorMessage`).
3. **Deciding an item from an old run** (neither the latest nor the approved run, e.g. a form left open across two re-extractions). Expected: refused; old runs are history. Test: Task 3, `decideItem refuses a row from a superseded run`.
4. **A blank, whitespace-only or over-long edited summary.** Expected: refused before anything is written, so a story can never go live with an empty summary. Test: Task 3, `approveEpisode refuses a blank summary`.
5. **Double-clicking "Approve episode".** Expected: the second call succeeds harmlessly with the same result (no duplicate side effects, `approvedAt` may move). Test: Task 3, `approveEpisode is safe to run twice`.

## Prerequisites (Tarik-owned; surface them, don't block coding)

1. **Uniquely Milwaukee reviewer name.** `convex/lib/shows.ts` still has a `ponytail:` placeholder for UM's `reviewer`. Needed by Task 3 Step 8.
2. **Reviewer email list** for Convex env `BACKSTORY_REVIEWER_EMAILS` (comma-separated exact emails or `@domain` rules, same syntax as the Field Guide's `ADMIN_ALLOWLIST_EMAILS`). Suggested start: `tarik@radiomilwaukee.org` plus the UM reviewer. Needed by Task 9.
3. **Clerk dashboard:** activate the Convex integration for the Clerk instance the live Field Guide uses (Task 9 Step 2 gives the exact clicks).

## File Map

| Repo | File | Responsibility |
|---|---|---|
| Field Guide | `.github/workflows/ci.yml` (new) | Typecheck + tests on every PR and push to `main` |
| Backstory | `convex/auth.config.ts` (new) | Tell Convex to trust Clerk tokens (`applicationID: "convex"`) |
| Backstory | `convex/lib/reviewers.ts` (new) | Pure allowlist parsing/matching (port of Field Guide `staff-auth.ts`) |
| Backstory | `convex/lib/reviewAuth.ts` (new) | `requireReviewer(ctx)`: identity → verified email → allowlist, else `ConvexError` |
| Backstory | `convex/lib/approveRun.ts` (new) | Shared "approve pending rows of a run" loop (moved out of `admin.ts`) |
| Backstory | `convex/review.ts` (new) | Reviewer-only queries: `queue`, `episode` |
| Backstory | `convex/reviewMutations.ts` (new) | Reviewer-only mutations: `decideItem`, `approveEpisode`, `setSpeakerName`, `setPlaceNeighborhood`, `setDoNotUse` |
| Backstory | `convex/schema.ts` | `stories.approvedBy`, `stories.approvedAt`, index `by_reviewStatus_and_publishedAt` |
| Backstory | `convex/admin.ts` | `approveLatestRunForDemo` calls `approveRun` (behavior unchanged) |
| Backstory | `convex/lib/shows.ts` | UM `reviewer` filled in |
| Backstory | `docs/decisions/010-what-approve-episode-approves.md` (new) | Decision record |
| Field Guide | `src/lib/backstory.ts` (new) | Token + URL plumbing, `backstoryQuery`/`backstoryMutation`, `reviewErrorMessage` |
| Field Guide | `src/lib/backstory-types.ts` (new) | zod schemas for the queue and episode payloads (external data is validated) |
| Field Guide | `src/app/actions/admin-backstory.ts` (new) | Action envelope type + pure `FormData` parsers |
| Field Guide | `src/app/actions/admin-backstory-actions.ts` (new) | `'use server'` actions that call Backstory mutations |
| Field Guide | `src/app/admin/backstory/page.tsx` (new) | Queue |
| Field Guide | `src/app/admin/backstory/[storyId]/page.tsx` (new) | Episode review page |
| Field Guide | `src/components/admin/backstory-item-decision.tsx` (new) | Approve / reject / undo buttons for one item |
| Field Guide | `src/components/admin/backstory-episode-forms.tsx` (new) | Approve-episode form, speaker form, neighborhood form, do-not-use toggle |
| Field Guide | `src/app/admin/page.tsx` | One more card linking to `/admin/backstory` |
| Field Guide | `.env.example` | Append `BACKSTORY_CONVEX_URL` |

---

### Task 0: Field Guide CI and branch protection

The Field Guide is live on Vercel with no CI and no branch protection. Everything after this task lands in it, so CI goes first.

**Files:**
- Create: `~/Projects/mke-field-guide/.github/workflows/ci.yml`

**Interfaces:** Produces a GitHub check named `check` that later PRs must pass.

- [ ] **Step 1: Create the branch**

```bash
cd ~/Projects/mke-field-guide && git checkout -b tarikjmoody/moo-853-review-ui-at-field-guide-adminbackstory
```

- [ ] **Step 2: Confirm what passes locally today**

Run: `npm ci && npm run typecheck && npm test`
Expected: both pass (README says 448 tests on PGlite). If either fails on a clean `main`, stop and report; do not paper over it in CI.

- [ ] **Step 3: Write the workflow**

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
```

(`npm run build` is left to Vercel, which already builds every push; `lint` is left out unless Step 2 showed `npm run lint` clean, in which case add `- run: npm run lint`.)

- [ ] **Step 4: Commit and push, open a draft PR, watch it go green**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: typecheck and tests on every PR and push to main (MOO-853)"
git push -u origin tarikjmoody/moo-853-review-ui-at-field-guide-adminbackstory
gh pr create --draft --title "Backstory review UI at /admin/backstory (MOO-853)" --body "Draft. Plan: tmoody1973/backstory docs/superpowers/plans/2026-10-01-backstory-plan-2-review-ui.md"
gh run watch --exit-status $(gh run list --limit 1 --json databaseId --jq '.[0].databaseId')
```
Expected: exit 0.

- [ ] **Step 5: Prove CI can fail, then revert**

Break one assertion in any small test file (e.g. flip an expected value in `tests/lib/` to a wrong one with a `// deliberately broken` comment), commit "test: deliberately break one test to prove CI fails (will revert)", push, watch: expected exit 1, conclusion `failure`. Then `git revert --no-edit HEAD && git push` and watch: expected `success`.

- [ ] **Step 6: Branch protection (needs Tarik's go-ahead; it changes a live repo's settings)**

```bash
gh api -X PUT repos/tmoody1973/mke-field-guide/branches/main/protection --input - <<'EOF'
{ "required_status_checks": { "strict": true, "contexts": ["check"] },
  "enforce_admins": false, "required_pull_request_reviews": null, "restrictions": null,
  "allow_force_pushes": false, "allow_deletions": false }
EOF
```
Expected: JSON echo with `"contexts":["check"]`.

---

### Task 1: Convex trusts Clerk, and only listed reviewers get in

**Files:**
- Create: `convex/auth.config.ts`, `convex/lib/reviewers.ts`, `convex/lib/reviewAuth.ts`
- Test: `tests/lib/reviewers.test.ts`, `tests/reviewAuth.test.ts`

**Interfaces:**
- Produces: `parseReviewerList(raw: string | undefined): string[]`, `isReviewer(email: string | undefined, emailVerified: boolean | undefined, raw: string | undefined): boolean`, `requireReviewer(ctx: QueryCtx | MutationCtx): Promise<string>` (returns the lowercased email; throws `ConvexError({ code: "not_signed_in" })` or `ConvexError({ code: "not_a_reviewer" })`).

- [ ] **Step 0: Branch** (Backstory `main` is protected and requires the `check` CI)

```bash
cd ~/Projects/backstory && git checkout main && git pull --ff-only && git checkout -b tarikjmoody/moo-853-review-ui-at-field-guide-adminbackstory
```

- [ ] **Step 1: Write the failing pure tests**

`tests/lib/reviewers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isReviewer, parseReviewerList } from "../../convex/lib/reviewers";

const LIST = "tarik@radiomilwaukee.org, @example.org, not an email";

describe("parseReviewerList", () => {
  it("lowercases, trims and drops malformed entries", () => {
    expect(parseReviewerList(" Tarik@RadioMilwaukee.org ,@Example.org,,junk")).toEqual(["tarik@radiomilwaukee.org", "@example.org"]);
  });
  it("is empty when the env var is unset", () => {
    expect(parseReviewerList(undefined)).toEqual([]);
  });
});

describe("isReviewer", () => {
  it("accepts an exact verified email, any case", () => {
    expect(isReviewer("TARIK@radiomilwaukee.org", true, LIST)).toBe(true);
  });
  it("accepts any verified email at a listed domain, but not a subdomain or lookalike", () => {
    expect(isReviewer("kim@example.org", true, LIST)).toBe(true);
    expect(isReviewer("kim@mail.example.org", true, LIST)).toBe(false);
    expect(isReviewer("kim@badexample.org", true, LIST)).toBe(false);
  });
  it("refuses an unverified or missing email", () => {
    expect(isReviewer("tarik@radiomilwaukee.org", false, LIST)).toBe(false);
    expect(isReviewer("tarik@radiomilwaukee.org", undefined, LIST)).toBe(false);
    expect(isReviewer(undefined, true, LIST)).toBe(false);
  });
  it("anchors domain rules at the last @ so a quoted local part can't smuggle a mailbox", () => {
    expect(isReviewer('"x@example.org"@evil.com', true, LIST)).toBe(false);
  });
  it("refuses everyone when the list is empty (fail closed)", () => {
    expect(isReviewer("tarik@radiomilwaukee.org", true, "")).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run tests/lib/reviewers.test.ts`
Expected: FAIL, "Cannot find module '../../convex/lib/reviewers'".

- [ ] **Step 3: Implement `convex/lib/reviewers.ts`**

```ts
// Same rules as the Field Guide's src/lib/staff-auth.ts, so one allowlist syntax works in both places.
const DOMAIN_RULE = /^@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

const wellFormed = (entry: string) => (entry.startsWith("@") ? DOMAIN_RULE.test(entry) : entry.lastIndexOf("@") > 0);

export function parseReviewerList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0 && wellFormed(entry));
}

/** Domain rules ("@radiomilwaukee.org") match at the email's LAST @, never subdomains. */
export function isReviewer(email: string | undefined, emailVerified: boolean | undefined, raw: string | undefined): boolean {
  if (!email || emailVerified !== true) return false;
  const normalized = email.trim().toLowerCase();
  const domain = normalized.slice(normalized.lastIndexOf("@"));
  return parseReviewerList(raw).some((entry) => (entry.startsWith("@") ? domain === entry : normalized === entry));
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run tests/lib/reviewers.test.ts` → PASS (6 tests).

- [ ] **Step 5: Write the failing `requireReviewer` tests**

`requireReviewer` is exercised through a real query in Task 2; here, test it through a tiny probe. `tests/reviewAuth.test.ts`:

```ts
import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { makeTest } from "./helpers";

const REVIEWER = { email: "tarik@radiomilwaukee.org", emailVerified: true, subject: "user_1", issuer: "https://clerk.test" };

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

describe("requireReviewer (via review.queue)", () => {
  it("refuses a caller with no sign-in", async () => {
    process.env.BACKSTORY_REVIEWER_EMAILS = "tarik@radiomilwaukee.org";
    expect(await codeOf(makeTest().query(api.review.queue, {}))).toBe("not_signed_in");
  });
  it("refuses signed-in staff who are not on the reviewer list", async () => {
    process.env.BACKSTORY_REVIEWER_EMAILS = "someone-else@radiomilwaukee.org";
    expect(await codeOf(makeTest().withIdentity(REVIEWER).query(api.review.queue, {}))).toBe("not_a_reviewer");
  });
  it("refuses a listed email that Clerk has not verified", async () => {
    process.env.BACKSTORY_REVIEWER_EMAILS = "tarik@radiomilwaukee.org";
    const unverified = { ...REVIEWER, emailVerified: false };
    expect(await codeOf(makeTest().withIdentity(unverified).query(api.review.queue, {}))).toBe("not_a_reviewer");
  });
  it("lets a listed, verified reviewer in", async () => {
    process.env.BACKSTORY_REVIEWER_EMAILS = "@radiomilwaukee.org";
    expect(await codeOf(makeTest().withIdentity(REVIEWER).query(api.review.queue, {}))).toBe("ok");
  });
});
```

- [ ] **Step 6: Run, expect failure** (`api.review` does not exist yet)

Run: `npx vitest run tests/reviewAuth.test.ts` → FAIL.

- [ ] **Step 7: Implement `convex/lib/reviewAuth.ts` and `convex/auth.config.ts`**

`convex/lib/reviewAuth.ts`:

```ts
import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isReviewer } from "./reviewers";

/**
 * The security boundary for review. The MCP server trusts reviewStatus "approved",
 * so every review function calls this before reading or writing anything.
 */
export async function requireReviewer(ctx: QueryCtx | MutationCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "not_signed_in" });
  if (!isReviewer(identity.email, identity.emailVerified, process.env.BACKSTORY_REVIEWER_EMAILS)) {
    console.warn(`review: refused ${identity.email ?? identity.subject} (verified: ${identity.emailVerified ?? false})`);
    throw new ConvexError({ code: "not_a_reviewer" });
  }
  return identity.email!.trim().toLowerCase();
}
```

`convex/auth.config.ts` (from https://docs.convex.dev/auth/clerk):

```ts
import type { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      // Clerk's Frontend API URL, set in the Convex dashboard (Task 9). Field Guide editors sign in with this Clerk instance.
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
```

Create a temporary `convex/review.ts` so the probe has something to call (Task 2 replaces the body):

```ts
import { query } from "./_generated/server";
import { requireReviewer } from "./lib/reviewAuth";

export const queue = query({
  args: {},
  handler: async (ctx) => {
    await requireReviewer(ctx);
    return [];
  },
});
```

- [ ] **Step 8: Run, expect pass; full suite and typecheck**

Run: `npx vitest run tests/reviewAuth.test.ts tests/lib/reviewers.test.ts && npx vitest run && npm run typecheck`
Expected: all pass. (`npx convex dev --once` is NOT run yet: `auth.config.ts` needs `CLERK_JWT_ISSUER_DOMAIN`, set in Task 9.)

- [ ] **Step 9: Commit**

```bash
git add convex/auth.config.ts convex/lib/reviewers.ts convex/lib/reviewAuth.ts convex/review.ts tests/lib/reviewers.test.ts tests/reviewAuth.test.ts
git commit -m "feat: Convex trusts Clerk tokens; review functions require a verified, allowlisted reviewer (MOO-853)"
```

---

### Task 2: Review read queries (`queue`, `episode`)

**Files:**
- Modify: `convex/schema.ts` (stories: two fields, one index), `convex/review.ts`
- Test: `tests/review.test.ts`

**Interfaces:**
- Consumes: `requireReviewer` (Task 1); `seedStory`, `saveRun`, `makeTest` from `tests/helpers.ts`; `getShowProfile` from `convex/lib/shows.ts`; `isLowConfidence` from `convex/lib/geocode.ts`.
- Produces:
  - `api.review.queue` args `{ showSlug?: string }` → `QueueRow[]` where `QueueRow = { storyId, title, showSlug, showName, reviewer, contentType: "episode", publishedAt, stage, reviewStatus, doNotUse, needsReview: "new" | "reprocessed" | "pipeline_failed" }`.
  - `api.review.episode` args `{ storyId }` → `null` or `{ story, speakers, mentions, places, topics, actions }` (shape in Step 3; Field Guide's zod schema in Task 5 mirrors it exactly).

- [ ] **Step 1: Schema**

In `convex/schema.ts`, inside `stories: defineTable({...})` add after `doNotUse: v.boolean(),`:

```ts
    approvedBy: v.optional(v.string()), // verified email of the editor who approved the live run
    approvedAt: v.optional(v.number()),
```

and add an index to `stories`:

```ts
    .index("by_reviewStatus_and_publishedAt", ["reviewStatus", "publishedAt"])
```

- [ ] **Step 2: Write the failing tests** — `tests/review.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { makeTest, saveRun, seedStory, type TestConvex } from "./helpers";

const REVIEWER = { email: "tarik@radiomilwaukee.org", emailVerified: true, subject: "user_1", issuer: "https://clerk.test" };

beforeEach(() => {
  process.env.BACKSTORY_REVIEWER_EMAILS = "tarik@radiomilwaukee.org";
});
afterEach(() => {
  delete process.env.BACKSTORY_REVIEWER_EMAILS;
});

/** Saving a run sets stage "extracted"; the geocode step then sets "geocoded". Tests skip the geocode step. */
async function geocoded(t: TestConvex, storyId: Id<"stories">) {
  await t.run((ctx) => ctx.db.patch("stories", storyId, { stage: "geocoded" }));
}

async function readyStory(t: TestConvex, overrides = {}) {
  const storyId = await seedStory(t, overrides);
  await saveRun(t, storyId, "run-1");
  await geocoded(t, storyId);
  await t.run(async (ctx) => {
    await ctx.db.insert("transcriptSegments", { storyId, idx: 0, speaker: "spk_0", startMs: 0, endMs: 3000, text: "Welcome to This Bites." });
    await ctx.db.insert("transcriptSegments", { storyId, idx: 1, speaker: "spk_1", startMs: 3000, endMs: 9000, text: "A bittersweet farewell to Café Corazón in Bay View." });
  });
  return storyId;
}

describe("review.queue", () => {
  it("lists episodes waiting for review, newest first, with the show's reviewer", async () => {
    const t = makeTest();
    const older = await readyStory(t, { cdsId: "a", publishedAt: 1 });
    const newer = await readyStory(t, { cdsId: "b", publishedAt: 2 });
    await seedStory(t, { cdsId: "c", stage: "transcribing" }); // not ready: not listed
    const rows = await t.withIdentity(REVIEWER).query(api.review.queue, {});
    expect(rows.map((row) => row.storyId)).toEqual([newer, older]);
    expect(rows[0]).toMatchObject({ showName: "This Bites", reviewer: "Tarik Moody", needsReview: "new" });
  });

  it("includes a failed pipeline and an approved story whose newer run awaits review", async () => {
    const t = makeTest();
    const failed = await seedStory(t, { cdsId: "f", stage: "needs_editor" });
    const live = await readyStory(t, { cdsId: "l" });
    await t.mutation(internal.admin.approveLatestRunForDemo, { storyId: live });
    expect((await t.withIdentity(REVIEWER).query(api.review.queue, {})).map((r) => r.storyId)).toEqual([failed]);
    await saveRun(t, live, "run-2");
    expect((await t.withIdentity(REVIEWER).query(api.review.queue, {})).map((r) => r.storyId)).toEqual([failed]); // still geocoding
    await geocoded(t, live);
    const rows = await t.withIdentity(REVIEWER).query(api.review.queue, {});
    expect(rows.find((r) => r.storyId === live)?.needsReview).toBe("reprocessed");
    expect(rows.find((r) => r.storyId === failed)?.needsReview).toBe("pipeline_failed");
  });

  it("filters by show", async () => {
    const t = makeTest();
    await readyStory(t, { cdsId: "tb" });
    const um = await readyStory(t, { cdsId: "um", showSlug: "uniquely-milwaukee" });
    const rows = await t.withIdentity(REVIEWER).query(api.review.queue, { showSlug: "uniquely-milwaukee" });
    expect(rows.map((r) => r.storyId)).toEqual([um]);
  });
});

describe("review.episode", () => {
  it("returns the latest run's items with quotes, speakers with a sample line, places low-confidence first", async () => {
    const t = makeTest();
    const storyId = await readyStory(t);
    const episode = await t.withIdentity(REVIEWER).query(api.review.episode, { storyId });
    expect(episode?.story).toMatchObject({ title: expect.any(String), latestRunId: "run-1", proposedSummary: expect.any(String) });
    expect(episode?.speakers).toEqual([
      { label: "spk_0", name: null, source: null, sample: "Welcome to This Bites." },
      { label: "spk_1", name: null, source: null, sample: "A bittersweet farewell to Café Corazón in Bay View." },
    ]);
    expect(episode?.mentions.map((m) => m.name)).toEqual(["Joe Sasto"]); // places are listed under places
    expect(episode?.places[0]).toMatchObject({ name: "Café Corazón", quote: "a bittersweet farewell to Café Corazón in Bay View" });
    expect(episode?.topics[0]).toMatchObject({ topic: "food-drink", reviewStatus: "pending" });
    expect(episode?.actions[0]).toMatchObject({ label: "Visit Café Corazón in Riverwest", place: "Café Corazón" });
  });

  it("returns null for a story with no extraction yet", async () => {
    const t = makeTest();
    const storyId = await seedStory(t);
    expect(await t.withIdentity(REVIEWER).query(api.review.episode, { storyId })).toBeNull();
  });
});
```

- [ ] **Step 3: Run, expect failure** — `npx vitest run tests/review.test.ts` → FAIL (`queue` returns `[]`, `episode` missing).

- [ ] **Step 4: Implement `convex/review.ts`**

```ts
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { requireReviewer } from "./lib/reviewAuth";
import { getShowProfile } from "./lib/shows";

// ponytail: newest 100 per status; a cursor-paged queue when the backfill makes the backlog longer than that.
const QUEUE_LIMIT = 100;
// A run holds at most 40 mentions, 3 topics and 10 actions (extraction schema).
const MAX_ROWS_PER_RUN = 200;
// Deepgram utterances for a 56-minute episode stay well under this.
const MAX_SEGMENTS = 4000;

type NeedsReview = "new" | "reprocessed" | "pipeline_failed";

function needsReview(story: Doc<"stories">): NeedsReview | null {
  if (story.stage === "needs_editor") return "pipeline_failed";
  if (story.stage !== "geocoded" || !story.latestRunId) return null;
  if (story.reviewStatus === "pending") return "new";
  return story.reviewStatus === "approved" && story.latestRunId !== story.approvedRunId ? "reprocessed" : null;
}

export const queue = query({
  args: { showSlug: v.optional(v.string()) },
  handler: async (ctx, { showSlug }) => {
    await requireReviewer(ctx);
    const byStatus = (status: "pending" | "approved") =>
      ctx.db.query("stories").withIndex("by_reviewStatus_and_publishedAt", (q) => q.eq("reviewStatus", status)).order("desc").take(QUEUE_LIMIT);
    const stories = [...(await byStatus("pending")), ...(await byStatus("approved"))]
      .filter((story) => !showSlug || story.showSlug === showSlug)
      .sort((a, b) => b.publishedAt - a.publishedAt);
    return stories.flatMap((story) => {
      const reason = needsReview(story);
      if (!reason) return [];
      const profile = getShowProfile(story.showSlug);
      return [{
        storyId: story._id, title: story.title, showSlug: story.showSlug, showName: profile.name, reviewer: profile.reviewer,
        contentType: story.contentType, publishedAt: story.publishedAt, stage: story.stage,
        reviewStatus: story.reviewStatus, doNotUse: story.doNotUse, needsReview: reason,
      }];
    });
  },
});

export const episode = query({
  args: { storyId: v.id("stories") },
  handler: async (ctx, { storyId }) => {
    await requireReviewer(ctx);
    const story = await ctx.db.get("stories", storyId);
    const runId = story?.latestRunId;
    if (!story || !runId) return null;
    const inRun = { storyId, runId };
    const byRun = <T extends "mentions" | "places" | "storyTopics" | "storyActions">(table: T) =>
      ctx.db.query(table).withIndex("by_storyId_and_runId", (q) => q.eq("storyId", inRun.storyId).eq("runId", inRun.runId)).take(MAX_ROWS_PER_RUN);
    const [mentions, places, topics, actions] = [await byRun("mentions"), await byRun("places"), await byRun("storyTopics"), await byRun("storyActions")];
    const mentionById = new Map(mentions.map((m) => [m._id, m]));
    const profile = getShowProfile(story.showSlug);
    return {
      story: {
        storyId, title: story.title, showSlug: story.showSlug, showName: profile.name, reviewer: profile.reviewer,
        publishedAt: story.publishedAt, audioUrl: story.audioUrl, permalink: story.permalink ?? null, stage: story.stage,
        reviewStatus: story.reviewStatus, doNotUse: story.doNotUse, proposedSummary: story.proposedSummary ?? "",
        summary: story.summary ?? null, latestRunId: runId, approvedRunId: story.approvedRunId ?? null,
        approvedBy: story.approvedBy ?? null, approvedAt: story.approvedAt ?? null,
      },
      speakers: await speakersFor(ctx, storyId),
      mentions: mentions.filter((m) => m.entityType !== "place").map((m) => ({
        id: m._id, entityType: m.entityType, name: m.name, quote: m.quote, startMs: m.startMs,
        subjectConfidence: m.subjectConfidence ?? null, reviewStatus: m.reviewStatus, doNotUse: m.doNotUse,
      })),
      places: places
        .map((p) => ({
          id: p._id, mentionId: p.mentionId, name: p.name, officialName: p.officialName ?? null, category: p.category,
          geocodeLabel: p.geocodeLabel ?? null, geocodeConfidence: p.geocodeConfidence ?? null, neighborhood: p.neighborhood ?? null,
          quote: mentionById.get(p.mentionId)?.quote ?? "", startMs: mentionById.get(p.mentionId)?.startMs ?? 0, reviewStatus: p.reviewStatus,
        }))
        .sort((a, b) => (a.geocodeConfidence ?? -1) - (b.geocodeConfidence ?? -1)), // no pin at all, then weakest pins, first
      topics: topics.map((t) => ({ id: t._id, topic: t.topic, confidence: t.confidence, quote: t.quote, startMs: t.startMs, reviewStatus: t.reviewStatus })),
      actions: actions.map((a) => ({
        id: a._id, kind: a.kind, label: a.label, quote: a.quote, startMs: a.startMs, reviewStatus: a.reviewStatus,
        place: a.placeMentionId ? (mentionById.get(a.placeMentionId)?.name ?? null) : null,
      })),
    };
  },
});
```

Add the helper at the bottom of the same file (keep `episode` under ~50 lines by moving it out):

```ts
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/** One row per transcript speaker label, in order of first appearance, with their first line so an editor can tell who it is. */
async function speakersFor(ctx: QueryCtx, storyId: Id<"stories">) {
  const segments = await ctx.db.query("transcriptSegments").withIndex("by_storyId_and_idx", (q) => q.eq("storyId", storyId)).take(MAX_SEGMENTS);
  const names = await ctx.db.query("speakerNames").withIndex("by_storyId", (q) => q.eq("storyId", storyId)).take(50);
  const firstLine = new Map<string, string>();
  for (const segment of segments) if (!firstLine.has(segment.speaker)) firstLine.set(segment.speaker, segment.text);
  return [...firstLine].map(([label, sample]) => {
    const named = names.find((row) => row.label === label);
    return { label, name: named?.name ?? null, source: named?.source ?? null, sample };
  });
}
```

(Merge the two `import type` lines into the file's import block.)

- [ ] **Step 5: Run, expect pass; full suite; typecheck**

Run: `npx vitest run tests/review.test.ts tests/reviewAuth.test.ts && npx vitest run && npm run typecheck` → all pass. If `byRun`'s generic table name fails to typecheck against `withIndex`, write the four queries out explicitly (same as `convex/public.ts` does); do not add `any`.

- [ ] **Step 6: Commit**

```bash
git add convex/schema.ts convex/review.ts tests/review.test.ts
git commit -m "feat: reviewer-only queue and episode queries for the review UI (MOO-853)"
```

---

### Task 3: Review write mutations

**Files:**
- Create: `convex/lib/approveRun.ts`, `convex/reviewMutations.ts`, `docs/decisions/010-what-approve-episode-approves.md`
- Modify: `convex/admin.ts` (use `approveRun`), `convex/lib/shows.ts` (UM reviewer)
- Test: `tests/reviewMutations.test.ts`

**Interfaces:**
- Consumes: `requireReviewer`; `isLowConfidence` (`convex/lib/geocode.ts`); `REVIEWER`, `readyStory` pattern from Task 2 tests (re-declare locally; tests files don't import each other).
- Produces (all `api.reviewMutations.*`, all start with `requireReviewer`):
  - `decideItem({ item: { table: "mentions" | "places" | "storyTopics" | "storyActions", id }, status: "approved" | "rejected" | "pending" })`
  - `approveEpisode({ storyId, runId: string, summary: string })` → `{ approvedRunId: string }`
  - `setSpeakerName({ storyId, label: string, name: string })` (empty name removes the editor's name)
  - `setPlaceNeighborhood({ placeId, neighborhood: string | null })`
  - `setDoNotUse({ target: { table: "stories", id } | { table: "mentions", id }, doNotUse: boolean })`
  - `approveRun(ctx, storyId, runId): Promise<void>` in `convex/lib/approveRun.ts`
  - Error codes (as `ConvexError({ code })`): `"stale_run"`, `"not_found"`, `"invalid_summary"`, `"invalid_name"`, `"invalid_neighborhood"`.

- [ ] **Step 1: Write the failing tests** — `tests/reviewMutations.test.ts`:

```ts
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
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

async function ready(t: TestConvex) {
  const storyId = await seedStory(t, { stage: "geocoded" });
  await saveRun(t, storyId, "run-1");
  return storyId;
}

const rows = (t: TestConvex, table: "mentions" | "places" | "storyTopics" | "storyActions") => t.run((ctx) => ctx.db.query(table).take(100));

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
```

- [ ] **Step 2: Run, expect failure** — `npx vitest run tests/reviewMutations.test.ts` → FAIL (module missing).

- [ ] **Step 3: Move the approval loop into `convex/lib/approveRun.ts`**

Cut the four loops out of `approveLatestRunForDemo` in `convex/admin.ts` into:

```ts
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { isLowConfidence } from "./geocode";

// A run holds at most 40 mentions, 3 topics and 10 actions (extraction schema).
const MAX_ROWS_PER_RUN = 200;

/**
 * Approve every still-pending row of a run (decision 010). Rows an editor rejected stay rejected.
 * A place with no confident pin stays pending unless an editor approved it by hand: the pin could be
 * the wrong branch or someone's street.
 */
export async function approveRun(ctx: MutationCtx, storyId: Id<"stories">, runId: string): Promise<void> {
  const inRun = (table: "mentions" | "places" | "storyTopics" | "storyActions") =>
    ctx.db.query(table).withIndex("by_storyId_and_runId", (q) => q.eq("storyId", storyId).eq("runId", runId)).take(MAX_ROWS_PER_RUN);
  for (const row of await inRun("mentions")) if (row.reviewStatus === "pending") await ctx.db.patch("mentions", row._id, { reviewStatus: "approved" });
  for (const row of await inRun("places")) {
    const confident = row.geocodeConfidence !== undefined && !isLowConfidence(row.geocodeConfidence);
    if (row.reviewStatus === "pending" && confident) await ctx.db.patch("places", row._id, { reviewStatus: "approved" });
  }
  for (const row of await inRun("storyTopics")) if (row.reviewStatus === "pending") await ctx.db.patch("storyTopics", row._id, { reviewStatus: "approved" });
  for (const row of await inRun("storyActions")) if (row.reviewStatus === "pending") await ctx.db.patch("storyActions", row._id, { reviewStatus: "approved" });
}
```

(Same generic-table caveat as Task 2: if `inRun` doesn't typecheck, write the four queries out.) In `admin.ts`, `approveLatestRunForDemo` becomes: load story, guard, `await approveRun(ctx, storyId, runId)`, patch the story. Remove now-unused imports and the local `MAX_ROWS_PER_RUN`. Run `npx vitest run tests/public.test.ts` → still PASS (behavior unchanged).

- [ ] **Step 4: Implement `convex/reviewMutations.ts`**

```ts
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";
import { approveRun } from "./lib/approveRun";
import { requireReviewer } from "./lib/reviewAuth";
import { reviewStatusValidator } from "./schema";

const MAX_SUMMARY = 1500; // same cap as the extraction schema
const MAX_NAME = 80;
const MAX_NEIGHBORHOOD = 60;

const itemValidator = v.union(
  v.object({ table: v.literal("mentions"), id: v.id("mentions") }),
  v.object({ table: v.literal("places"), id: v.id("places") }),
  v.object({ table: v.literal("storyTopics"), id: v.id("storyTopics") }),
  v.object({ table: v.literal("storyActions"), id: v.id("storyActions") }),
);

/** Only the run under review or the run on the air can change; older runs are history. */
async function assertLiveRun(ctx: MutationCtx, row: { storyId: Doc<"stories">["_id"]; runId: string } | null) {
  if (!row) throw new ConvexError({ code: "not_found" });
  const story = await ctx.db.get("stories", row.storyId);
  if (!story || (row.runId !== story.latestRunId && row.runId !== story.approvedRunId)) throw new ConvexError({ code: "stale_run" });
}

export const decideItem = mutation({
  args: { item: itemValidator, status: reviewStatusValidator },
  handler: async (ctx, { item, status }) => {
    await requireReviewer(ctx);
    switch (item.table) {
      case "mentions":
        await assertLiveRun(ctx, await ctx.db.get("mentions", item.id));
        return ctx.db.patch("mentions", item.id, { reviewStatus: status });
      case "places":
        await assertLiveRun(ctx, await ctx.db.get("places", item.id));
        return ctx.db.patch("places", item.id, { reviewStatus: status });
      case "storyTopics":
        await assertLiveRun(ctx, await ctx.db.get("storyTopics", item.id));
        return ctx.db.patch("storyTopics", item.id, { reviewStatus: status });
      case "storyActions":
        await assertLiveRun(ctx, await ctx.db.get("storyActions", item.id));
        return ctx.db.patch("storyActions", item.id, { reviewStatus: status });
    }
  },
});

export const approveEpisode = mutation({
  args: { storyId: v.id("stories"), runId: v.string(), summary: v.string() },
  handler: async (ctx, { storyId, runId, summary }) => {
    const email = await requireReviewer(ctx);
    const trimmed = summary.trim();
    if (!trimmed || trimmed.length > MAX_SUMMARY) throw new ConvexError({ code: "invalid_summary" });
    const story = await ctx.db.get("stories", storyId);
    if (!story) throw new ConvexError({ code: "not_found" });
    if (story.latestRunId !== runId) throw new ConvexError({ code: "stale_run" });
    await approveRun(ctx, storyId, runId);
    await ctx.db.patch("stories", storyId, {
      summary: trimmed, approvedRunId: runId, reviewStatus: "approved", approvedBy: email, approvedAt: Date.now(),
    });
    return { approvedRunId: runId };
  },
});

export const setSpeakerName = mutation({
  args: { storyId: v.id("stories"), label: v.string(), name: v.string() },
  handler: async (ctx, { storyId, label, name }) => {
    await requireReviewer(ctx);
    const trimmed = name.trim();
    if (trimmed.length > MAX_NAME) throw new ConvexError({ code: "invalid_name" });
    const existing = (await ctx.db.query("speakerNames").withIndex("by_storyId", (q) => q.eq("storyId", storyId)).take(50))
      .find((row) => row.label === label);
    if (!trimmed) {
      if (existing) await ctx.db.delete("speakerNames", existing._id);
      return;
    }
    if (existing) await ctx.db.patch("speakerNames", existing._id, { name: trimmed, source: "editor", confidence: undefined });
    else await ctx.db.insert("speakerNames", { storyId, label, name: trimmed, source: "editor" });
  },
});

export const setPlaceNeighborhood = mutation({
  args: { placeId: v.id("places"), neighborhood: v.union(v.string(), v.null()) },
  handler: async (ctx, { placeId, neighborhood }) => {
    await requireReviewer(ctx);
    const trimmed = neighborhood?.trim() || undefined;
    if (trimmed && trimmed.length > MAX_NEIGHBORHOOD) throw new ConvexError({ code: "invalid_neighborhood" });
    await assertLiveRun(ctx, await ctx.db.get("places", placeId));
    await ctx.db.patch("places", placeId, { neighborhood: trimmed });
  },
});

export const setDoNotUse = mutation({
  args: {
    target: v.union(v.object({ table: v.literal("stories"), id: v.id("stories") }), v.object({ table: v.literal("mentions"), id: v.id("mentions") })),
    doNotUse: v.boolean(),
  },
  handler: async (ctx, { target, doNotUse }) => {
    await requireReviewer(ctx);
    if (target.table === "stories") {
      if (!(await ctx.db.get("stories", target.id))) throw new ConvexError({ code: "not_found" });
      return ctx.db.patch("stories", target.id, { doNotUse });
    }
    await assertLiveRun(ctx, await ctx.db.get("mentions", target.id));
    return ctx.db.patch("mentions", target.id, { doNotUse });
  },
});
```

Check `convex/_generated/ai/guidelines.md` for the current `ctx.db.delete` signature (table-name first, like `get`/`patch`); match it.

- [ ] **Step 5: Run, expect pass; full suite; typecheck**

Run: `npx vitest run tests/reviewMutations.test.ts tests/public.test.ts && npx vitest run && npm run typecheck` → all pass.

- [ ] **Step 6: Name the UM reviewer**

In `convex/lib/shows.ts`, replace the UM `ponytail:` placeholder and its `reviewer` value with the name from Prerequisite 1. If Tarik hasn't named one yet, leave the placeholder and note it in the Task 9 report; do not invent a name.

- [ ] **Step 7: Write decision 010** — `docs/decisions/010-what-approve-episode-approves.md`:

```markdown
# 010: "Approve episode" approves every item the editor didn't reject, except uncertain map pins

**Decision:** Clicking "Approve episode" publishes the run: every item still pending becomes approved, items the editor rejected stay rejected, and a place whose map pin is uncertain stays pending unless the editor approved it by hand.

**Why this came up:** The spec asks for "an approve button per item" and an episode approve "that makes everything readable at once". An episode has up to 40 people and places, 3 topics and 10 actions. If every item needed its own click, review would blow the 10-minute-per-episode goal; if one click approved everything, a wrong map pin could send a listener to the wrong branch or a private street.

**Options:**
- Approve everything not rejected, including uncertain pins. Fastest; one bad geocode goes live unseen.
- Approve everything not rejected, except uncertain pins (chosen). Same speed; the risky category needs a deliberate click. Cost: an editor who skims past a pending pin leaves that place off the air until they come back.
- Require every item to be decided before the episode can be approved. Safest; slowest, and editors learn to click "approve" forty times without reading.

**What we chose and why:** The middle option (Claude proposed, matching the demo approval Tarik already used in Plan 1). Review is a "reject what's wrong" pass, which is how editors actually read; map pins get the extra gate because a wrong pin is the one mistake a listener acts on physically.

**What we gave up:** A pending item the editor never looked at goes live on approval. The evidence-quote check limits the damage (nothing is published without a verbatim quote), but it isn't a human check.

**How we'll know if this was right:** In the first 20 real reviews, count items that went live by default and were later found wrong. More than one per ten episodes means switching to "decide every item".

**What actually happened:**
```

- [ ] **Step 8: Commit**

```bash
git add convex/lib/approveRun.ts convex/admin.ts convex/reviewMutations.ts convex/lib/shows.ts tests/reviewMutations.test.ts docs/decisions/010-what-approve-episode-approves.md
git commit -m "feat: reviewer-only approve, reject, speaker, neighborhood and do-not-use mutations (MOO-853)"
```

---

### Task 4: Backstory PR and CI

**Files:** none new.

- [ ] **Step 1:** `git push -u origin tarikjmoody/moo-853-review-ui-at-field-guide-adminbackstory` (the branch from Task 1 Step 0).
- [ ] **Step 2:** `gh pr create --draft --title "Review functions for the Field Guide review UI (MOO-853)"` with a body listing the new public functions and the security rule. Watch CI: `gh run watch --exit-status <id>` → success. Do not merge until Task 9.

---

### Task 5: Field Guide → Backstory client

**Files:**
- Create: `src/lib/backstory.ts`, `src/lib/backstory-types.ts`
- Modify: `.env.example` (append)
- Test: `tests/lib/backstory.test.ts`

**Interfaces:**
- Consumes: Backstory `api.review.queue` / `api.review.episode` payloads (Task 2) and error codes (Tasks 1, 3).
- Produces: `backstoryQuery<T>(name: "review:queue" | "review:episode", args, schema: z.ZodType<T>): Promise<T>`, `backstoryMutation(name: BackstoryMutation, args): Promise<unknown>`, `reviewErrorMessage(error: unknown): string`, `queueSchema`, `episodeSchema`, types `QueueRow`, `Episode`.

- [ ] **Step 1: Read the docs first.** `node_modules/next/dist/docs/` (server components data fetching) and `node_modules/convex/dist/esm/nextjs/index.d.ts` (confirm `fetchQuery(fn, args, { token, url })`).

- [ ] **Step 2: Write the failing tests** — `tests/lib/backstory.test.ts`:

```ts
import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';
import { reviewErrorMessage } from '@/lib/backstory';
import { episodeSchema, queueSchema } from '@/lib/backstory-types';

const QUEUE_ROW = {
  storyId: 'k1', title: 'Café Corazón and turkey talk', showSlug: 'this-bites', showName: 'This Bites',
  reviewer: 'Tarik Moody', contentType: 'episode', publishedAt: 1758207600000, stage: 'geocoded',
  reviewStatus: 'pending', doNotUse: false, needsReview: 'new',
};

const EPISODE = {
  story: {
    storyId: 'k1', title: 'Café Corazón and turkey talk', showSlug: 'this-bites', showName: 'This Bites', reviewer: 'Tarik Moody',
    publishedAt: 1758207600000, audioUrl: 'https://example.com/a.mp3', permalink: null, stage: 'geocoded', reviewStatus: 'pending',
    doNotUse: false, proposedSummary: 'The hosts preview a festival.', summary: null, latestRunId: 'run-1', approvedRunId: null,
    approvedBy: null, approvedAt: null,
  },
  speakers: [{ label: 'spk_0', name: null, source: null, sample: 'Welcome to This Bites.' }],
  mentions: [{ id: 'm1', entityType: 'person', name: 'Joe Sasto', quote: 'chefs Joe Sasto and Dan Jacobs', startMs: 20000, subjectConfidence: 0.9, reviewStatus: 'pending', doNotUse: false }],
  places: [{ id: 'p1', mentionId: 'm2', name: 'Café Corazón', officialName: null, category: 'restaurant', geocodeLabel: null, geocodeConfidence: null, neighborhood: null, quote: 'a bittersweet farewell to Café Corazón in Bay View', startMs: 4000, reviewStatus: 'pending' }],
  topics: [{ id: 't1', topic: 'food-drink', confidence: 0.95, quote: 'a bittersweet farewell to Café Corazón', startMs: 4000, reviewStatus: 'pending' }],
  actions: [{ id: 'a1', kind: 'visit', label: 'Visit Café Corazón in Riverwest', quote: 'their Riverwest and Brown Deer locations remain open', startMs: 9000, reviewStatus: 'pending', place: 'Café Corazón' }],
};

describe('Backstory payload schemas', () => {
  it('accept the shapes Backstory returns', () => {
    expect(queueSchema.parse([QUEUE_ROW])).toHaveLength(1);
    expect(episodeSchema.parse(EPISODE).places[0].name).toBe('Café Corazón');
  });
  it('reject a payload missing an evidence quote', () => {
    const { quote: _dropped, ...noQuote } = EPISODE.topics[0];
    expect(() => episodeSchema.parse({ ...EPISODE, topics: [noQuote] })).toThrow();
  });
});

describe('reviewErrorMessage', () => {
  it('explains each Backstory refusal in plain words', () => {
    expect(reviewErrorMessage(new ConvexError({ code: 'not_a_reviewer' }))).toBe("You're signed in, but not on the Backstory reviewer list.");
    expect(reviewErrorMessage(new ConvexError({ code: 'stale_run' }))).toBe('This episode was re-processed since you opened it. Reload to review the new version.');
    expect(reviewErrorMessage(new ConvexError({ code: 'invalid_summary' }))).toBe('The summary must be between 1 and 1,500 characters.');
  });
  it('never leaks an unexpected error to the page', () => {
    expect(reviewErrorMessage(new Error('connect ECONNREFUSED 10.0.0.1'))).toBe('Backstory is unavailable right now. Try again in a minute.');
  });
});
```

- [ ] **Step 3: Run, expect failure** — `npx vitest run tests/lib/backstory.test.ts` → FAIL.

- [ ] **Step 4: Implement `src/lib/backstory-types.ts`**

```ts
import { z } from 'zod';

const status = z.enum(['pending', 'approved', 'rejected']);
const quoted = { quote: z.string().min(1), startMs: z.number() };

export const queueSchema = z.array(z.object({
  storyId: z.string(), title: z.string(), showSlug: z.string(), showName: z.string(), reviewer: z.string(),
  contentType: z.string(), publishedAt: z.number(), stage: z.string(), reviewStatus: status, doNotUse: z.boolean(),
  needsReview: z.enum(['new', 'reprocessed', 'pipeline_failed']),
}));

export const episodeSchema = z.object({
  story: z.object({
    storyId: z.string(), title: z.string(), showSlug: z.string(), showName: z.string(), reviewer: z.string(),
    publishedAt: z.number(), audioUrl: z.string(), permalink: z.string().nullable(), stage: z.string(), reviewStatus: status,
    doNotUse: z.boolean(), proposedSummary: z.string(), summary: z.string().nullable(), latestRunId: z.string(),
    approvedRunId: z.string().nullable(), approvedBy: z.string().nullable(), approvedAt: z.number().nullable(),
  }),
  speakers: z.array(z.object({ label: z.string(), name: z.string().nullable(), source: z.enum(['suggested', 'editor']).nullable(), sample: z.string() })),
  mentions: z.array(z.object({ id: z.string(), entityType: z.string(), name: z.string(), ...quoted, subjectConfidence: z.number().nullable(), reviewStatus: status, doNotUse: z.boolean() })),
  places: z.array(z.object({
    id: z.string(), mentionId: z.string(), name: z.string(), officialName: z.string().nullable(), category: z.string(),
    geocodeLabel: z.string().nullable(), geocodeConfidence: z.number().nullable(), neighborhood: z.string().nullable(), ...quoted, reviewStatus: status,
  })),
  topics: z.array(z.object({ id: z.string(), topic: z.string(), confidence: z.number(), ...quoted, reviewStatus: status })),
  actions: z.array(z.object({ id: z.string(), kind: z.string(), label: z.string(), ...quoted, reviewStatus: status, place: z.string().nullable() })),
});

export type QueueRow = z.infer<typeof queueSchema>[number];
export type Episode = z.infer<typeof episodeSchema>;
```

- [ ] **Step 5: Implement `src/lib/backstory.ts`**

```ts
import { auth } from '@clerk/nextjs/server';
import { fetchMutation, fetchQuery } from 'convex/nextjs';
import { makeFunctionReference } from 'convex/server';
import { ConvexError } from 'convex/values';
import type { z } from 'zod';

// Backstory's functions live in another repo (tmoody1973/backstory), so they're referenced by name, the way
// src/app/api/now-playing/route.ts references the playlist deployment. Every one checks the reviewer allowlist itself.
type BackstoryQuery = 'review:queue' | 'review:episode';
export type BackstoryMutation =
  | 'reviewMutations:decideItem' | 'reviewMutations:approveEpisode' | 'reviewMutations:setSpeakerName'
  | 'reviewMutations:setPlaceNeighborhood' | 'reviewMutations:setDoNotUse';

const MESSAGES: Record<string, string> = {
  not_signed_in: 'Your sign-in expired. Reload the page to sign in again.',
  not_a_reviewer: "You're signed in, but not on the Backstory reviewer list.",
  stale_run: 'This episode was re-processed since you opened it. Reload to review the new version.',
  invalid_summary: 'The summary must be between 1 and 1,500 characters.',
  invalid_name: 'Speaker names are at most 80 characters.',
  invalid_neighborhood: 'Pick a neighborhood from the list.',
  not_found: 'That item no longer exists. Reload the page.',
};
const UNAVAILABLE = 'Backstory is unavailable right now. Try again in a minute.';

export function reviewErrorMessage(error: unknown): string {
  const code = error instanceof ConvexError ? (error.data as { code?: string })?.code : undefined;
  return (code && MESSAGES[code]) || UNAVAILABLE;
}

async function connection(): Promise<{ token: string; url: string }> {
  const url = process.env.BACKSTORY_CONVEX_URL;
  if (!url) throw new Error('BACKSTORY_CONVEX_URL is not set');
  // Clerk mints a token Backstory's convex/auth.config.ts trusts (applicationID "convex").
  const token = await (await auth()).getToken({ template: 'convex' });
  if (!token) throw new ConvexError({ code: 'not_signed_in' });
  return { token, url };
}

export async function backstoryQuery<T>(name: BackstoryQuery, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const result = await fetchQuery(makeFunctionReference<'query'>(name), args, await connection());
  return schema.parse(result);
}

export async function backstoryMutation(name: BackstoryMutation, args: Record<string, unknown>): Promise<unknown> {
  return fetchMutation(makeFunctionReference<'mutation'>(name), args, await connection());
}
```

If `makeFunctionReference` isn't exported by the installed `convex` version, use `anyApi` from `convex/server` (as `now-playing/route.ts` does): `anyApi.review.queue`, etc. Verify in `node_modules/convex/dist/esm/server/index.d.ts` before choosing.

- [ ] **Step 6: Append to `.env.example`**

```
# --- Backstory review (MOO-853) ---
# Backstory's Convex deployment URL (https://<name>.convex.cloud). Server-only: never NEXT_PUBLIC_.
# Absent: /admin/backstory shows "Backstory is unavailable"; nothing else is affected.
BACKSTORY_CONVEX_URL=
```

- [ ] **Step 7: Run, expect pass; typecheck** — `npx vitest run tests/lib/backstory.test.ts && npm run typecheck`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/backstory.ts src/lib/backstory-types.ts tests/lib/backstory.test.ts .env.example
git commit -m "feat: server-side Backstory client with validated payloads and plain-English errors (MOO-853)"
```

---

### Task 6: Field Guide server actions

**Files:**
- Create: `src/app/actions/admin-backstory.ts`, `src/app/actions/admin-backstory-actions.ts`
- Test: `tests/actions/admin-backstory.test.ts`

**Interfaces:**
- Consumes: `backstoryMutation`, `reviewErrorMessage` (Task 5); `currentStaffRole` (`src/lib/staff-guard.ts`); `NEIGHBORHOODS` (`src/lib/neighborhoods.ts`).
- Produces: `BackstoryActionState = { ok: boolean; message: string }`; parsers `parseDecision`, `parseApproval`, `parseSpeaker`, `parseNeighborhood`, `parseDoNotUse` (each `(formData: FormData) => { ok: true; storyId: string; args: Record<string, unknown> } | { ok: false; message: string }`); actions `decideItemAction`, `approveEpisodeAction`, `setSpeakerNameAction`, `setNeighborhoodAction`, `setDoNotUseAction`, all `(prev: BackstoryActionState, formData: FormData) => Promise<BackstoryActionState>`.

- [ ] **Step 1: Write the failing parser tests** — `tests/actions/admin-backstory.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseApproval, parseDecision, parseDoNotUse, parseNeighborhood, parseSpeaker } from '@/app/actions/admin-backstory';

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

describe('Backstory form parsers', () => {
  it('parses an item decision into the mutation arguments', () => {
    expect(parseDecision(form({ storyId: 's1', table: 'places', id: 'p1', status: 'rejected' }))).toEqual({
      ok: true, storyId: 's1', args: { item: { table: 'places', id: 'p1' }, status: 'rejected' },
    });
  });
  it('refuses a table or status Backstory does not have', () => {
    expect(parseDecision(form({ storyId: 's1', table: 'stories', id: 'x', status: 'approved' })).ok).toBe(false);
    expect(parseDecision(form({ storyId: 's1', table: 'places', id: 'p1', status: 'maybe' })).ok).toBe(false);
  });
  it('carries the run id with an approval so a stale page is caught', () => {
    expect(parseApproval(form({ storyId: 's1', runId: 'run-1', summary: 'A summary.' }))).toEqual({
      ok: true, storyId: 's1', args: { storyId: 's1', runId: 'run-1', summary: 'A summary.' },
    });
  });
  it('allows an empty speaker name (it clears the name)', () => {
    expect(parseSpeaker(form({ storyId: 's1', label: 'spk_0', name: '' }))).toMatchObject({ ok: true, args: { name: '' } });
  });
  it('only accepts a neighborhood from the Field Guide list, or none', () => {
    expect(parseNeighborhood(form({ storyId: 's1', placeId: 'p1', neighborhood: 'Bay View' }))).toMatchObject({ ok: true, args: { neighborhood: 'Bay View' } });
    expect(parseNeighborhood(form({ storyId: 's1', placeId: 'p1', neighborhood: '' }))).toMatchObject({ ok: true, args: { neighborhood: null } });
    expect(parseNeighborhood(form({ storyId: 's1', placeId: 'p1', neighborhood: 'Atlantis' })).ok).toBe(false);
  });
  it('parses the do-not-use toggle for a story or a mention', () => {
    expect(parseDoNotUse(form({ storyId: 's1', table: 'mentions', id: 'm1', doNotUse: 'true' }))).toEqual({
      ok: true, storyId: 's1', args: { target: { table: 'mentions', id: 'm1' }, doNotUse: true },
    });
  });
});
```

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement `src/app/actions/admin-backstory.ts`** (plain module: types + pure parsers)

```ts
import { z } from 'zod';
import { NEIGHBORHOODS } from '@/lib/neighborhoods';

export interface BackstoryActionState {
  ok: boolean;
  message: string;
}

export type Parsed = { ok: true; storyId: string; args: Record<string, unknown> } | { ok: false; message: string };

const INVALID: Parsed = { ok: false, message: 'That form was incomplete. Reload the page and try again.' };
const id = z.string().min(1).max(64);
const fields = (formData: FormData) => Object.fromEntries(formData.entries());

const decision = z.object({
  storyId: id, id, table: z.enum(['mentions', 'places', 'storyTopics', 'storyActions']), status: z.enum(['approved', 'rejected', 'pending']),
});
export function parseDecision(formData: FormData): Parsed {
  const result = decision.safeParse(fields(formData));
  if (!result.success) return INVALID;
  const { storyId, table, id: itemId, status } = result.data;
  return { ok: true, storyId, args: { item: { table, id: itemId }, status } };
}

const approval = z.object({ storyId: id, runId: id, summary: z.string() });
export function parseApproval(formData: FormData): Parsed {
  const result = approval.safeParse(fields(formData));
  return result.success ? { ok: true, storyId: result.data.storyId, args: result.data } : INVALID;
}

const speaker = z.object({ storyId: id, label: z.string().regex(/^spk_\d+$/), name: z.string() });
export function parseSpeaker(formData: FormData): Parsed {
  const result = speaker.safeParse(fields(formData));
  return result.success ? { ok: true, storyId: result.data.storyId, args: result.data } : INVALID;
}

const neighborhoodNames = NEIGHBORHOODS.map((n) => n.name) as [string, ...string[]];
const neighborhood = z.object({ storyId: id, placeId: id, neighborhood: z.union([z.enum(neighborhoodNames), z.literal('')]) });
export function parseNeighborhood(formData: FormData): Parsed {
  const result = neighborhood.safeParse(fields(formData));
  if (!result.success) return INVALID;
  const { storyId, placeId, neighborhood: name } = result.data;
  return { ok: true, storyId, args: { placeId, neighborhood: name || null } };
}

const doNotUse = z.object({ storyId: id, table: z.enum(['stories', 'mentions']), id, doNotUse: z.enum(['true', 'false']) });
export function parseDoNotUse(formData: FormData): Parsed {
  const result = doNotUse.safeParse(fields(formData));
  if (!result.success) return INVALID;
  const { storyId, table, id: targetId, doNotUse: flag } = result.data;
  return { ok: true, storyId, args: { target: { table, id: targetId }, doNotUse: flag === 'true' } };
}
```

- [ ] **Step 4: Implement `src/app/actions/admin-backstory-actions.ts`**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { backstoryMutation, reviewErrorMessage, type BackstoryMutation } from '@/lib/backstory';
import { currentStaffRole } from '@/lib/staff-guard';
import {
  parseApproval, parseDecision, parseDoNotUse, parseNeighborhood, parseSpeaker,
  type BackstoryActionState, type Parsed,
} from './admin-backstory';

// The staff check here is a courtesy; Backstory re-checks the reviewer allowlist inside every mutation.
async function run(mutation: BackstoryMutation, parsed: Parsed, done: string): Promise<BackstoryActionState> {
  if (!(await currentStaffRole())) return { ok: false, message: 'Not authorized.' };
  if (!parsed.ok) return parsed;
  try {
    await backstoryMutation(mutation, parsed.args);
  } catch (error) {
    console.error(`backstory ${mutation} failed`, error);
    return { ok: false, message: reviewErrorMessage(error) };
  }
  revalidatePath('/admin/backstory');
  revalidatePath(`/admin/backstory/${parsed.storyId}`);
  return { ok: true, message: done };
}

export async function decideItemAction(_prev: BackstoryActionState, formData: FormData) {
  return run('reviewMutations:decideItem', parseDecision(formData), 'Saved.');
}
export async function approveEpisodeAction(_prev: BackstoryActionState, formData: FormData) {
  return run('reviewMutations:approveEpisode', parseApproval(formData), 'Approved. Alexa can use this episode now.');
}
export async function setSpeakerNameAction(_prev: BackstoryActionState, formData: FormData) {
  return run('reviewMutations:setSpeakerName', parseSpeaker(formData), 'Saved.');
}
export async function setNeighborhoodAction(_prev: BackstoryActionState, formData: FormData) {
  return run('reviewMutations:setPlaceNeighborhood', parseNeighborhood(formData), 'Saved.');
}
export async function setDoNotUseAction(_prev: BackstoryActionState, formData: FormData) {
  return run('reviewMutations:setDoNotUse', parseDoNotUse(formData), 'Saved.');
}
```

(`run` is not exported, so the `'use server'` file still exports only async actions.)

- [ ] **Step 5: Run, expect pass; typecheck.** `npx vitest run tests/actions/admin-backstory.test.ts && npm run typecheck`.

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/admin-backstory.ts src/app/actions/admin-backstory-actions.ts tests/actions/admin-backstory.test.ts
git commit -m "feat: Backstory review server actions with validated forms (MOO-853)"
```

---

### Task 7: Queue page

**Files:**
- Create: `src/app/admin/backstory/page.tsx`
- Modify: `src/app/admin/page.tsx` (one card)

**Interfaces:** Consumes `backstoryQuery`, `queueSchema`, `reviewErrorMessage`, `requireStaff`, `chicagoDateLabel` (`src/lib/display.ts`; confirm it takes a `Date`), `Badge`, `Card*`.

- [ ] **Step 1: Read** `node_modules/next/dist/docs/` on page `searchParams` (a Promise in Next 16).

- [ ] **Step 2: Implement the page**

```tsx
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { backstoryQuery, reviewErrorMessage } from '@/lib/backstory';
import { queueSchema, type QueueRow } from '@/lib/backstory-types';
import { chicagoDateLabel } from '@/lib/display';
import { requireStaff } from '@/lib/staff-guard';

const SHOWS = [
  { slug: '', name: 'All shows' },
  { slug: 'this-bites', name: 'This Bites' },
  { slug: 'uniquely-milwaukee', name: 'Uniquely Milwaukee' },
];
const REASON: Record<QueueRow['needsReview'], string> = {
  new: 'New',
  reprocessed: 'Re-processed: live version stays until you approve this one',
  pipeline_failed: 'Pipeline failed: needs an editor',
};

async function loadQueue(showSlug: string): Promise<{ rows: QueueRow[] } | { error: string }> {
  try {
    return { rows: await backstoryQuery('review:queue', showSlug ? { showSlug } : {}, queueSchema) };
  } catch (error) {
    console.error('backstory queue failed', error);
    return { error: reviewErrorMessage(error) };
  }
}

export default async function BackstoryQueuePage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireStaff('picks');
  const { show = '' } = await searchParams;
  const result = await loadQueue(SHOWS.some((s) => s.slug === show) ? show : '');
  return (
    <div className="grid gap-4">
      <h1 className="font-head text-3xl text-ink">Backstory review</h1>
      <p className="text-ink-muted">Nothing here reaches Alexa until you approve it. Content type: podcast episodes.</p>
      <nav className="flex flex-wrap gap-2">
        {SHOWS.map((s) => (
          <Link key={s.slug} href={s.slug ? `/admin/backstory?show=${s.slug}` : '/admin/backstory'}>
            <Badge variant={s.slug === show ? 'default' : 'outline'}>{s.name}</Badge>
          </Link>
        ))}
      </nav>
      {'error' in result ? (
        <p role="status" className="text-rm-red">{result.error}</p>
      ) : result.rows.length === 0 ? (
        <p className="text-ink-muted">Nothing waiting for review.</p>
      ) : (
        result.rows.map((row) => (
          <Card key={row.storyId}>
            <CardContent className="grid gap-1 py-4">
              <Link href={`/admin/backstory/${row.storyId}`} className="font-head text-lg text-ink underline">{row.title}</Link>
              <p className="text-sm text-ink-muted">
                {row.showName} · {chicagoDateLabel(new Date(row.publishedAt))} · reviewer: {row.reviewer}
              </p>
              <div className="flex flex-wrap gap-1">
                <Badge variant={row.needsReview === 'pipeline_failed' ? 'secondary' : 'outline'}>{REASON[row.needsReview]}</Badge>
                {row.doNotUse ? <Badge variant="secondary">do not use</Badge> : null}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
```

(Check `Badge`'s variant names in `src/components/ui/badge.tsx` and `CardContent`'s export in `card.tsx`; adjust to what exists. Pipeline-failed rows link to the episode page too; it shows "no extraction yet" when `episode` returns null.)

- [ ] **Step 3: Add the admin home card** in `src/app/admin/page.tsx`, after the Staff picks card (visible to every staff tier; Backstory decides who may review):

```tsx
        <Link href="/admin/backstory" className="block">
          <Card>
            <CardHeader>
              <CardTitle>Backstory review</CardTitle>
              <CardDescription>
                Check podcast episodes' people, places, topics and actions before Alexa can use them.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
```

- [ ] **Step 4: Verify** — `npm run typecheck && npm test`; then `npm run dev` with `BACKSTORY_CONVEX_URL` unset and visit `/admin/backstory` signed in: expected "Backstory is unavailable right now" (proves the error path; the live path is checked in Task 9).

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/backstory/page.tsx src/app/admin/page.tsx
git commit -m "feat: Backstory review queue at /admin/backstory (MOO-853)"
```

---

### Task 8: Episode review page

**Files:**
- Create: `src/app/admin/backstory/[storyId]/page.tsx`, `src/components/admin/backstory-item-decision.tsx`, `src/components/admin/backstory-episode-forms.tsx`

**Interfaces:** Consumes `episodeSchema`/`Episode`, `backstoryQuery`, `reviewErrorMessage`, the five actions (Task 6), `NEIGHBORHOODS`, `Button`, `Badge`, `Card*`.

- [ ] **Step 1: `src/components/admin/backstory-item-decision.tsx`**

```tsx
'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import type { BackstoryActionState } from '@/app/actions/admin-backstory';
import { decideItemAction } from '@/app/actions/admin-backstory-actions';

const initial: BackstoryActionState = { ok: false, message: '' };

interface Props {
  storyId: string;
  table: 'mentions' | 'places' | 'storyTopics' | 'storyActions';
  id: string;
  status: 'pending' | 'approved' | 'rejected';
}

export function BackstoryItemDecision({ storyId, table, id, status }: Props) {
  const [state, action, pending] = useActionState(decideItemAction, initial);
  const button = (next: Props['status'], label: string, variant?: 'outline') => (
    <form action={action}>
      <input type="hidden" name="storyId" value={storyId} />
      <input type="hidden" name="table" value={table} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={next} />
      <Button type="submit" size="sm" variant={variant} disabled={pending || status === next}>{label}</Button>
    </form>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-ink-muted">{status}</span>
      {button('approved', 'Approve')}
      {button('rejected', 'Reject', 'outline')}
      {status !== 'pending' ? button('pending', 'Undo', 'outline') : null}
      {state.message && !state.ok ? <span role="status" className="text-sm text-rm-red">{state.message}</span> : null}
    </div>
  );
}
```

(Check `Button`'s `size` variants include `sm`; use what `button.tsx` defines.)

- [ ] **Step 2: `src/components/admin/backstory-episode-forms.tsx`** — four small client forms, each using `useActionState(<action>, initial)` and showing `state.message` the same way:
  - `ApproveEpisodeForm({ storyId, runId, defaultSummary, alreadyLive })`: `<textarea name="summary" defaultValue={defaultSummary} maxLength={1500} rows={5} required>`, hidden `storyId` + `runId`, submit "Approve episode" with `window.confirm('Approve this episode? Everything you did not reject becomes available to Alexa. Places with uncertain map pins stay off until you approve them.')` on submit (pattern from `review-decision-form.tsx`). Success message shown in green (`text-ink`).
  - `SpeakerNameForm({ storyId, label, name, sample })`: shows `label` and the sample line in quotes, `<input name="name" defaultValue={name ?? ''} maxLength={80} placeholder="Unknown speaker">`, submit "Save".
  - `NeighborhoodForm({ storyId, placeId, neighborhood })`: `<select name="neighborhood">` with an empty "No neighborhood" option plus `NEIGHBORHOODS.map(n => <option value={n.name}>)`, submit "Save".
  - `DoNotUseToggle({ storyId, table, id, doNotUse })`: hidden fields, submits `doNotUse={String(!doNotUse)}`, button label `doNotUse ? 'Allow assistant use' : 'Do not use'`.

Write each out in full in the file (no shared abstraction beyond the `initial` constant).

- [ ] **Step 3: The page** — `src/app/admin/backstory/[storyId]/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BackstoryItemDecision } from '@/components/admin/backstory-item-decision';
import { ApproveEpisodeForm, DoNotUseToggle, NeighborhoodForm, SpeakerNameForm } from '@/components/admin/backstory-episode-forms';
import { Badge } from '@/components/ui/badge';
import { backstoryQuery, reviewErrorMessage } from '@/lib/backstory';
import { episodeSchema, type Episode } from '@/lib/backstory-types';
import { chicagoDateLabel } from '@/lib/display';
import { requireStaff } from '@/lib/staff-guard';

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

function Quote({ quote, startMs }: { quote: string; startMs: number }) {
  return <blockquote className="border-l-[3px] border-ink pl-3 text-sm text-ink-muted">“{quote}” <span className="whitespace-nowrap">({clock(startMs)})</span></blockquote>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="grid gap-3"><h2 className="font-head text-2xl text-ink">{title}</h2>{children}</section>;
}

async function loadEpisode(storyId: string): Promise<{ episode: Episode | null } | { error: string }> {
  try {
    return { episode: await backstoryQuery('review:episode', { storyId }, episodeSchema.nullable()) };
  } catch (error) {
    console.error('backstory episode failed', error);
    return { error: reviewErrorMessage(error) };
  }
}

export default async function BackstoryEpisodePage({ params }: { params: Promise<{ storyId: string }> }) {
  await requireStaff('picks');
  const { storyId } = await params;
  if (!/^[a-z0-9]{1,64}$/.test(storyId)) notFound();
  const result = await loadEpisode(storyId);
  if ('error' in result) return <p role="status" className="text-rm-red">{result.error}</p>;
  if (!result.episode) return <p className="text-ink-muted">No extraction for this episode yet. <Link href="/admin/backstory" className="underline">Back to the queue</Link></p>;
  const { story, speakers, mentions, places, topics, actions } = result.episode;
  return (
    <div className="grid gap-8">
      <header className="grid gap-1">
        <Link href="/admin/backstory" className="text-sm underline">← Queue</Link>
        <h1 className="font-head text-3xl text-ink">{story.title}</h1>
        <p className="text-ink-muted">
          {story.showName} · {chicagoDateLabel(new Date(story.publishedAt))} · <a href={story.permalink ?? story.audioUrl} target="_blank" rel="noreferrer" className="underline">Listen</a>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{story.reviewStatus}</Badge>
          {story.approvedRunId && story.approvedRunId !== story.latestRunId ? <Badge variant="secondary">a newer run is waiting; the approved one stays live</Badge> : null}
          {story.approvedBy ? <span className="text-sm text-ink-muted">approved by {story.approvedBy}</span> : null}
          <DoNotUseToggle storyId={storyId} table="stories" id={storyId} doNotUse={story.doNotUse} />
        </div>
      </header>

      <Section title="Speakers">
        {speakers.map((s) => <SpeakerNameForm key={s.label} storyId={storyId} label={s.label} name={s.name} sample={s.sample} />)}
      </Section>

      <Section title="People, organizations and dishes">
        {mentions.length === 0 ? <p className="text-ink-muted">None.</p> : mentions.map((m) => (
          <div key={m.id} className="grid gap-1 border-b border-ink/20 pb-3">
            <p className="text-ink"><strong>{m.name}</strong> · {m.entityType}{m.subjectConfidence !== null && m.subjectConfidence < 0.5 ? ' · possibly a passing mention' : ''}</p>
            <Quote quote={m.quote} startMs={m.startMs} />
            <div className="flex flex-wrap gap-2">
              <BackstoryItemDecision storyId={storyId} table="mentions" id={m.id} status={m.reviewStatus} />
              <DoNotUseToggle storyId={storyId} table="mentions" id={m.id} doNotUse={m.doNotUse} />
            </div>
          </div>
        ))}
      </Section>

      <Section title="Places (uncertain map pins first)">
        {places.length === 0 ? <p className="text-ink-muted">None.</p> : places.map((p) => (
          <div key={p.id} className="grid gap-1 border-b border-ink/20 pb-3">
            <p className="text-ink">
              <strong>{p.officialName ?? p.name}</strong> · {p.category}
              {p.geocodeConfidence === null ? ' · no map pin' : ` · pin confidence ${Math.round(p.geocodeConfidence * 100)}%`}
            </p>
            {p.geocodeLabel ? <p className="text-sm text-ink-muted">Matched: {p.geocodeLabel}</p> : null}
            <Quote quote={p.quote} startMs={p.startMs} />
            <div className="flex flex-wrap gap-2">
              <BackstoryItemDecision storyId={storyId} table="places" id={p.id} status={p.reviewStatus} />
              <NeighborhoodForm storyId={storyId} placeId={p.id} neighborhood={p.neighborhood} />
            </div>
          </div>
        ))}
      </Section>

      <Section title="Topics">
        {topics.map((t) => (
          <div key={t.id} className="grid gap-1 border-b border-ink/20 pb-3">
            <p className="text-ink"><strong>{t.topic}</strong> · {Math.round(t.confidence * 100)}%</p>
            <Quote quote={t.quote} startMs={t.startMs} />
            <BackstoryItemDecision storyId={storyId} table="storyTopics" id={t.id} status={t.reviewStatus} />
          </div>
        ))}
      </Section>

      <Section title="Actions">
        {actions.map((a) => (
          <div key={a.id} className="grid gap-1 border-b border-ink/20 pb-3">
            <p className="text-ink"><strong>{a.label}</strong> · {a.kind}{a.place ? ` · ${a.place}` : ''}</p>
            <Quote quote={a.quote} startMs={a.startMs} />
            <BackstoryItemDecision storyId={storyId} table="storyActions" id={a.id} status={a.reviewStatus} />
          </div>
        ))}
      </Section>

      <Section title="Summary and approval">
        <ApproveEpisodeForm storyId={storyId} runId={story.latestRunId} defaultSummary={story.summary && story.approvedRunId === story.latestRunId ? story.summary : story.proposedSummary} alreadyLive={story.reviewStatus === 'approved'} />
      </Section>
    </div>
  );
}
```

(The `storyId` regex is a cheap shape check before calling Backstory; Convex ids are lowercase alphanumerics. Confirm against a real id from Backstory, e.g. `jn799rvee6ttmv2ehp7sa1hqp58fee19`, which matches.)

- [ ] **Step 4: Verify** — `npm run typecheck && npm test && npm run build` (build here catches server/client boundary mistakes; if `build` needs env vars the README marks optional, set dummy values for the run only).

- [ ] **Step 5: Commit**

```bash
git add 'src/app/admin/backstory/[storyId]/page.tsx' src/components/admin/backstory-item-decision.tsx src/components/admin/backstory-episode-forms.tsx
git commit -m "feat: Backstory episode review page with evidence quotes, speakers, neighborhoods and approval (MOO-853)"
```

---

### Task 9: Connect, ship, and prove it against reality

Every step marked **PROD** is a sanctioned production write. Ask Tarik before each group; say what changes and what happens if it's wrong.

- [ ] **Step 1: Find the live Clerk instance.** In the Vercel project for the Field Guide, read (don't print) `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`: `pk_live_…` = production instance, `pk_test_…` = development. The Convex integration must be activated on that same instance.
- [ ] **Step 2 (Tarik, PROD): Activate Clerk's Convex integration.** Clerk dashboard → the instance from Step 1 → https://dashboard.clerk.com/apps/setup/convex → **Activate Convex integration** → copy the **Frontend API URL**. If it's wrong: Convex rejects every token; nothing is exposed.
- [ ] **Step 3 (PROD): Backstory Convex env + deploy.**
  ```bash
  cd ~/Projects/backstory
  npx convex env set CLERK_JWT_ISSUER_DOMAIN "<Frontend API URL from Step 2>"
  npx convex env set BACKSTORY_REVIEWER_EMAILS "<list from Prerequisite 2>"
  npx convex dev --once
  ```
  Expected: "Convex functions ready". If wrong: review functions refuse everyone; the public `getStory`/`searchStories` contract is untouched.
- [ ] **Step 4: Prove the boundary with no sign-in.** `npx convex run review:queue '{}'` → expected error containing `not_signed_in`. `npx convex logs --history 20 | grep "review:"` shows the call. Save the output for MOO-853's verification checklist.
- [ ] **Step 5: Decode one real token's claims (never print the token itself).** Run the Field Guide locally (`npm run dev`, `.env.local` with the live Clerk keys and `BACKSTORY_CONVEX_URL`), sign in, and temporarily log only `Object.keys(payload)` and `payload.email_verified` from the decoded `getToken({ template: 'convex' })` in `connection()`; remove the log before committing. Expected: `email` present, `email_verified: true`. If `email` is missing: in Clerk → JWT templates, create a template named `convex` with claims `{"aud": "convex", "email": "{{user.primary_email_address}}", "email_verified": "{{user.email_verified}}"}` and re-check. If a non-reviewer staff account exists, sign in with it and confirm the page shows "not on the Backstory reviewer list" and `npx convex logs` shows `review: refused …`.
- [ ] **Step 6 (PROD): Vercel env var.** Add `BACKSTORY_CONVEX_URL` (Backstory's `.convex.cloud` URL from `npx convex dashboard` / `.env.local` `CONVEX_URL`) to the Field Guide's Vercel project, Production + Preview.
- [ ] **Step 7: Mark both PRs ready; CI green on both.** Backstory PR first: merge it (functions are already deployed by Step 3; merging syncs `main` with what's live). Field Guide PR: watch the Vercel preview deploy; sign into the preview and run Step 8 there first if Clerk allows the preview domain.
- [ ] **Step 8: MOO-853 verification checklist, on real episodes.**
  - An editor approves a real **This Bites** and a real **Uniquely Milwaukee** episode in the UI (timed with a stopwatch; target under 10 minutes for one). Then `npx convex run public:getStory '{"storyId":"<id>"}'` returns each.
  - Reject one mention in an approved episode; `getStory` no longer lists it.
  - Screenshots: queue, episode page, the refusal message.
- [ ] **Step 9 (PROD): Merge the Field Guide PR.** Vercel deploys `main` to production. Visit https://mke-field-guide.vercel.app/admin/backstory signed in; the queue loads. If wrong: revert the merge commit; Backstory data is unaffected by a UI rollback.
- [ ] **Step 10: Record.** Add a dated entry to `docs/LEARNING-LOG.md` (expected review time vs measured; what reviewers rejected most). Comment the evidence on MOO-853 and close it.

---

## Self-review notes (for the executor)

- Spec coverage: queue filterable by show (Task 7) and content type (all items are `episode` until Plan 4; the column is shown, the filter arrives with the second content type); episode page with speakers, summary, people, places, topics, actions, quotes, approve/reject (Tasks 2, 3, 8); "approve" makes everything readable at once (Task 3, decision 010); Convex-side permission checks (Tasks 1, 3); places low-confidence first and curated neighborhoods (Tasks 2, 6, 8); do-not-use on story and mention (Tasks 3, 8); UM reviewer (Task 3 Step 6, blocked on Prerequisite 1); `needs_editor` shown (Task 2). Premiere and Concert Picks pages are Plan 4.
- `convex/public.ts` is untouched; its tests are the regression net for "nothing readable until approved".
- `approveLatestRunForDemo` stays as the spec's last-resort fallback.
