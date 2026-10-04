export const CDS_BASE_URL = "https://content.api.npr.org/v1";
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

interface CdsLink {
  href: string;
  rels?: string[];
}

interface CdsAudioAsset {
  duration?: number;
  enclosures?: Array<{ href: string; type?: string }>;
}

export interface CdsDocument {
  id: string;
  title: string;
  teaser?: string;
  publishDateTime: string;
  audio?: CdsLink[];
  images?: CdsLink[];
  assets?: Record<string, CdsAudioAsset & { enclosures?: ImageEnclosure[] }>;
  webPages?: CdsLink[];
}

export interface CdsEpisode {
  cdsId: string;
  title: string;
  teaserText: string;
  publishedAt: number;
  audioUrl: string;
  durationSec: number;
  permalink?: string;
  /** The episode's own photo (station stories have one; podcast episodes use the show artwork). */
  imageUrl?: string;
}

/** Always sort explicitly: without it CDS returned oldest first, despite its docs. */
export function buildShowQueryUrl(collectionId: string, limit: number, profileId: "podcast-episode" | "story" = "podcast-episode"): string {
  const params = new URLSearchParams({
    collectionIds: collectionId,
    profileIds: profileId,
    sort: "publishDateTime:desc",
    limit: String(limit),
  });
  return `${CDS_BASE_URL}/documents?${params}`;
}

export function buildDocumentUrl(cdsId: string): string {
  return `${CDS_BASE_URL}/documents/${encodeURIComponent(cdsId)}`;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,:;!?])/g, "$1")
    .trim();
}

/** Null when there is no audio: nothing to transcribe, so nothing to ingest. */
export function parseEpisode(doc: CdsDocument): CdsEpisode | null {
  const assetId = doc.audio?.[0]?.href.replace("#/assets/", "");
  const asset = assetId ? doc.assets?.[assetId] : undefined;
  const enclosure = asset?.enclosures?.find((e) => e.type === "audio/mpeg") ?? asset?.enclosures?.[0];
  if (!enclosure) return null;
  const permalink = doc.webPages?.find((page) => page.rels?.includes("canonical"))?.href;
  const imageId = doc.images?.[0]?.href.replace("#/assets/", "");
  const imageUrl = imageId && doc.assets?.[imageId] ? seriesImageUrl({ assets: { [imageId]: doc.assets[imageId] } }) : null;
  return {
    cdsId: doc.id,
    title: doc.title,
    teaserText: stripHtml(doc.teaser ?? ""),
    publishedAt: Date.parse(doc.publishDateTime),
    audioUrl: enclosure.href,
    durationSec: asset?.duration ?? 0,
    ...(permalink ? { permalink } : {}),
    ...(imageUrl ? { imageUrl } : {}),
  };
}

/** CDS has no rate limit beyond 503s, so retry those with backoff and fail fast on anything else. */
export async function fetchCds(
  url: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    if (response.ok) return response.json();
    if (response.status !== 503 || attempt >= RETRY_DELAYS_MS.length) {
      throw new Error(`CDS request failed: HTTP ${response.status} for ${url}`);
    }
    await sleep(RETRY_DELAYS_MS[attempt]);
  }
}

interface ImageEnclosure {
  href: string;
  rels?: string[];
}

/** A podcast series' artwork from its CDS document: the square image, else the primary one. */
// ponytail: series artwork only; per-episode PRX feed images were identical to it on 2026-10-02. Compare the feed's itunes:image per episode if that changes.
export function seriesImageUrl(doc: { assets?: Record<string, { enclosures?: ImageEnclosure[] }> }): string | null {
  const enclosures = Object.values(doc.assets ?? {}).flatMap((asset) => asset.enclosures ?? []);
  const square = enclosures.find((e) => e.rels?.includes("image-square"));
  return (square ?? enclosures.find((e) => e.rels?.includes("primary")))?.href ?? null;
}
