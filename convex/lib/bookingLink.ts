import { normalizeForMatch } from "./evidence";

const BOOKING_HOSTS = ["opentable.com", "resy.com", "exploretock.com", "sevenrooms.com"];
const MAX_URL = 500;
const GENERIC = new Set(["the", "and", "bar", "cafe", "restaurant", "grill", "milwaukee", "mke", "house", "club", "kitchen", "lounge"]);

/** A reservation page on a known booking site, over https; null clears it. */
export function validReservationUrl(url: string): boolean {
  if (url.length > MAX_URL) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && BOOKING_HOSTS.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

/**
 * From web search result links, the booking page to suggest for a place: booking sites only; a page whose address
 * names the place first (shortest such page, so the restaurant's own page beats a deep link); otherwise the first
 * booking page found, which an editor judges (e.g. a lounge inside a restaurant). Null when there is none.
 */
export function pickBookingLink(name: string, urls: string[]): string | null {
  const booking = urls.filter(validReservationUrl);
  const words = normalizeForMatch(name).split(" ").filter((w) => w.length >= 3 && !GENERIC.has(w));
  const flat = (url: string) => url.toLowerCase().replace(/[^a-z0-9]/g, "");
  const named = booking.filter((url) => words.some((w) => flat(url).includes(w))).sort((a, b) => a.length - b.length);
  return named[0] ?? booking[0] ?? null;
}
