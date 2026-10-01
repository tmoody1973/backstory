# 001: Backstory owns its own Convex project

**Decision:** Backstory's tables live in their own Convex project in this repo, not in a shared schema inside a main Alexa repo.

**Why this came up:** The PRD says the tables are "already defined in the shared Convex schema," but no such repo exists yet. Waiting for it would block every pipeline step.

**Options:**
- Own repo and Convex project now. Unblocks the build today; the MCP server reads Backstory's public queries over the network.
- Find or build the main monorepo first. Matches the PRD exactly, but setup work comes before any Backstory code.
- One shared Convex project for everything. Simplest reads for the MCP server, but every system's deploys and schema changes collide.

**What we chose and why:** Own repo (Tarik). The PRD's own boundary — "the engine writes, the MCP server only reads approved rows" — maps cleanly onto two public queries.

**What we gave up:** The MCP server calls Backstory's Convex deployment instead of reading tables directly, and if a monorepo appears later, these tables move.

**How we'll know if this was right:** The MCP server answers This Bites and Uniquely Milwaukee questions using only `public.getStory` and `public.searchStories`, with no direct table access.

**What actually happened:**
