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
  assets?: Record<string, CdsAudioAsset>;
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
}

/** Always sort explicitly: without it CDS returned oldest first, despite its docs. */
export function buildShowQueryUrl(collectionId: string, limit: number): string {
  const params = new URLSearchParams({
    collectionIds: collectionId,
    profileIds: "podcast-episode",
    sort: "publishDateTime:desc",
    limit: String(limit),
  });
  return `${CDS_BASE_URL}/documents?${params}`;
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
  return {
    cdsId: doc.id,
    title: doc.title,
    teaserText: stripHtml(doc.teaser ?? ""),
    publishedAt: Date.parse(doc.publishDateTime),
    audioUrl: enclosure.href,
    durationSec: asset?.duration ?? 0,
    ...(permalink ? { permalink } : {}),
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
