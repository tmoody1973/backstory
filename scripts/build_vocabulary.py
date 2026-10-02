"""Build the Amazon Transcribe custom vocabulary from names we know are spelled right.

    python3 scripts/build_vocabulary.py          # write docs/transcribe-vocabulary.tsv
    python3 scripts/build_vocabulary.py --check  # run the self-check

Sources: show hosts, plus the people, places and organizations in the labeled answer key
(human spot-checked spellings). Add names by hand to docs/transcribe-vocabulary-extra.txt,
one per line. Format rules: https://docs.aws.amazon.com/transcribe/latest/dg/custom-vocabulary-create-table.html
"""

import json
import os
import re
import sys
import unicodedata

OUT = "docs/transcribe-vocabulary.tsv"
EXTRA = "docs/transcribe-vocabulary-extra.txt"
HOSTS = ["Tarik Moody", "Ann Christenson", "Kim Shine", "Radio Milwaukee", "This Bites", "Uniquely Milwaukee"]
TYPES = {"person", "place", "organization"}
MAX_BYTES = 50_000  # Transcribe's limit for a vocabulary file


def phrase(name: str) -> str | None:
    """Transcribe's Phrase column: ASCII letters and apostrophes, words joined by hyphens, no digits."""
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    text = text.replace("&", " and ").replace("’", "'")
    if re.search(r"\d", text):
        return None  # ponytail: names with digits ("3rd Street Market Hall") are skipped; spell them out by hand in the extra file
    words = [w.strip("'") for w in re.split(r"[^A-Za-z']+", text)]
    words = [re.sub(r"'{2,}", "'", w) for w in words if w]
    return "-".join(words) or None


def rows(names: list[str]) -> list[tuple[str, str]]:
    seen, out = set(), []
    for name in names:
        name = name.strip()
        p = phrase(name) if name else None
        if not p or p.lower() in seen:
            continue
        seen.add(p.lower())
        out.append((p, name if name != p.replace("-", " ") else ""))
    return out


def extra_entries(lines: list[str]) -> tuple[list[str], list[tuple[str, str]]]:
    """Hand-edited names. "Misheard => Correct" lines teach Transcribe to write what it hears as the correct spelling."""
    names, mappings = [], []
    for line in (raw.strip() for raw in lines):
        if not line or line.startswith("#"):
            continue
        if "=>" in line:
            heard, correct = (part.strip() for part in line.split("=>", 1))
            if phrase(heard):
                mappings.append((phrase(heard), correct))
            names.append(correct)
        else:
            names.append(line)
    return names, mappings


def table(entries: list[tuple[str, str]]) -> str:
    return "Phrase\tSoundsLike\tIPA\tDisplayAs\n" + "".join(f"{p}\t\t\t{d}\n" for p, d in entries)


def build() -> None:
    names = list(HOSTS)
    labels = json.load(open("docs/eval/answer-key.json"))["labels"]
    names += [label["value"] for label in labels if label["label_type"] in TYPES]
    mappings: list[tuple[str, str]] = []
    if os.path.exists(EXTRA):
        extra, mappings = extra_entries(open(EXTRA).read().splitlines())
        names += extra
    mapped = {heard.lower() for heard, _ in mappings}
    text = table(mappings + [row for row in rows(names) if row[0].lower() not in mapped])
    assert len(text.encode()) <= MAX_BYTES, f"vocabulary is {len(text.encode())} bytes; Transcribe allows {MAX_BYTES}"
    with open(OUT, "w") as f:
        f.write(text)
    print(f"wrote {OUT}: {text.count(chr(10)) - 1} entries, {len(text.encode())} bytes")


def check() -> None:
    assert phrase("Lupi & Iris") == "Lupi-and-Iris"
    assert phrase("Immy's African Cuisine") == "Immy's-African-Cuisine"
    assert phrase("Café Corazón") == "Cafe-Corazon"
    assert phrase("Mr. Dye's Pies") == "Mr-Dye's-Pies"
    assert phrase("3rd Street Market Hall") is None
    assert phrase("Summer of ’85") is None
    assert rows(["Ann Christenson", "Lupi & Iris", "lupi and iris"]) == [("Ann-Christenson", ""), ("Lupi-and-Iris", "Lupi & Iris")]
    assert table([("Lupi-and-Iris", "Lupi & Iris")]) == "Phrase\tSoundsLike\tIPA\tDisplayAs\nLupi-and-Iris\t\t\tLupi & Iris\n"
    assert extra_entries(["# comment", "Cocina Filipina", "Tariq Moody => Tarik Moody"]) == (
        ["Cocina Filipina", "Tarik Moody"], [("Tariq-Moody", "Tarik Moody")])
    print("vocabulary self-check passed")


if __name__ == "__main__":
    check() if "--check" in sys.argv else build()
