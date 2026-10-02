import type { Segment } from "../../convex/lib/evidence";

// Shaped like Transcribe output for the 2026-09-18 This Bites episode.
export const TEST_SEGMENTS: Segment[] = [
  { speaker: "spk_0", startMs: 0, endMs: 4000, text: "Welcome back to This Bites." },
  { speaker: "spk_1", startMs: 4000, endMs: 9000, text: "We bid a bittersweet farewell to Café Corazón in Bay View," },
  { speaker: "spk_1", startMs: 9000, endMs: 14000, text: "but their Riverwest and Brown Deer locations remain open." },
  { speaker: "spk_0", startMs: 14000, endMs: 20000, text: "Ordering a morning milkshake at Ted's is a local tradition." },
  { speaker: "spk_0", startMs: 20000, endMs: 26000, text: "The live cooking battle pits chefs Joe Sasto and Dan Jacobs against each other." },
  { speaker: "spk_1", startMs: 26000, endMs: 32000, text: "Café Colada serves churros and empanadas in Cathedral Square Park." },
];
