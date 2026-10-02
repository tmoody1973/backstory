// Same rules as the Field Guide's src/lib/staff-auth.ts, so one allowlist syntax works in both places.
const DOMAIN_RULE = /^@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

const wellFormed = (entry: string) => (entry.startsWith("@") ? DOMAIN_RULE.test(entry) : entry.lastIndexOf("@") > 0);

export function parseReviewerList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0 && wellFormed(entry));
}

/** Domain rules ("@radiomilwaukee.org") match at the email's LAST @, never subdomains. */
export function isReviewer(email: string | undefined, emailVerified: boolean | undefined, raw: string | undefined): boolean {
  if (!email || emailVerified !== true) return false;
  const normalized = email.trim().toLowerCase();
  const domain = normalized.slice(normalized.lastIndexOf("@"));
  return parseReviewerList(raw).some((entry) => (entry.startsWith("@") ? domain === entry : normalized === entry));
}
