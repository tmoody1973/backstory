# 010: "Approve episode" approves every item the editor didn't reject, except uncertain map pins

**Decision:** Clicking "Approve episode" publishes the run: every item still pending becomes approved, items the editor rejected stay rejected, and a place whose map pin is uncertain stays pending unless the editor approved it by hand.

**Why this came up:** The spec asks for "an approve button per item" and an episode approve "that makes everything readable at once". An episode has up to 40 people and places, 3 topics and 10 actions. If every item needed its own click, review would blow the 10-minute-per-episode goal; if one click approved everything, a wrong map pin could send a listener to the wrong branch or a private street.

**Options:**
- Approve everything not rejected, including uncertain pins. Fastest; one bad geocode (the step that turns a place name into a map point) goes live unseen.
- Approve everything not rejected, except uncertain pins (chosen). Same speed; the risky category needs a deliberate click. Cost: an editor who skims past a pending pin leaves that place off the air until they come back.
- Require every item to be decided before the episode can be approved. Safest; slowest, and editors learn to click "approve" forty times without reading.

**What we chose and why:** The middle option (Claude proposed, matching the demo approval Tarik already used in Plan 1). Review is a "reject what's wrong" pass, which is how editors actually read; map pins get the extra gate because a wrong pin is the one mistake a listener acts on physically.

**What we gave up:** A pending item the editor never looked at goes live on approval. The evidence-quote check limits the damage (nothing is published without a word-for-word quote from the episode), but it isn't a human check.

**How we'll know if this was right:** In the first 20 real reviews, count items that went live by default and were later found wrong. More than one per ten episodes means switching to "decide every item".

**What actually happened:**
