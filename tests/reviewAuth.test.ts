import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { makeTest } from "./helpers";

const REVIEWER = { email: "tarik@radiomilwaukee.org", emailVerified: true, subject: "user_1", issuer: "https://clerk.test" };

afterEach(() => {
  delete process.env.BACKSTORY_REVIEWER_EMAILS;
});

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return error instanceof ConvexError ? (error.data as { code: string }).code : String(error);
  }
}

describe("requireReviewer (via review.queue)", () => {
  it("refuses a caller with no sign-in", async () => {
    process.env.BACKSTORY_REVIEWER_EMAILS = "tarik@radiomilwaukee.org";
    expect(await codeOf(makeTest().query(api.review.queue, {}))).toBe("not_signed_in");
  });
  it("refuses signed-in staff who are not on the reviewer list", async () => {
    process.env.BACKSTORY_REVIEWER_EMAILS = "someone-else@radiomilwaukee.org";
    expect(await codeOf(makeTest().withIdentity(REVIEWER).query(api.review.queue, {}))).toBe("not_a_reviewer");
  });
  it("refuses a listed email that Clerk has not verified", async () => {
    process.env.BACKSTORY_REVIEWER_EMAILS = "tarik@radiomilwaukee.org";
    const unverified = { ...REVIEWER, emailVerified: false };
    expect(await codeOf(makeTest().withIdentity(unverified).query(api.review.queue, {}))).toBe("not_a_reviewer");
  });
  it("lets a listed, verified reviewer in", async () => {
    process.env.BACKSTORY_REVIEWER_EMAILS = "@radiomilwaukee.org";
    expect(await codeOf(makeTest().withIdentity(REVIEWER).query(api.review.queue, {}))).toBe("ok");
  });
});
