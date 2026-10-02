import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime", // convex-test runs functions in Convex's runtime shape
    server: { deps: { inline: ["convex-test"] } },
    include: ["tests/**/*.test.ts"],
  },
});
