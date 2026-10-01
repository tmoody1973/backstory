# PM journal: choosing the extraction model

**Date:** October 1, 2026 · **Product:** Radio Milwaukee Backstory · **Linear:** MOO-852 · **Decision record:** `docs/decisions/006-claude-haiku-for-extraction.md`

> Facts, numbers and options below were drafted by Claude from the session. The sections marked *In my words* are Tarik's to write.

## The decision in one line

We moved the step that reads each episode and pulls out its people, places and actions from Amazon Nova Micro to Claude Haiku 4.5. Both run on Amazon Bedrock. We made the move after testing both on real episodes rather than settling it in a debate.

## Why it was a product decision, not a technical one

Backstory's promise is that **Alexa never says anything a person didn't actually say on air.** Every name, place and action has to come with a word-for-word quote from the transcript, or the system throws it away. So the extraction model isn't judged on how smart it sounds. It's judged on how much true information survives that check. If too little survives, editors rebuild every episode by hand, and the "under 10 minutes of review per episode" goal fails.

## What we tried, in order

1. **Nova Micro**, the PRD's starting choice: cheapest, and part of the AWS story.
2. **Prompt and filter fixes**, after the first run exposed problems. The fixes: keep Transcribe's spelling inside quotes, drop websites and the show itself as mentions, and ask for descriptive action labels.
3. **Nova Lite**, the next step up on the PRD's list.
4. **Claude Haiku 4.5**, the PRD's other step-up option.
5. **Claude Sonnet 5.5.** We tried it, but it couldn't run without an account-level subscription and a code change.

## What the data said

Same two real episodes each time: Uniquely Milwaukee, "Through tech and teaching, My Way Out provides a path forward" (4 min), and This Bites, "Freshwater Food & Wine Festival, Café Corazón and turkey talk" (17 min).

| Model | Uniquely Milwaukee | This Bites | Cost per episode (measured) |
|---|---|---|---|
| Nova Micro | Missed My Way Out, the story's subject | 0 actions survived; every quote was paraphrased | ~$0.0005 |
| Nova Lite | Finished | Failed 3 times: broken output, then too many items | — |
| **Claude Haiku 4.5** | My Way Out, its director, staff and the superintendent; 1 pinned place; a "Support My Way Out" action | 39 mentions, 5 pinned places, 3 actions tied to places | **$0.008 (4 min) · $0.029 (17 min)** |
| Claude Sonnet 5.5 | Not run (needs a one-time Marketplace subscription) | Not run | Unknown |

Haiku gave the same counts on two separate runs. Running the whole This Bites archive of ~377 episodes through Haiku would cost about $11–15. Transcription remains the bigger cost.

## The tradeoffs that were actually on the table

- **Quality vs. cost:** Haiku is ~20–60x Nova Micro per episode, but the absolute numbers are cents. The real cost of Micro was editor time.
- **Vendor story vs. product quality:** the PRD favored Nova partly because it counts toward an AWS Builder challenge. Haiku still runs on Bedrock, so the AWS credit and the AWS story mostly hold.
- **Best vs. good enough:** Sonnet 5.5 might be better again, but Haiku already passes this milestone's checks. We'll revisit when the 20-episode labeled set gives us a real accuracy score.

## What the guardrails caught along the way

- **A made-up quote never got through.** When a model paraphrased, the evidence check dropped the item.
- **No place was pinned wrongly.** Café Corazón has three locations, so it was held for an editor rather than guessed.
- **A privacy call surfaced from real data.** The first runs named a resident of the Milwaukee County Community Reintegration Center by first name. We added a rule: Uniquely Milwaukee extracts staff and public figures, never program participants, facility residents, patients or minors. Haiku's run respected it.
- **Transcription errors leak into names.** "Emmy's" was really Immy's African Cuisine, and "Ruben Galona" was really Ruben Gaona. That led to the next decision: a Transcribe custom vocabulary of Milwaukee names.

## What we're watching

- **Topics are still the weakest output:** "arts" and "other" on a tech-and-reentry story. If Haiku misses the PRD's 85% topic-agreement target on the labeled set, try TypeSafe Jev as the topic classifier, paired with a quote from the extraction.
- **Editor review time** per episode, once the Plan 2 review UI exists.

## In my words: what I learned

<!-- Tarik: what surprised you, what you'd tell another PM about choosing a model this way. -->

## In my words: how I'd tell this in an interview

<!-- Tarik: the 60-second version. -->
