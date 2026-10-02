# PM journal: picking the topic model, and building the answer key to decide it

**Date:** October 1, 2026 · **Product:** Radio Milwaukee Backstory · **Linear:** MOO-852 · **Decision record:** `docs/decisions/007-jev-for-topics.md` · **Results:** `docs/eval/results-2026-10-01.md`

> Facts, numbers and options below were drafted by Claude from the session. The sections marked *In my words* are Tarik's to write.

## The decision in one line

Story topics now come from TypeSafe Jev instead of Claude Haiku, because on a 20-episode answer key 93% of Jev's topics were accepted against Haiku's 67%. The PRD's target is 85%.

## How it started: a hunch the PRD had ruled out

After switching extraction to Haiku, topics were still the weakest output. A story about a prison reentry program was tagged "arts" and "other". Tarik's instinct was that Jev, a model built for fast classification judgments, would do better. The PRD had already rejected Jev for one reason: it returns labels and probabilities, not the word-for-word quotes Backstory requires for everything it publishes.

## Two problems hiding in one

1. **A vocabulary gap no model could fix.** The topic list was the Field Guide's *event* categories. A reentry story doesn't fit any of them. Tarik added four story topics (civic life, history, education, business), bringing the list to 13. Haiku's tags for the reentry story became sensible the same day.
2. **A judgment problem, where Jev fit.** Jev's own documentation suggests "select instead of generate". Code hands Jev the transcript's passages as multiple-choice options, Jev picks the one that best supports each topic, and code copies it. The quote is verbatim by construction, which removes the PRD's objection without bending the evidence rule.

## Not settling it by debate

Two episodes produced a tie: the labels mostly agreed and each model won one judgment call. So instead of picking a favorite, we built an **answer key**: 20 episodes (10 This Bites, 10 Uniquely Milwaukee) chosen for spread. The set includes a 56-minute interview, misheard names, sensitive stories, and episodes involving minors.

## The labeling-method debate

- **Tarik's instinct:** let the AI label first and a person verify, as the real product will work.
- **The concern:** for an *answer key*, AI-first anchors the reviewer to the AI's answers and hides what it missed. It would also favor whichever model pre-filled the key.
- **The compromise:**
  - 15 episodes reviewed from **pooled, unattributed suggestions** from both models, plus a "what's missing" pass.
  - 5 short episodes labeled **blind** as a control.

## The twist: an AI agent did the labeling

The labels came back in about 25 minutes, all marked by **Manus**, an AI agent. That changes what the key can prove: grading AI against AI measures agreement, not truth. Rather than redo 3–4 hours of work, Tarik **spot-checked** Manus on 4 episodes (84 labels) and found 2 wrong, both misheard restaurant names (Orenda Cafe and EsterEv). That gives a measured **97.6%** accuracy for the answer key, reported alongside the scores. The cleanup also removed 284 duplicate labels Manus had created.

## What the data said

| | Topic precision (accepted) | Topic recall (found) | On the 5 blind episodes |
|---|---|---|---|
| **Jev** | **93%** | **91%** | 7 of 7 |
| Haiku | 67% | 80% | 7 of 13 |

Haiku always fills all three topic slots, and the third is usually a stretch. Jev keeps only the topics it's confident about, and its probabilities are real numbers editors can sort by. Jev costs about $0.001 per episode.

The same scoring showed **Haiku's people are its weakest output: 60% precision**. Four in ten people it lists get rejected: hosts, students, and names mentioned only in passing. That's the next experiment: Jev as a yes/no judge on each person.

## What we gave up

- A second AI vendor, with its own key and outage risk.
- Jev's quotes are whole passages, sometimes a generic show intro, and one included a facility resident's name.
- An answer key made by an AI agent and spot-checked by a person, rather than labeled entirely by hand.
- A blind control of only 5 episodes.

## In my words: what I learned

<!-- Tarik: the hunch, the PRD saying no, the Manus moment, what you'd do the same or differently. -->

## In my words: how I'd tell this in an interview

<!-- Tarik: the 60-second version. -->
