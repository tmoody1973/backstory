"""Export every transcribed story to a private Markdown archive (Lenny's-data style).

    python3 scripts/export_archive.py ../radiomke-backstory-archive   # write the archive
    python3 scripts/export_archive.py --check                        # run the self-check

One file per episode: a front-matter header (show, date, listen link, review status, topics,
people, places), the show notes, then the transcript with speaker names and timestamps.
Convex stays the source of truth; this is a derived, regenerable export.
"""

import json
import os
import re
import subprocess
import sys
import tempfile
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone

SCHEMA_VERSION = 1
SHOW_NAMES = {"this-bites": "This Bites", "uniquely-milwaukee": "Uniquely Milwaukee"}
TABLES = ["stories", "transcriptSegments", "mentions", "places", "storyTopics", "speakerNames"]


def slugify(text: str) -> str:
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.replace("'", "").replace("’", "")).strip("-")[:80].strip("-")


def timestamp(ms: int) -> str:
    s = ms // 1000
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def paragraphs(segments: list[dict], names: dict[str, str]) -> list[str]:
    """Consecutive segments by one speaker become one paragraph, headed by name and start time."""
    out, current = [], None
    for seg in segments:
        if current and current["speaker"] == seg["speaker"]:
            current["text"] += " " + seg["text"]
        else:
            current = {"speaker": seg["speaker"], "start": seg["startMs"], "text": seg["text"]}
            out.append(current)
    def label(spk: str) -> str:
        return names.get(spk) or f"Speaker {int(spk.split('_')[1]) + 1}"
    return [f"**{label(p['speaker'])}** ({timestamp(p['start'])}):\n{p['text']}" for p in out]


def front_matter(fields: dict) -> str:
    # JSON strings and lists are valid YAML, so json.dumps quotes every value safely.
    return "---\n" + "".join(f"{key}: {json.dumps(value, ensure_ascii=False)}\n" for key, value in fields.items()) + "---"


def load_tables(directory: str) -> dict[str, list[dict]]:
    tables = {}
    for table in TABLES:
        path = os.path.join(directory, f"{table}.jsonl")
        with open(path, "w") as f:
            # ponytail: one page of up to 30,000 rows per table (the CLI errors well above that);
            # page through with --cursor once the transcript table outgrows it (~150 hours of audio)
            subprocess.run(["npx", "convex", "data", table, "--limit", "30000", "--format", "jsonl"],
                           stdout=f, stderr=subprocess.DEVNULL, check=True)
        tables[table] = [json.loads(line) for line in open(path) if line.strip()]
    return tables


def episode(story: dict, t: dict) -> tuple[str, str, dict]:
    sid = story["_id"]
    run = story.get("approvedRunId") if story["reviewStatus"] == "approved" else story.get("latestRunId")
    in_run = lambda rows: [r for r in rows if r["storyId"] == sid and r.get("runId") == run and r["reviewStatus"] != "rejected"]
    mentions = in_run(t["mentions"])
    places = in_run(t["places"])
    segments = sorted((s for s in t["transcriptSegments"] if s["storyId"] == sid), key=lambda s: s["idx"])
    names = {r["label"]: r["name"] for r in t["speakerNames"] if r["storyId"] == sid}
    confirmed = any(r["source"] == "editor" for r in t["speakerNames"] if r["storyId"] == sid)
    show = SHOW_NAMES.get(story["showSlug"], story["showSlug"])
    date = datetime.fromtimestamp(story["publishedAt"] / 1000, timezone.utc).strftime("%Y-%m-%d")
    words = sum(len(s["text"].split()) for s in segments)
    fields = {
        "title": story["title"], "show": show, "date": date, "type": "podcast",
        "listen": story.get("permalink") or story["audioUrl"], "cds_id": story["cdsId"],
        "duration_sec": story["durationSec"], "word_count": words,
        "review_status": story["reviewStatus"], "do_not_use": story["doNotUse"],
        "topics": [r["topic"] for r in in_run(t["storyTopics"])],
        "people": [m["name"] for m in mentions if m["entityType"] == "person"],
        "organizations": [m["name"] for m in mentions if m["entityType"] == "organization"],
        "places": [p.get("officialName") or p["name"] for p in places],
        "speaker_names": "editor-confirmed" if confirmed else "machine-suggested",
    }
    path = f"{story['showSlug']}/{date}-{slugify(story['title'])}.md"
    note = "" if confirmed else "> Speaker names are machine suggestions, not yet confirmed by an editor. Unnamed speakers stay numbered.\n\n"
    body = "\n\n".join([front_matter(fields), f"# {story['title']}", "## Show notes", story["teaserText"] or "_None._",
                        "## Transcript", note + "\n\n".join(paragraphs(segments, names))])
    return path, body + "\n", {"file": path, **{k: fields[k] for k in ("show", "title", "date", "cds_id", "listen", "word_count", "review_status", "topics")}}


README = """# Radio Milwaukee Backstory archive (internal)

Transcripts and show notes for Radio Milwaukee podcasts, one Markdown file per episode, generated from Backstory.
`index.json` lists every episode (`schema_version` marks format changes).

**Internal to Radio Milwaukee staff. Do not redistribute.** Transcripts include private individuals: program
participants, students and residents. Machine transcription misspells names; the show notes have the correct
spellings. Episodes with `review_status: pending` have not been reviewed by an editor; `do_not_use: true`
marks stories editors flagged as sensitive.

Regenerate with `python3 scripts/export_archive.py <this folder>` in the Backstory repo.
"""


def export(out_dir: str) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        t = load_tables(tmp)
    transcribed = {s["storyId"] for s in t["transcriptSegments"]}
    entries = []
    for story in sorted(t["stories"], key=lambda s: s["publishedAt"], reverse=True):
        if story["_id"] not in transcribed:
            continue
        path, body, entry = episode(story, t)
        os.makedirs(os.path.join(out_dir, os.path.dirname(path)), exist_ok=True)
        with open(os.path.join(out_dir, path), "w") as f:
            f.write(body)
        entries.append(entry)
    index = {"schema_version": SCHEMA_VERSION, "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
             "episodes": entries}
    with open(os.path.join(out_dir, "index.json"), "w") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)
    with open(os.path.join(out_dir, "README.md"), "w") as f:
        f.write(README)
    print(f"exported {len(entries)} episodes to {out_dir}")


def check() -> None:
    assert slugify("Café Corazón & turkey talk!") == "cafe-corazon-turkey-talk"
    assert timestamp(3_723_000) == "01:02:03"
    segs = [{"speaker": "spk_0", "startMs": 0, "text": "Hi."}, {"speaker": "spk_0", "startMs": 900, "text": "Welcome."},
            {"speaker": "spk_1", "startMs": 2000, "text": "Thanks."}]
    assert paragraphs(segs, {"spk_0": "Tarik Moody"}) == ["**Tarik Moody** (00:00:00):\nHi. Welcome.", "**Speaker 2** (00:00:02):\nThanks."]
    assert front_matter({"title": 'A "quoted" title', "topics": ["food-drink"]}) == '---\ntitle: "A \\"quoted\\" title"\ntopics: ["food-drink"]\n---'
    print("export self-check passed")


if __name__ == "__main__":
    if "--check" in sys.argv:
        check()
    else:
        export(sys.argv[1] if len(sys.argv) > 1 else "../radiomke-backstory-archive")
