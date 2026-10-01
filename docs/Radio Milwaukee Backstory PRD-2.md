# Radio Milwaukee Backstory: PRD

Oct 1, 2026 · @Tarik Moody

## Summary

Radio Milwaukee Backstory is the station's story engine. It turns Radio Milwaukee's podcasts (Uniquely Milwaukee, This Bites, Ladies First, and the station's other shows), on-air shorts, and music coverage (Milwaukee Music Premieres, MKE Concert Picks, Studio Milwaukee Sessions) into verified, searchable story data: transcripts or article text, the people and places involved, topics, neighborhoods, local tracks, and actions a listener can take.

It has its own PRD because it is a separate system from the Radio Milwaukee Alexa+ MCP server:

- **Different job:** background processing with no listener waiting, versus answering requests in under 500 ms.
- **Different cadence:** one episode a week plus weekday shorts, and a one-time archive backfill.
- **Different users:** producers and editors review its output; listeners never touch it directly.
- **Value beyond Alexa:** the same data powers coverage analysis, funder reporting, the website, and the newsletter.

The engine and the MCP server meet at one boundary: the Convex tables the engine writes and the MCP server reads. Nothing the engine produces reaches a listener until an editor has approved it.

**Hackathon scope:** one show, one flow. Either a Uniquely Milwaukee short recalled from the airing log, or a This Bites restaurant that leads to a reservation handoff. **After the hackathon:** every station podcast, archive backfill, topic coverage dashboard, story map.

## Shows covered

Every show runs through the same pipeline; a short profile per show tells extraction which entities and actions matter.

| Show | Format | Entities that matter | Typical actions | Joins to |
| --- | --- | --- | --- | --- |
| Uniquely Milwaukee | Weekly community stories, plus weekday shorts on 88Nine | People, places, organizations, events | Visit, attend, support | Field Guide venues and events |
| This Bites | Weekly food conversation, about 377 episodes | Restaurants, bars, chefs, dishes, food events, neighborhoods | Visit, reserve a table, attend a food event | Field Guide food events; Alexa's native restaurant reservations |
| Ladies First | In CDS; format to confirm with its producer | To confirm | To confirm | To confirm |
| Other station podcasts (for example HYFINated Conversations, Cinebuds, Urban Spelunking, Tap'd In) | Varies | Set per show | Set per show | Music-focused shows join artists in rotation |

**Show profiles** live in a config file, the same pattern as station configs: format, entity types to extract, action types, any taxonomy additions, and the show's reviewer. Adding a show means adding a profile, not changing code.

**This Bites has one rule of its own: restaurant facts age.** A restaurant discussed years ago may have closed or changed. Every restaurant mention carries its episode date, Alexa attributes it ("on This Bites in March 2025"), and older mentions are never presented as current unless a recent source confirms the place is open.

## Beyond podcasts: music coverage

The station's music coverage on radiomilwaukee.org is mostly text already in CDS, so most of it skips transcription entirely; the weekly Milwaukee Music Premiere adds a playable local song.

| Content type | Example | What it contains | Processing | What it unlocks |
| --- | --- | --- | --- | --- |
| Milwaukee Music Premiere | Glitzy, "Effort" (October 1, 2026) | Article, the song's audio for on-demand listening, credits (recording, mixing, mastering), album and release date, artist quotes, release show, on-air debut times | Extract from article text; store the song audio as a playable asset; **never transcribe the song** | Rich facts for local tracks, a song to play on Echo Show, a release show linked to Field Guide events |
| MKE Concert Picks | Weekly picks article | The station's recommended shows for the week: artist, venue, date, a short reason | Extract each pick from text; match to Field Guide events | Editorial picks for "What's 88Nine recommending this week?" |
| Concert news and reviews | Tour announcements | Artist, venue, date, context | Extract from text | Links from artists in rotation to upcoming shows |
| Studio Milwaukee Sessions | Live performance plus interview | Station-produced audio, about 25 minutes | Transcribe; keep interview segments, drop song segments | Artist quotes and stories in the artist's own voice |
| Syndicated content | NPR Tiny Desk, partner interviews | Not station-produced | **Link only;** no download or processing | A pointer when an artist has one |

### Why premieres matter most

Premieres close the biggest data gap in the music pillar: **local artists missing from MusicBrainz and Discogs.** Each premiere is a station-written record of a local track, with credits, album, release date, and the artist's own description. The engine writes those as sourced facts on the track, so when the song airs on 88Nine, song recall and the track story already have everything they need.

The premiere article also lists the song's on-air debut times (for Glitzy: 6:30 and 10:30 a.m., 2:30 and 6:30 p.m.), which matches the playlist spins and confirms the link between the article and the track.

### Concert Picks are the station's editorial picks

The main PRD marked staff picks as not yet implemented. MKE Concert Picks already are staff picks, published weekly. Extracting each pick and linking it to its Field Guide event gives Alexa a sourced answer to "What's 88Nine recommending this week?" with no new editorial work. Picks expire when their week ends.

## Problem, goals, and non-goals

Radio Milwaukee's podcasts hold years of local knowledge (community stories, restaurant recommendations, conversations with Milwaukee voices) that is hard to find, search, or measure once an episode leaves the feed.

- **Listeners** hear a 90-second short on 88Nine, or a restaurant tip on This Bites, and can't easily find the full story later.
- **Producers** can't quickly answer "have we covered this neighborhood or topic?"
- **Station leadership** has no measured view of coverage for funders and mission reporting.
- **AI assistants** answer local questions from newspapers, not from the station's own stories.

### Goals

| Goal | Measure | Proposed target |
| --- | --- | --- |
| Every new episode processed | Time from publish to editor-ready | Within 24 hours |
| Trustworthy extraction | Extracted people, places, and topics whose evidence quote appears in the transcript | 100% (enforced, not sampled) |
| Useful classification | Editor agreement with model topics on the labeled set | 85% or better |
| Light editor load | Review time per episode | Under 10 minutes |
| Places that map correctly | Approved places with correct coordinates on spot check | 95% or better |

### Non-goals

| Non-goal | Why |
| --- | --- |
| Answering listener requests | That's the MCP server's job; the engine only writes data |
| Publishing anything without editor approval | Real people and places are involved |
| Transcribing NPR network audio | Not ours to store; station content only |
| Generating new story text or summaries in a host's voice | Summaries are labeled as summaries; quotes are verbatim |
| Real-time processing | Weekly cadence makes batch processing sufficient |

## User stories

Editors are the engine's primary users; listeners benefit through the Alexa add-on and the website.

**Producers and editors**

- As an editor, I want each new episode's people, places, and topics proposed with the supporting passage so that I can approve them in minutes.
- As an editor, I want to map Transcribe's speaker labels to real names once per episode so that every quote is attributed correctly.
- As an editor, I want to correct a wrong place or topic and have that correction stick so that I never fix the same thing twice.
- As a producer, I want to see which neighborhoods and topics we've covered this year so that I can plan stories where coverage is thin.

**Listeners (through Alexa and the web)**

- As a listener, I want to find the full story behind a short I heard on 88Nine so that I can hear the whole thing.
- As a listener, I want to know where a story happened and what I can do about it (visit, attend, support) so that the story leads somewhere.

* As a listener, I want to ask where This Bites recommended for tacos in Bay View so that I can go, and book a table if the restaurant takes reservations.
* As a listener, I want to hear when a recommendation was made so that I know whether it's still current.

**Station leadership and development**

- As a development lead, I want counts of stories by neighborhood and topic so that funder reports use real numbers.
- As station leadership, I want story collections by topic so that underwriting and newsletter features are easy to assemble.

**Edge cases:** episodes with no transcript and only a description, multiple guests with overlapping speech, places with no address, stories about a person rather than a place, restaurants that have since closed, and shorts whose parent episode isn't published yet.

## Scope

The hackathon needs only enough of the engine to power one story flow; everything else is post-hackathon.

### Hackathon slice (P1 in the main PRD; first to cut)

| Requirement | Acceptance criteria |
| --- | --- |
| Ingest recent episodes from the demo show | 5 to 10 recent episodes and their shorts in Convex, linked short to parent |
| Airing log for shorts | Shorts aired in the demo window recorded with station and time |
| Transcripts | Existing CDS transcript used when present; otherwise Amazon Transcribe with speaker labels |
| Extraction | People, places, organizations, events, and up to 3 topics per story, each with a verbatim evidence quote that appears in the transcript |
| Geocoding | Places geocoded with Amazon Location; confidence recorded |
| Review | Editor approves places, topics, speaker names, and actions before anything is readable by the MCP server |
| Actions | At least one visit, attend, support, or remember action per demo story |

### After the hackathon

| Requirement | Acceptance criteria |
| --- | --- |
| Archive backfill | All station episodes in CDS processed, newest first, within budget |
| Coverage dashboard | Stories by topic, neighborhood, and month; exportable for funder reports |
| Story map | Approved places shown by neighborhood on web and Echo Show |
| Archive search | "Who in Milwaukee is doing urban farming?" answered from transcripts, with clips |
| Recurring venues | Story places linked to MKE Field Guide venues so events follow stories automatically |

**All shows after the hackathon:** onboard each station podcast with a show profile, starting with This Bites and Ladies First, then the rest of the catalog.

**Music coverage in the hackathon:** worth pulling forward. Processing the last 10 to 20 Milwaukee Music Premieres and the current week's Concert Picks is text-only, cheap, and directly strengthens the main demo: richer local track stories and a working `station_picks` answer.

## Pipeline

Each episode moves through one automated path to a single human gate; the airing log feeds Convex directly because it is a record, not extracted content.

&#91;embedded content: story engine pipeline · 9 steps, 1 decision, editor gate\]

The automatic evidence check runs before an editor sees anything, so review time goes to judgment calls, not catching invented details.

## Topic and neighborhood classification

Stories are classified with the same vocabulary the MKE Field Guide uses for events, so stories and events join without any mapping layer.

- **Topics:** the Field Guide's `category` values, plus at most a few story-specific additions (for example civic life, history). No free-form tags.
- **Audience:** the Field Guide's `audienceTags` (for example family), so "family-friendly stories" lines up with "free family events."
- **Neighborhoods:** the Field Guide's curated neighborhood list, assigned from the story's approved places.

### Rules

- Up to 3 topics per story, each with a confidence score.
- Every topic carries the passage that supports it; a topic whose quote isn't found in the transcript is discarded automatically.
- Topics from a description alone (no transcript) are marked `basis: description` and shown to editors as lower confidence.
- Classification runs in the same Bedrock call as entity extraction, not as a separate tool.
- Adding a topic to the vocabulary is an editor decision, recorded in the repo, never something the model invents.

### What it joins

| Story topic or place | Joins to |
| --- | --- |
| Music story | Field Guide live-music events; artists in rotation |
| Food story in Walker's Point | Food events in Walker's Point |
| Family-audience story | Free family events |
| Story place that is a Field Guide venue | That venue's upcoming events |

**This Bites joins:** a restaurant mentioned on This Bites links to that venue's Field Guide food events, and to Alexa's native restaurant reservations when the listener wants to book.

### Show-specific entities

Topics stay on the shared vocabulary for every show; shows add entity types, not topics.

| Show | Entity types it adds | Stored as |
| --- | --- | --- |
| This Bites | Restaurant, bar | A place with a category |
| This Bites | Chef | A person |
| This Bites | Dish | A new `dish` mention type, tied to its restaurant |
| Uniquely Milwaukee | None beyond the base set | People, places, organizations, events |
| Ladies First | To confirm | To confirm |

## Data contract with the MCP server

The engine writes; the MCP server only reads rows marked approved. That one rule is the whole contract.

| Table | Engine writes | MCP server reads | Readable when |
| --- | --- | --- | --- |
| `stories` | Title, two-sentence summary, keywords, audio URL, parent link for shorts | `get_story` | Transcript done and summary approved |
| `airings` | Station and time each short aired | `find_story_aired` | Always (it's a log) |
| `transcriptSegments` | Text, timestamps, speaker labels | Clip references in `get_story` | Speakers mapped to names |
| `mentions` | People, places, organizations, events, each with a verbatim quote | `get_story` | Parent story approved |
| `places` | Name, coordinates, geocode confidence, neighborhood, Field Guide venue link | `get_story`, later `stories_near` | `reviewStatus` is approved |
| `storyTopics` | Topic, neighborhood, confidence, evidence, basis | Later topic queries | `status` is approved |
| `storyActions` | Visit, attend, support, remember options | `get_story`, `story_actions` | Created or approved by an editor |
| `sources` | One row per episode transcript or CDS document | Attribution in answers | Always |

These tables are already defined in the shared Convex schema (`convex/schema.ts`), with three additions from this PRD: the `storyTopics` table, and a `reviewStatus` field on both `stories` and `storyActions`.

**Versioning:** if the engine re-processes an episode, it writes new rows as pending and keeps the approved ones live until an editor approves the replacements. A listener never sees a half-updated story.

**Show fields:** a `shows` table (name, feed URL, CDS channel ID, profile, reviewer) and a `showId` on `stories`. `mentions.entityType` gains `dish`. `places` gains a `category` (restaurant, bar, venue, park, organization) and a `lastConfirmedAt` date, so a This Bites restaurant can carry how recently it was known to be open.

**Music coverage fields:**

- `stories` gains a `contentType`: episode, short, article, premiere, concert picks, or session.
- A new `audioAssets` table holds playable audio separately from transcripts: kind (episode, song, session), URL, duration, and a `rightsConfirmed` flag. Only confirmed assets are playable.
- A new `editorialPicks` table holds each Concert Picks entry: artist, venue, date, the station's one-line reason, the Field Guide event ID, the source article, and an expiry date.
- Premieres also write to the music pillar: they create or update the local track and artist, and add sourced `facts` (credits, album, release date) using the same evidence rule. This is the one place the story engine writes outside the story tables.

**New MCP reads:** `station_picks` reads current, approved `editorialPicks`; `get_track_story` picks up premiere facts automatically; on Echo Show, a premiere's song plays from `audioAssets` inside an MCP App.

## Editor review workflow

One review screen per episode, designed to take under 10 minutes; nothing is readable by the MCP server until it's approved here.

1. **Map speakers.** Transcribe labels voices spk\_0, spk\_1; the editor names each once, using a short audio snippet per speaker.
2. **Check the summary.** Approve or edit the two-sentence summary that Alexa will use.
3. **Check people and organizations.** Each shows its verbatim quote and a play button at its timestamp.
4. **Check places.** Each shows its pin on a small map, geocode confidence, and any Field Guide venue match. Low-confidence pins are flagged first.
5. **Check topics.** Up to 3, each with its supporting passage.
6. **Add actions.** Pre-filled suggestions (venue events from the Field Guide, organization links from show notes); the editor keeps, edits, or removes them.
7. **Approve the episode.** Everything checked becomes readable at once.

**Corrections stick:** an editor's change to a place, speaker name, or topic is recorded as an editor decision, and re-processing never overwrites it. This is the same field-lock pattern the MKE Field Guide uses for event edits.

**Where it lives:** a small Clerk-gated admin page, reusing the Field Guide's two-tier staff allowlist rather than a new auth setup.

**Reviewers by show:** each show profile names its reviewer, usually the show's own producer or host, who already knows every place and person mentioned. That keeps review fast as more shows are added.

**Music coverage review:** the digital content team reviews premieres and Concert Picks. For premieres, the reviewer confirms the track and artist match and the audio rights; for picks, each Field Guide event match.

## Model choice and evaluation

Start with Amazon Nova Micro on Bedrock for extraction and classification, and let a 20-episode labeled set decide whether to step up.

| Option | Role | Decision |
| --- | --- | --- |
| Amazon Nova Micro (Bedrock) | Extraction + topics in one structured call | Start here: cheapest, counts toward the AWS Builder mini challenge |
| Amazon Nova Lite or Claude Haiku (Bedrock) | Same job, stronger extraction | Step up only if Micro fails the eval |
| Jev (TypeSafe AI) | Fast classification outside AWS | Not used: returns labels and scores, not the evidence quotes this engine requires; not on Bedrock |
| Amazon Transcribe | Speech to text with speaker labels | Used when CDS has no transcript |
| Amazon Location Service | Geocoding places | Used for every extracted place |

### Evaluation plan

1. Hand-label 20 episodes across shows (for example 10 Uniquely Milwaukee, 6 This Bites, 4 Ladies First): people, places, topics, each with its supporting passage.
2. Run each candidate model on the same 20 with the same prompt and output schema.
3. Score: precision and recall on places and people; topic agreement; share of evidence quotes found verbatim in the transcript (must be 100% after the automatic check); estimated editor fix time.
4. Pick the cheapest model that passes; keep the labeled set in the repo as the regression eval.

**Transcribe settings:** speaker labels on; a custom vocabulary of Milwaukee places, venues, organizations, and frequent guests (for example Linneman's, Sherman Phoenix, Riverwest), plus restaurant and chef names from This Bites.

## Rights, privacy, and content rules

These are real Milwaukee residents, so the engine is stricter than the music pipeline.

| Rule | Detail |
| --- | --- |
| Station audio only | Download and transcribe Radio Milwaukee episodes; never NPR network audio, which is play-or-link only |
| Real people's words are never paraphrased as quotes | Quotes are verbatim with timestamps; summaries are labeled as summaries |
| Evidence or it's dropped | Any person, place, topic, or action without a matching transcript passage is discarded automatically |
| Nothing public without approval | Only editor-approved rows are readable by the MCP server or website |
| Sensitive stories get a flag | Editors can mark a story or mention as not for assistant use (for example stories involving minors, grief, or private addresses) |
| Home addresses never stored as places | Places are public venues, parks, businesses, and organizations |
| Photos | Story photos may be licensed from photographers; check before showing them on screens |
| Third-party place data | The Field Guide's Overture-based venue registry stays internal; use the station's own coordinates for anything shown |

**Opinions stay opinions.** A This Bites recommendation is the hosts' view on a given date. Alexa attributes it to the show and the episode date ("This Bites recommended it in March 2025") and never states it as fact or as a current rating.

**Premiere audio needs confirmed rights.** Artists submit premiere tracks to debut on Radio Milwaukee. Before a song plays inside Alexa, confirm the submission terms cover on-demand streaming on station-operated apps and devices, not just the website. Until confirmed, link to the article instead.

**No lyrics, ever.** Premiere articles often quote lyrics. The engine never extracts them as facts or quotes, and song segments in Studio Milwaukee Sessions are dropped, not transcribed into the record.

**Syndicated content is link-only.** NPR Tiny Desk concerts and partner interviews that appear on the concerts page are not station-produced; the engine stores a link and nothing else.

## Costs and operations

Weekly operation costs little; the archive backfill is the one real expense, so it runs newest first and within a set budget.

- **Transcription** is billed per minute of audio. Check current Amazon Transcribe pricing before the backfill; the full archive could run several hundred dollars. Skip it entirely when CDS already has a transcript.
- **Extraction** with Nova Micro is a few cents per episode at most; trivial at one episode a week.
- **Geocoding** is a handful of lookups per episode.
- **Hackathon** volume (5 to 10 episodes) fits easily within the $150 AWS credit available to participants.

**With every show included, the archive is larger** (This Bites alone has about 377 episodes), so backfill one show at a time, newest first. For This Bites, set a cutoff: restaurant episodes older than a few years are mostly out of date and may not be worth transcribing.

**Music coverage is nearly free to process.** Premieres, Concert Picks, and news articles are text in CDS, so they skip transcription and cost only the extraction call. Only Studio Milwaukee Sessions add transcription, at about 25 minutes each.

### Operations

| Job | Trigger | Retry |
| --- | --- | --- |
| Ingest new episodes | Daily check of the podcast feed or CDS | Next day |
| Record airings | From the playlist system or automation log, as shorts air | Backfill from the log |
| Transcribe | New episode without a CDS transcript | Exponential backoff, 3 attempts |
| Extract and classify | Transcript complete | 3 attempts, then flagged for an editor |
| Geocode | New place extracted | 3 attempts, then flagged |
| Archive backfill | Manual, in batches, newest first | Resume from last processed episode |

All jobs use the shared `jobs` table in Convex, with the same backoff pattern the Field Guide uses for failing sources.

## Build plan and testing

For the hackathon, the engine gets the Phase 5 window in the main PRD (October 17 to 19) and starts only if Phases 1 to 4 are done; the prep work below can happen earlier in spare moments.

### Prep that can start now (no code)

- [ ] Confirm whether the playlist system or automation logs the shorts when they air
- [ ] Check whether station episodes in CDS carry transcripts
- [ ] Pick 5 to 10 recent episodes for the demo
- [ ] Draft the Transcribe custom vocabulary list
- [ ] Export the Field Guide's category, audience, and neighborhood lists as the shared taxonomy file

* [ ] Collect each show's feed URL and CDS channel ID
* [ ] Draft show profiles for This Bites and Ladies First with their producers
* [ ] Choose the demo show: Uniquely Milwaukee or This Bites

### Build order

1. **Ingest** episodes and shorts from the feed or CDS; link shorts to parents.
2. **Airings** from the log, or entered by hand for the demo window if no log exists.
3. **Transcripts:** CDS transcript if present, else download to S3 and run Transcribe.
4. **Extraction and topics** in one Nova call with a strict output schema; automatic evidence check drops anything unsupported.
5. **Geocoding** with Amazon Location.
6. **Review page** with the seven-step workflow.
7. **Approve** demo episodes and confirm `find_story_aired` and `get_story` read them.

### Testing

| Test | Pass when |
| --- | --- |
| Evidence check (unit) | A fabricated quote is always rejected; a real quote with different spacing or punctuation is accepted |
| Contract (unit) | The MCP server's queries return nothing for unapproved rows |
| Labeled-set eval | Chosen model meets the topic and place targets in Goals |
| Re-processing | An editor's corrections survive a second run of the same episode |
| End to end | A demo short aired on 88Nine is found by `find_story_aired`, and `get_story` returns its place and an action |

### Working with Claude Code

Keep this PRD in the same repo as the main one (`docs/BACKSTORY_PRD.md`), build the engine as `apps/backstory`, and start in plan mode with: "Read the Backstory PRD and the shared Convex schema. Propose the ingest and transcript steps with tests, using the existing `jobs` table."

## Reference repos

Backstory builds on two existing Radio Milwaukee repos; Claude Code should read both before writing ingest or venue-matching code.

| Repo | What it is | What Backstory uses from it |
| --- | --- | --- |
| [npr-cds-openapi](https://github.com/tmoody1973/npr-cds-openapi) | OpenAPI 3.1 spec for NPR's Content Distribution Service, NPR's vendored profile schemas, and the `npr-cds-mcp` server | Typed CDS client for ingesting episodes, premieres, Concert Picks, and sessions; `validate-samples` to check ingested documents; the MCP server for exploring CDS while building |
| [mke-field-guide](https://github.com/tmoody1973/mke-field-guide) | Milwaukee event discovery platform: Next.js, Neon Postgres, Trigger.dev, Clerk admin | Shared vocabulary (categories, audience tags, curated neighborhoods), venue and alias tables for place matching, the admin shell and staff allowlist for the review UI, and patterns for field locks, edit history, and job backoff |

### What the CDS repo tells us

- **Station content is ours to use.** The repo's reading of NPR's station API terms: a station may use content it publishes into CDS however it likes (clause 19). Other providers' audio must be linked from NPR's servers, and premium content may not be stored.
- **Ladies First is in CDS.** The repo's own examples query its newest episodes, so it can be ingested the same way as the other shows.
- **Validated against Radio Milwaukee's feed.** 1,000 documents and 16,925 nested assets from the station's feed validated with zero failures, including podcast channels.
- **Ingest gotchas:** CDS documents no rate limit beyond retrying on 503, so the ingest job backs off on 503; and results came back oldest-first despite the docs, so always pass `sort` explicitly.
- **Tokens are one per client.** Backstory's worker needs its own CDS token, not a person's.

### What the Field Guide repo tells us

- **Venue identity:** `venue_aliases` and the merge history are what make "Linneman's" and "Linnemans Riverwest Inn" the same place; Backstory matches against them rather than raw names.
- **Neighborhoods:** the curated registry in `src/lib/neighborhoods.ts` and the venue map in `src/maintenance/venue-neighborhood-map.ts` are the neighborhood vocabulary.
- **Taxonomy:** event `category`, `vibeTags`, and `audienceTags` from the enrichment sweep are the topic vocabulary.
- **Review patterns to reuse:** field locks, `event_edits` provenance, the two-tier Clerk allowlist, and source backoff.
- **Keep internal:** the Overture-based venue registry may help matching but is never shown publicly.
- **Testing:** the Field Guide's Vitest + PGlite setup runs Postgres tests without a cloud database; reuse it for Backstory's read-only queries.

## Open questions

The first two decide whether the hackathon slice is possible at all.

| Question | Who answers | Blocks |
| --- | --- | --- |
| Does the playlist system or automation log the shorts when they air? | Station operations | Story recall |
| Do station episodes in CDS include transcripts? | Engineering | Transcribe cost and timing |
| Who reviews episodes weekly, and how long can they spend? | Content team | Approval cadence |
| Which story-specific topics, if any, join the shared vocabulary? | Content team | Classification |
| Are any past episodes off-limits for assistant use? | Content team | Archive backfill |
| What is the budget for the archive backfill? | Station leadership | Backfill pace |

### Questions added with the other shows

| Question | Who answers | Blocks |
| --- | --- | --- |
| What are Ladies First's format, focus, and reviewer? | Its producer | Ladies First profile |
| Which show is the hackathon demo? Uniquely Milwaukee needs the airing log; This Bites needs the reservation handoff verified on a device | Project lead | Demo flow |
| How old can a This Bites restaurant mention be before it's excluded from answers? | This Bites hosts | Restaurant answers |
| What confirms a restaurant is still open (Field Guide activity, a recent episode, a business listing)? | Engineering | `lastConfirmedAt` |
| Which other station podcasts are in scope, and in what order? | Content team | Backfill plan |

### Questions added with music coverage

| Question | Who answers | Blocks |
| --- | --- | --- |
| Do premiere submission terms allow on-demand streaming in station apps and devices, including Alexa? | Station leadership, with the music submission terms | Playing premiere songs on Echo Show |
| Does CDS carry the premiere's song audio as an audio enclosure? | Engineering | Premiere audio ingest |
| Do Concert Picks articles follow a consistent structure (artist, venue, date per pick)? | Digital content team | Pick extraction accuracy |
| Are Studio Milwaukee Sessions in CDS with audio, and are performance and interview segments marked? | Engineering | Session processing |
