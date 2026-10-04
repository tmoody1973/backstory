import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { pickBookingLink } from "./lib/bookingLink";
import { requireReviewer } from "./lib/reviewAuth";

const SEARCH_URL = "https://api.firecrawl.dev/v2/search";
const TIMEOUT_MS = 20_000;

/**
 * "Find booking link": a Firecrawl web search for the place's reservation page (2 credits). Returns a suggestion only;
 * the editor checks it and saves it with setPlaceDetails, so nothing reaches Alexa unseen.
 */
export const find = action({
  args: { key: v.string() },
  handler: async (ctx, { key }): Promise<{ url: string | null }> => {
    await requireReviewer(ctx);
    const name = await ctx.runQuery(internal.reviewMutations.placeNameForKey, { key });
    if (!name) throw new ConvexError({ code: "not_found" });
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not set");
    const response = await fetch(SEARCH_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: `${name} Milwaukee reservations`, limit: 10 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 429) throw new ConvexError({ code: "search_busy" });
    if (!response.ok) {
      console.error("firecrawl search failed", response.status);
      throw new ConvexError({ code: "search_failed" });
    }
    const body = (await response.json()) as { data?: { web?: { url?: unknown }[] } | { url?: unknown }[] };
    const results = Array.isArray(body.data) ? body.data : (body.data?.web ?? []);
    const urls = results.map((r) => r.url).filter((u): u is string => typeof u === "string");
    return { url: pickBookingLink(name, urls) };
  },
});
