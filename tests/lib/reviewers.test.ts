import { describe, expect, it } from "vitest";
import { isReviewer, parseReviewerList } from "../../convex/lib/reviewers";

const LIST = "tarik@radiomilwaukee.org, @example.org, not an email";

describe("parseReviewerList", () => {
  it("lowercases, trims and drops malformed entries", () => {
    expect(parseReviewerList(" Tarik@RadioMilwaukee.org ,@Example.org,,junk")).toEqual(["tarik@radiomilwaukee.org", "@example.org"]);
  });
  it("is empty when the env var is unset", () => {
    expect(parseReviewerList(undefined)).toEqual([]);
  });
});

describe("isReviewer", () => {
  it("accepts an exact verified email, any case", () => {
    expect(isReviewer("TARIK@radiomilwaukee.org", true, LIST)).toBe(true);
  });
  it("accepts any verified email at a listed domain, but not a subdomain or lookalike", () => {
    expect(isReviewer("kim@example.org", true, LIST)).toBe(true);
    expect(isReviewer("kim@mail.example.org", true, LIST)).toBe(false);
    expect(isReviewer("kim@badexample.org", true, LIST)).toBe(false);
  });
  it("refuses an unverified or missing email", () => {
    expect(isReviewer("tarik@radiomilwaukee.org", false, LIST)).toBe(false);
    expect(isReviewer("tarik@radiomilwaukee.org", undefined, LIST)).toBe(false);
    expect(isReviewer(undefined, true, LIST)).toBe(false);
  });
  it("anchors domain rules at the last @ so a quoted local part can't smuggle a mailbox", () => {
    expect(isReviewer('"x@example.org"@evil.com', true, LIST)).toBe(false);
  });
  it("refuses Clerk test-mode addresses, which a development instance marks verified without a real inbox", () => {
    expect(isReviewer("anyone+clerk_test@radiomilwaukee.org", true, "@radiomilwaukee.org")).toBe(false);
    expect(isReviewer("tarik+clerk_test@radiomilwaukee.org", true, "tarik+clerk_test@radiomilwaukee.org")).toBe(false);
  });
  it("refuses everyone when the list is empty (fail closed)", () => {
    expect(isReviewer("tarik@radiomilwaukee.org", true, "")).toBe(false);
  });
});
