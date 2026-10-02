# 007: TypeSafe Jev picks topics; Claude Haiku keeps people, places and actions

**Decision:** Story topics come from TypeSafe Jev instead of Claude Haiku. Haiku still extracts people, places, organizations, dishes and actions.

**Why this came up:** Topics were the weakest output in the live runs (a reentry story tagged "arts" and "other"). Tarik suspected Jev would do better. The PRD had ruled Jev out because it can't produce evidence quotes; we found a way around that (Jev picks the transcript passage, code copies it, so the quote is verbatim by construction).

**Options:**
- Keep Haiku for topics. One model, one call; but on the 20-episode labeled set only 67% of its topics were accepted (PRD target: 85%).
- Jev for topics. 93% of its topics accepted, 91% of the answer key's topics found, and 7 of 7 on the 5 blind control episodes. Adds a second vendor and a second API key; about $0.001 per episode.
- Jev for topics and as a judge on Haiku's people. Likely fixes Haiku's 60% people precision, but not yet built or measured.

**What we chose and why:** Jev for topics (pending Tarik's approval). It's the only option that meets the PRD target on the labeled set. Results: `docs/eval/results-2026-10-01.md`.

**What we gave up:** A second vendor (TypeSafe) in the pipeline, with its own key and outage risk; Jev's quotes are whole transcript passages, sometimes a generic intro, rather than the tightest sentence; and the answer key was made by an AI agent (Manus), spot-checked by a person on 4 of 20 episodes, not labeled by hand.

**How we'll know if this was right:** Editors in the review UI (Plan 2) reject fewer than 15% of topics, and the next labeled batch (including Ladies First) keeps Jev at or above 85%.

**What actually happened:**
