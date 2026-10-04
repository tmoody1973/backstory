import { afterEach, describe, expect, it, vi } from "vitest";
import { showImage } from "../convex/ingest";

afterEach(() => vi.unstubAllGlobals());

describe("showImage", () => {
  it("a series CDS won't serve (404, as for Ladies First) means no show artwork, not a failed ingest", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    await expect(showImage("g-s921-13049", "token")).resolves.toBeNull();
  });
});
