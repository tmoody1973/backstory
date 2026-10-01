# Backstory labeled set: labeling guide

**What this is for:** 20 episodes, labeled by people who know the shows, become the answer key we score models against. That's how we decide between Claude Haiku and Jev for topics, and whether to try Sonnet. The PRD targets: topic agreement of 85% or better, and places at least 95% correct.

**One rule above all: label from the episode, never from what the software produced.** Don't open Backstory's output for these episodes until your labels are in. Seeing it first would bias the answer key toward the model.

## How to label an episode

1. Find the episode in the **Episodes** tab, put your name in *labeler*, and listen (or read its transcript, once linked).
2. Add one row per label to the **Labels** tab, using the episode's `E` number.
3. Mark the episode *done* in the Episodes tab.

Budget about the episode's length plus 10 minutes.

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
