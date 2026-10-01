# 006: Claude Haiku 4.5 replaces Nova Micro for extraction

**Decision:** Extraction runs on Claude Haiku 4.5 through Amazon Bedrock instead of Amazon Nova Micro.

**Why this came up:** The PRD said to start with Nova Micro and step up only if it failed the evaluation. On the first two live episodes it did: it paraphrased instead of copying quotes, so the evidence check threw away every This Bites action and missed My Way Out, the subject of the Uniquely Milwaukee story. Nova Lite, the next step, broke on the 17-minute episode.

**Options:**
- Stay on Nova Micro. About $0.0005 an episode, but editors would rebuild most actions and places by hand.
- Claude Haiku 4.5 on Bedrock. Measured $0.008 for a 4-minute episode and $0.029 for a 17-minute one; still on AWS, so the hackathon credit and AWS story hold.
- Claude Sonnet 5.5 on Bedrock. Likely stronger again, but needs a one-time Marketplace subscription, a code change (it rejects forced tool choice), and its price isn't in AWS's pricing service yet.

**What we chose and why:** Haiku 4.5 (Tarik, on Claude's recommendation). It passed MOO-852's checks for both shows, gave identical results on two runs, and costs a few cents an episode. Numbers are in `docs/LEARNING-LOG.md`.

**What we gave up:** Roughly 20–60x Nova Micro's per-episode cost (still about $11–15 for the whole This Bites archive), a dependency on Anthropic's model access on Bedrock, and the "Nova counts toward the AWS Builder mini challenge" point from the PRD.

**How we'll know if this was right:** On the 20-episode labeled set, Haiku meets the PRD targets (topic agreement ≥85%, places ≥95% correct), and editors spend under 10 minutes per episode.

**What actually happened:**
