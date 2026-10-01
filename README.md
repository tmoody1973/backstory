# Radio Milwaukee Backstory

The station's story engine: turns podcast episodes into transcribed, evidence-checked story data that the Alexa MCP server can read once an editor approves it. Spec: `docs/Radio Milwaukee Backstory PRD-2.md`.

## How an episode moves through it

1. A daily cron asks NPR CDS for the newest episodes of each show and saves new ones as pending stories.
2. **Transcribe:** the MP3 is copied to S3 and run through Amazon Transcribe with speaker labels.
3. **Extract:** one Claude Haiku 4.5 call on Bedrock proposes people, places, dishes, topics, actions and a summary. Anything whose quote isn't in the transcript is dropped.
4. **Geocode:** Amazon Location finds coordinates for each place, with a confidence score.
5. An editor approves the run. Only then do `public.getStory` and `public.searchStories` return it.

Each step is a row in the `jobs` table. Failures retry after 1 and 4 minutes; the third failure marks the story `needs_editor`.

## Setup

    npm install
    npx convex dev --once --configure=new   # first time only
    npx convex env set NPR_CDS_TOKEN ...     # see .env.example for every variable

## Commands

    npm test                 # unit tests (no AWS, no network)
    npm run typecheck
    npx convex run ingest:ingestShow '{"showSlug":"this-bites","limit":1}'
    npx convex run ingest:ingestShow '{"showSlug":"uniquely-milwaukee","limit":1}'
    npx convex run admin:approveLatestRunForDemo '{"storyId":"..."}'

Decisions and their reasoning: `docs/decisions/`.
