# 011: The review page shows exceptions first, one Keep/Remove decision per item, and what Alexa will say

**Decision:** Redesign the episode review page around the decision editors actually make. Items the system is unsure about ("needs you") come first; the rest are folded under "looks right". Each item gets one choice, Keep or Remove, and Remove asks why (wrong, true but keep off Alexa, too minor). The top of the page shows what Alexa will say, and a sticky bar shows progress and "Publish to Alexa".

**Why this came up:** Tarik, reviewing real episodes on 2026-10-02, asked whether the first version was the best way to present approval. It wasn't. Every row had six buttons (Approve, Reject, Undo, Do not use, Fix spelling, Add location). "Reject" and "Do not use" looked the same. The summary and the publish button sat at the bottom after up to 40 items. Speaker naming, which Alexa never uses, came first. Decision 010 already made review a "remove what's wrong" pass, yet the page invited clicking Approve on every row. Status showed as small grey text, and screen readers heard "Reject, Reject, Reject" with no item name.

**Options:**
- Keep the layout, fix only accessibility (about 45 minutes). Cheapest; the workflow still fights the 10-minute review goal.
- Exceptions-first redesign with removal reasons (chosen; about 5 hours with keyboard shortcuts and queue counts).
- A clickable mockup first, then build. Safer on taste; costs a round trip when the review goal and the demo are near.

**What we chose and why:** The redesign, with keyboard shortcuts and per-episode queue counts (Tarik chose; Claude proposed). It matches how review tools that hit tight time targets work (triage, one primary decision, defaults, preview of the output), and it makes the demo claim visible: a human checks what the machine was unsure about and sees exactly what Alexa will say before publishing. Removal reasons double as measurement: every "wrong" is a counted AI mistake, so precision can be tracked from real reviews instead of a one-time answer key.

**What we gave up:** Items under "looks right" are folded away, so a reviewer can publish without opening them. That is decision 010's trade-off made more visible. "Do not use" on individual mentions is replaced by "Remove: true but keep off Alexa" (the story-level do-not-use stays).

**How we'll know if this was right:** Median time from opening an episode to publishing stays under 10 minutes across the first 20 reviews, and fewer than one item per ten episodes is found wrong after being kept by default.

**What actually happened:**
