"""Bake-off: Deepgram Nova-3 vs our Amazon Transcribe transcripts, scored on name spelling.

    python3 scripts/bakeoff_deepgram.py E01 E02 E04 E07 E11   # run (reads DEEPGRAM_API_KEY from .env.local)
    python3 scripts/bakeoff_deepgram.py --check                # self-check

Score: share of an episode's answer-key names (people, places, organizations) that appear spelled
correctly in the transcript. Deepgram gets only what we'd know before transcribing: the hosts and
the names in that episode's show notes. Transcribe uses the production vocabulary, which was built
from the answer key itself, so it starts with an advantage.
"""

import json
import re
import subprocess
import sys
import unicodedata
import urllib.parse
import urllib.request

HOSTS = ["Tarik Moody", "Ann Christenson", "Kim Shine"]
NAME_TYPES = {"person", "place", "organization"}
KEYTERM_WORD_BUDGET = 300  # Deepgram allows 500 tokens of keyterms; ~1.3 tokens per word leaves headroom
EVAL = "docs/eval"


def norm(text: str) -> str:
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return " " + re.sub(r"[^a-z0-9]+", " ", ascii_text.replace("'", "").replace("’", "")).strip() + " "


def found(name: str, transcript: str) -> bool:
    return norm(name).strip() != "" and norm(name) in norm(transcript)


def show_note_names(show_notes: str) -> list[str]:
    """Capitalized runs of 2-4 words (Cafe Corazon, Joe Sasto, Bay View Neighborhood Association)."""
    pattern = r"\b[A-Z][\w'’&.-]*(?:\s+(?:&|of|de|la|[A-Z][\w'’&.-]*)){1,3}"
    seen, out = set(), []
    for raw in re.findall(pattern, show_notes):
        match = raw.strip().rstrip(".,;:!?")
        key = norm(match)
        if key not in seen:
            seen.add(key)
            out.append(match)
    return out


def keyterms(show_notes: str) -> list[str]:
    terms, words = [], 0
    for term in HOSTS + show_note_names(show_notes):
        n = len(term.split())
        if words + n > KEYTERM_WORD_BUDGET:
            break
        terms.append(term)
        words += n
    return terms


def deepgram(audio_url: str, terms: list[str], api_key: str) -> dict:
    params = [("model", "nova-3"), ("smart_format", "true"), ("diarize", "true")] + [("keyterm", t) for t in terms]
    request = urllib.request.Request(
        "https://api.deepgram.com/v1/listen?" + urllib.parse.urlencode(params),
        data=json.dumps({"url": audio_url}).encode(),
        headers={"Authorization": f"Token {api_key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=600) as response:
        return json.load(response)


def convex(table: str) -> list[dict]:
    out = subprocess.run(["npx", "convex", "data", table, "--limit", "30000", "--format", "jsonl"],
                         capture_output=True, text=True, check=True).stdout
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def main(episodes: list[str]) -> None:
    api_key = next(line.split("=", 1)[1].strip().strip('"') for line in open(".env.local") if line.startswith("DEEPGRAM_API_KEY="))
    picks = json.load(open(f"{EVAL}/labeled-set-episodes.json"))
    key = [l for l in json.load(open(f"{EVAL}/answer-key.json"))["labels"] if l["label_type"] in NAME_TYPES]
    stories = {s["cdsId"]: s for s in convex("stories")}
    segments = convex("transcriptSegments")
    totals = {"transcribe": 0, "deepgram": 0, "names": 0}
    results = {}
    for ep in episodes:
        story = stories[picks[int(ep[1:]) - 1]["cdsId"]]
        transcribe_text = " ".join(s["text"] for s in sorted(
            (s for s in segments if s["storyId"] == story["_id"]), key=lambda s: s["idx"]))
        names = sorted({l["value"] for l in key if l["episode"] == ep})
        # --equal-hints: give Deepgram the same names Transcribe's vocabulary already has (a fair head-to-head)
        terms = (HOSTS + names) if "--equal-hints" in sys.argv else keyterms(story["teaserText"])
        result = deepgram(story["audioUrl"], terms, api_key)
        alt = result["results"]["channels"][0]["alternatives"][0]
        dg_text = alt["transcript"]
        dg_speakers = len({w.get("speaker") for w in alt.get("words", []) if "speaker" in w})
        tr_speakers = len({s["speaker"] for s in segments if s["storyId"] == story["_id"]})
        hits_t = [n for n in names if found(n, transcribe_text)]
        hits_d = [n for n in names if found(n, dg_text)]
        totals["transcribe"] += len(hits_t)
        totals["deepgram"] += len(hits_d)
        totals["names"] += len(names)
        results[ep] = {"names": len(names), "transcribe": len(hits_t), "deepgram": len(hits_d),
                       "only_transcribe": sorted(set(hits_t) - set(hits_d)), "only_deepgram": sorted(set(hits_d) - set(hits_t)),
                       "speakers": {"transcribe": tr_speakers, "deepgram": dg_speakers},
                       "keyterms": len(terms), "duration_sec": result["metadata"].get("duration")}
        print(f"{ep}: names {len(names):3} | Transcribe {len(hits_t):3} | Deepgram {len(hits_d):3} | speakers T{tr_speakers}/D{dg_speakers} | keyterms {len(terms)}")
        print(f"     only Transcribe: {results[ep]['only_transcribe'][:6]}")
        print(f"     only Deepgram:   {results[ep]['only_deepgram'][:6]}")
    print(f"\nTOTAL names spelled right: Transcribe {totals['transcribe']}/{totals['names']}  Deepgram {totals['deepgram']}/{totals['names']}")
    mode = "equal-hints" if "--equal-hints" in sys.argv else "show-notes-hints"
    json.dump({"mode": mode, "totals": totals, "episodes": results}, open(f"{EVAL}/bakeoff-deepgram-{mode}.json", "w"), indent=1)


def check() -> None:
    assert found("Café Corazón", "farewell to Cafe Corazon in Bay View")
    assert not found("Immy's African Cuisine", "Emmy's African Cuisine is expanding")
    assert found("Lupi & Iris", "dinner at Lupi & Iris tonight")
    assert show_note_names("We bid farewell to Café Corazón in Bay View with chefs Joe Sasto and Dan Jacobs.") == [
        "Café Corazón", "Bay View", "Joe Sasto", "Dan Jacobs"]
    assert keyterms("")[:1] == ["Tarik Moody"]
    print("bake-off self-check passed")


if __name__ == "__main__":
    check() if "--check" in sys.argv else main([a for a in sys.argv[1:] if not a.startswith("--")])
