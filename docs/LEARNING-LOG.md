# Learning log

Dated entries: what we expected, what happened, what we now believe.

## 2026-10-01 — First live run, Nova Micro, 1 episode per show

**What we expected:** Nova Micro would extract the people, places and actions in each episode with verbatim quotes, and most places would pin.

**What happened (numbers from the Convex tables and the extraction logs):**

| Run | Show | Mentions kept | Mentions dropped | Actions kept / dropped | Places pinned / total |
|---|---|---|---|---|---|
| 1 (original prompt) | Uniquely Milwaukee | 1 (a URL) | 3 | 1 / 0 | 0 / 1 |
| 1 (original prompt) | This Bites | 6 | 2 | 3 / 0 | 0 / 3 |
| 2 (prompt + filters fixed) | Uniquely Milwaukee | 3 | 1 | 1 / 0 | 1 / 1 |
| 2 (prompt + filters fixed) | This Bites | 6 | 1 | 0 / 3 | 0 / 1 |

- Transcribe misspelled a guest ("Ruben Galona"); the model "corrected" the quote from the show notes, so the evidence check dropped him until the prompt said to keep the transcript's spelling.
- Every dropped This Bites action in run 2 was a paraphrase, not a copy, of what was said.
- No place was ever pinned wrongly; Café Corazón was correctly held back because it has three locations.
- Run 2 extracted a Community Reintegration Center resident by first name.

**Model comparison, same two transcripts (counts from the Convex tables; tokens from the extraction log):**

| Model | Show | Mentions kept | Places pinned / total | Actions | Result |
|---|---|---|---|---|---|
| Nova Micro (run 2) | Uniquely Milwaukee | 3 | 1 / 1 | 1 | ok, but missed My Way Out |
| Nova Micro (run 2) | This Bites | 6 | 0 / 1 | 0 | every action quote paraphrased |
| Nova Lite | This Bites | — | — | — | failed 3x: broken tool output, then 41+ mentions over the cap |
| Claude Haiku 4.5 | Uniquely Milwaukee | 6 | 1 / 1 | 1 (support My Way Out) | My Way Out, Ruben Gaona, staff and the superintendent kept; the CRC resident skipped |
| Claude Haiku 4.5 | This Bites | 39 | 5 / 17 | 3, all tied to places | Immy's pinned despite "Emmy's" in the transcript |
| Claude Sonnet 5.5 | both | — | — | — | not run: needs a one-time Marketplace subscription and rejects forced tool choice |

- Haiku gave identical counts and token usage on two separate runs.
- Haiku measured cost: Uniquely Milwaukee 3,363 in / 817 out tokens ≈ $0.008; This Bites 7,283 in / 3,781 out ≈ $0.029 (at $1.10 / $5.50 per million).
- Most of This Bites' unpinned places are Transcribe misspellings ("Loop and Iris", "Cochina Fipina", "Nompong") or places too new for Amazon's map data.

**Topics: Claude Haiku 4.5 vs TypeSafe Jev (jev-1.13.0), same two transcripts, 13-topic vocabulary:**

| Show | Haiku topics | Jev topics (probability) | Jev's next-highest |
|---|---|---|---|
| Uniquely Milwaukee | education, business, civic-life | civic-life 0.97, education 0.92, business 0.59 | community 0.16 |
| This Bites | food-drink, festival, community | food-drink 0.99, festival 0.95, business 0.94 | other 0.11 |

- Jev's scores separate cleanly: everything it kept is at 0.59 or above, everything it dropped is at 0.16 or below. Those are usable confidence numbers for editors.
- Jev's quotes pass the evidence check by construction (it picks a transcript passage; code copies it). But for This Bites it picked the same generic show intro as the quote for both food-drink and festival, and one Uniquely Milwaukee quote names the facility resident the participant rule excludes.
- Jev cost: 6,440 and 20,708 input tokens, $0.0003 and $0.0009 at $0.042 per million.
- Two episodes can't settle it: the labels mostly agree, and each model wins one judgment call ("business" vs "community" for a food-news episode).

**What we now believe:**
