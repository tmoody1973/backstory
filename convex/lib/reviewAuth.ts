import { ConvexError } from "convex/values";
import type { Auth } from "convex/server";
import { isReviewer } from "./reviewers";

/**
 * The security boundary for review. The MCP server trusts reviewStatus "approved",
 * so every review function calls this before reading or writing anything.
 */
export async function requireReviewer(ctx: { auth: Auth }): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "not_signed_in" });
  if (!isReviewer(identity.email, identity.emailVerified, process.env.BACKSTORY_REVIEWER_EMAILS)) {
    console.warn(`review: refused ${identity.email ?? identity.subject} (verified: ${identity.emailVerified ?? false})`);
    throw new ConvexError({ code: "not_a_reviewer" });
  }
  return identity.email!.trim().toLowerCase();
}
