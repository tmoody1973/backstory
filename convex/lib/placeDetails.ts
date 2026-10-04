import { normalizeForMatch } from "./evidence";

const MAX_METERS = 400; // the result must sit at the place's pin, not across town
const GENERIC = new Set(["the", "and", "bar", "cafe", "restaurant", "grill", "milwaukee", "mke", "house", "club", "kitchen"]);

type Item = {
  Title?: string;
  Distance?: number;
  Contacts?: { Phones?: { Value?: string }[]; Websites?: { Value?: string }[] };
  OpeningHours?: { Display?: string[] }[];
};

const words = (s: string) => new Set(normalizeForMatch(s).split(" ").filter((w) => w.length >= 3 && !GENERIC.has(w)));
const web = (url?: string) => (url && /^https?:\/\//i.test(url) ? url : undefined);

/**
 * From Amazon Location results near a place's pin, the one that is this place (shares a distinctive name word and sits
 * within a few hundred meters): its phone, website and opening hours. Null when none is confidently the same place.
 */
export function pickDetails(name: string, items: Item[]): { phone?: string; website?: string; openingHours?: string } | null {
  const mine = words(name);
  const match = items.find((item) => (item.Distance ?? Infinity) <= MAX_METERS && [...words(item.Title ?? "")].some((w) => mine.has(w)));
  if (!match) return null;
  return {
    phone: match.Contacts?.Phones?.[0]?.Value,
    website: web(match.Contacts?.Websites?.[0]?.Value),
    openingHours: match.OpeningHours?.[0]?.Display?.join("; ") || undefined,
  };
}

/** What "Fetch details" asks Amazon, in order: the name alone near the pin (an address in the text makes Amazon return the address, not the business), then name and address. */
export function detailQueries(place: { name: string; address: string | null }): string[] {
  return [place.name, place.address ? `${place.name}, ${place.address}` : `${place.name}, Milwaukee, WI`];
}
