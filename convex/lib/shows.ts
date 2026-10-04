export const ENTITY_TYPES = ["person", "organization", "place", "event", "dish"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const PLACE_CATEGORIES = ["restaurant", "bar", "venue", "park", "organization"] as const;
export type PlaceCategory = (typeof PLACE_CATEGORIES)[number];

export const ACTION_KINDS = ["visit", "reserve", "attend", "support", "remember"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export type CdsProfile = "podcast-episode" | "story";

export interface ShowProfile {
  slug: string;
  name: string;
  /** CDS collection id: a podcast channel, or a station series. */
  cdsCollectionId: string;
  /** What the collection holds: podcast episodes, or station stories with audio (Ladies First). */
  cdsProfile: CdsProfile;
  entityTypes: readonly EntityType[];
  actionKinds: readonly ActionKind[];
  /** Regular hosts, used to suggest names for transcript speakers. */
  hosts: readonly string[];
  /** Show-specific guidance appended to the extraction prompt. */
  extractionNotes: string;
  reviewer: string;
  /** Whether Alexa may quote this show's transcripts when an editor hasn't set the episode's switch. */
  detailedAnswersDefault: boolean;
}

// Adding a show means adding a profile here, not changing pipeline code.
// The other station podcasts are added in Plan 3.
export const SHOW_PROFILES: Readonly<Record<string, ShowProfile>> = {
  "this-bites": {
    slug: "this-bites",
    name: "This Bites",
    cdsCollectionId: "718413877",
    cdsProfile: "podcast-episode",
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
    entityTypes: ["person", "organization", "place", "event"],
    actionKinds: ["attend"],
    hosts: ["Element Everest-Blanks"],
    extractionNotes:
      "Ladies First is a HYFIN interview series with women musicians. The guest artist is a person and the subject of the story; collaborators, bandmates, producers and family members she names are people too. Record labels, bands and groups are organizations. Places are where the story happens or where she comes from, especially any Milwaukee connection; a concert venue is a venue. A tour stop or show is an event. Albums and songs belong in the summary, never as separate mentions. The episode plays clips of her songs: never use sung lyrics as a quote, evidence or fact; quote only spoken conversation. Attend actions are for upcoming shows named in the episode.",
    // ponytail: reviewer not yet named (PRD open question)
    reviewer: "Ladies First producer (to confirm)",
    detailedAnswersDefault: false, // song clips in the audio: off until a transcript check shows lyrics stay out of quotes
  },
};

export function getShowProfile(slug: string): ShowProfile {
  const profile = SHOW_PROFILES[slug];
  if (!profile) throw new Error(`Unknown show "${slug}"`);
  return profile;
}
