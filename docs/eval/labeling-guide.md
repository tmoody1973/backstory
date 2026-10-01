# Backstory labeled set: labeling guide

**What this is for:** 20 episodes, labeled by people who know the shows, become the answer key we score models against. That's how we decide between Claude Haiku and Jev for topics, and whether to try Sonnet. The PRD targets: topic agreement of 85% or better, and places at least 95% correct.

**One rule above all: the answer key is what the episode actually says.** Never open Backstory's own output for these episodes. The suggestions below are deliberately mixed and unlabeled so no model gets favored.

## Two ways episodes get labeled

The **Episodes** sheet's *method* column tells you which one each episode uses. Every episode has a *transcript* link: show notes (correct spellings) on top, the full transcript (names may be misheard) below.

**Suggestions (15 episodes).** Faster: you check a list instead of writing one.

1. Open the **Suggestions** sheet and filter to the episode.
2. For each row, write in *keep*:
   - `yes`: it belongs in the answer key as written.
   - `no`: wrong, minor, or not allowed (for example a student, a facility resident, or a private address).
   - `fix`: right idea, wrong details. Put the correction in the next column, such as the real spelling.
3. **Then the "what's missing" pass:** read the show notes and skim the transcript, and add anything the list didn't include to the **Labels** sheet. Don't skip this; it's how we measure what the software misses.

**Blind (E13, E14, E15, E17, E20).** These five are the control, so don't look at Suggestions for them at all. Listen or read, and write every label yourself in the **Labels** sheet.

When an episode is finished, put your name in *labeler* and mark *done* in the Episodes sheet. Timestamps are optional everywhere.

## What to label

| label_type | What counts | Examples |
|---|---|---|
| `topic` | **Up to 3** main subjects, from the list below. A main subject is something the episode spends real time on, not a passing mention. | `civic-life`, `food-drink` |
| `person` | People the story is about or who speak for it: staff, owners, chefs, leaders, artists, public officials. **Not** program participants, facility residents, patients or minors. **Not** the host, unless the host is the subject. | Ruben Gaona |
| `place` | Public places listeners could go: restaurants, bars, venues, parks, libraries, facilities. **Never** a home or a private address. Use the business's real spelling. | Immy's African Cuisine |
| `organization` | Nonprofits, companies, programs, agencies that matter to the story. | My Way Out |
| `action` | Something a listener could do because of this episode: visit, reserve, attend, support or remember. Write it the way you'd say it. | Support My Way Out |

**timestamp** (mm:ss) is where in the audio you heard it. It's optional, but it helps when two labelers disagree.

## The 13 topics

| Topic | Means |
|---|---|
| `music` | Artists, songs, concerts, the local music scene |
| `comedy` | Comedians, stand-up, improv, humor as the subject |
| `sports` | Teams, athletes, games, recreation leagues |
| `festival` | Large public celebrations, fairs, multi-day events |
| `family` | Kids, parenting, things for families |
| `food-drink` | Restaurants, chefs, dishes, bars, coffee, food events |
| `arts` | Arts and culture: visual art, theater, dance, film, literature, heritage |
| `community` | Neighbors, volunteers, mutual aid, neighborhood life |
| `civic-life` | Government, justice and reentry, policy, advocacy, public services |
| `history` | Milwaukee's past, anniversaries, legacies |
| `education` | Schools, training programs, learning at any age |
| `business` | Openings, closings, owners, jobs, the local economy |
| `other` | None of the above fit |

## When you're unsure

Leave it out and write the reason in *notes*. A missing label costs less than a wrong one, because the scoring treats your labels as the truth.
