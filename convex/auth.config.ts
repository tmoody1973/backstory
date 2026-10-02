import type { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      // Clerk's Frontend API URL, set in the Convex dashboard. Field Guide editors sign in with this Clerk instance.
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
