export const ENTITY_TYPES = ["person", "organization", "place", "event", "dish", "artist"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const PLACE_CATEGORIES = ["restaurant", "bar", "venue", "park", "organization"] as const;
export type PlaceCategory = (typeof PLACE_CATEGORIES)[number];

export const ACTION_KINDS = ["visit", "reserve", "attend", "support", "remember"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export type CdsProfile = "podcast-episode" | "story";
export type ContentType = "episode" | "premiere" | "session";

export interface ShowProfile {
  slug: string;
  name: string;
  /** CDS collection id: a podcast channel, or a station series. */
  cdsCollectionId: string;
  /** What the collection holds: podcast episodes, or station stories with audio (Ladies First). */
  cdsProfile: CdsProfile;
  /** Episodes are transcribed; premieres and sessions are read from their article text. */
  contentType: ContentType;
  entityTypes: readonly EntityType[];
  actionKinds: readonly ActionKind[];
  /** Regular hosts, used to suggest names for transcript speakers. */
  hosts: readonly string[];
  /** Show-specific guidance appended to the extraction prompt. */
  extractionNotes: string;
  reviewer: string;
  /** Whether Alexa may quote this show's transcripts when an editor hasn't set the episode's switch. */
  detailedAnswersDefault: boolean;
  /** When the collection is a general feed: only stories whose page starts with this address belong to the show. */
  pagePrefix?: string;
}

/** Whether a story's page belongs to the show (always, for shows with their own collection). */
export function onShowPages(profile: ShowProfile, permalink: string | undefined): boolean {
  return !profile.pagePrefix || (permalink?.startsWith(profile.pagePrefix) ?? false);
}

// Adding a show means adding a profile here, not changing pipeline code.
// The other station podcasts are added in Plan 3.
export const SHOW_PROFILES: Readonly<Record<string, ShowProfile>> = {
  "this-bites": {
    slug: "this-bites",
    name: "This Bites",
    cdsCollectionId: "718413877",
    cdsProfile: "podcast-episode",
    contentType: "episode",
    entityTypes: ["person", "organization", "place", "event", "dish"],
    actionKinds: ["visit", "reserve", "attend"],
    hosts: ["Tarik Moody", "Ann Christenson"],
    extractionNotes:
      "This Bites is a weekly Milwaukee food show. Restaurants, cafes and bars are places with category restaurant or bar; festival grounds are venue. Chefs and owners are people. A dish is a dish mention whose relatedPlace is the restaurant that serves it. Food festivals and pop-ups are events. The hosts' opinions are opinions: never state them as facts in the summary.",
    reviewer: "Tarik Moody",
    detailedAnswersDefault: true, // hosts and public businesses
  },
  "uniquely-milwaukee": {
    slug: "uniquely-milwaukee",
    name: "Uniquely Milwaukee",
    cdsCollectionId: "718414860",
    cdsProfile: "podcast-episode",
    contentType: "episode",
    entityTypes: ["person", "organization", "place", "event"],
    actionKinds: ["visit", "attend", "support", "remember"],
    hosts: ["Kim Shine"], // guest hosts are read from the show notes ("Episode host: ...")
    extractionNotes:
      "Uniquely Milwaukee tells short stories about Milwaukee people, organizations and places. The people in a story are real residents: name them as they introduce themselves, and never record a private individual's home, street address or anything that would locate where they live. Nonprofits, programs, businesses and shops are organizations; give one a place mention too only if the story is set at its public location (category organization, venue or park). Never extract a participant in a program, a resident of a facility, a patient, or a minor as a person, even by first name: extract the staff, leaders, founders and public figures who speak for the story. The episode host is a person but not the subject. Ignore underwriting and membership credits such as 'supported by our Radio Milwaukee members'. Support actions point to the organization named in the story; remember actions are for stories about history or a person's legacy.",
    // ponytail: reviewer not yet named by the content team (PRD open question); Plan 2 needs a real one
    reviewer: "Uniquely Milwaukee producer (to confirm)",
    detailedAnswersDefault: false, // residents and participants: an editor opts each episode in
  },
  "ladies-first": {
    slug: "ladies-first",
    name: "Ladies First",
    cdsCollectionId: "g-s921-13049",
    cdsProfile: "story",
    contentType: "episode",
    entityTypes: ["artist", "person", "organization", "place", "event"],
    actionKinds: ["attend"],
    hosts: ["Element Everest-Blanks"],
    extractionNotes:
      "Ladies First is a HYFIN interview series with women musicians. The guest is an artist and the subject of the story. Musicians, singers, rappers, DJs, bands and groups who make music are artist (never person or organization); producers who aren't performers and family members are people. Record labels are organizations. Places are where the story happens or where she comes from, especially any Milwaukee connection; a concert venue is a venue. A tour stop or show is an event. Albums and songs belong in the summary, never as separate mentions. The episode plays clips of her songs: never use sung lyrics as a quote, evidence or fact; quote only spoken conversation. Attend actions are for upcoming shows named in the episode.",
    // ponytail: reviewer not yet named (PRD open question)
    reviewer: "Ladies First producer (to confirm)",
    // Public artists and the host; a 17-episode transcript check (2026-10-04) found conversation, not sung lyrics.
    detailedAnswersDefault: true,
  },
  "artist-interviews": {
    slug: "artist-interviews",
    name: "Radio Milwaukee Artist Interviews",
    // ponytail: no collection of their own; the station's general local-stories feed, narrowed by page address
    cdsCollectionId: "319418027",
    cdsProfile: "story",
    contentType: "episode",
    pagePrefix: "https://radiomilwaukee.org/discover-music/artist-interviews/",
    entityTypes: ["artist", "person", "organization", "place", "event"],
    actionKinds: ["attend"],
    hosts: [],
    extractionNotes:
      "Radio Milwaukee Artist Interviews are 88Nine conversations with one guest, usually a musician but not always (a Brewers broadcaster, an author). Only guests who make music are artist; anyone else is a person. Bands and groups who make music are artist; record labels, teams and businesses are organizations. Places are where the story happens or where the guest comes from, especially any Milwaukee connection; a concert venue is a venue. A tour stop or show is an event. Albums and songs belong in the summary, never as separate mentions. Interviews may play clips of songs: never use sung lyrics as a quote, evidence or fact; quote only spoken conversation. Attend actions are for upcoming shows named in the interview.",
    reviewer: "Tarik Moody",
    // Public guests speaking on the record, like Ladies First.
    detailedAnswersDefault: true,
  },
  "milwaukee-music-premiere": {
    slug: "milwaukee-music-premiere",
    name: "Milwaukee Music Premiere",
    cdsCollectionId: "1197908043",
    cdsProfile: "story",
    contentType: "premiere",
    entityTypes: ["artist", "person", "organization", "place", "event"],
    actionKinds: ["attend"],
    hosts: [],
    extractionNotes:
      "A Milwaukee Music Premiere: Radio Milwaukee debuts one local artist's song. Fill the song record: artist, song title, album, release date, credits (who recorded, mixed, mastered, produced), and the release show (venue and date) if named. Musicians, bands and groups who make music are artist (never person or organization), including the premiering artist and anyone on the release show bill; engineers, producers and other non-performers are people. The release show is an event at a venue. Never quote or paraphrase song lyrics.",
    // ponytail: reviewer not yet named (spec open question)
    reviewer: "Milwaukee Music Premiere editor (to confirm)",
    detailedAnswersDefault: true, // station-written article about a public artist
  },
  "studio-milwaukee": {
    slug: "studio-milwaukee",
    name: "Studio Milwaukee Sessions",
    cdsCollectionId: "g-s921-1635",
    cdsProfile: "story",
    contentType: "session",
    entityTypes: ["artist", "person", "organization", "place", "event"],
    actionKinds: ["attend"],
    hosts: [],
    extractionNotes:
      "A Studio Milwaukee Session write-up: a touring or local artist performed live at Radio Milwaukee. Fill the song record with the artist and the set list (song titles in order). The performing musicians and bands are artist (never person or organization); the interviewer is a person; the concert they played that day is an event. Never quote or paraphrase song lyrics.",
    // ponytail: reviewer not yet named (spec open question)
    reviewer: "Studio Milwaukee producer (to confirm)",
    detailedAnswersDefault: true, // station-written article about a public artist
  },
};

export function getShowProfile(slug: string): ShowProfile {
  const profile = SHOW_PROFILES[slug];
  if (!profile) throw new Error(`Unknown show "${slug}"`);
  return profile;
}
