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
