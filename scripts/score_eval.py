"""Score model output against the labeled answer key.

    python3 scripts/score_eval.py            # print the score table
    python3 scripts/score_eval.py --check    # run the matcher self-check

Precision: of what the model said, how much the answer key accepts.
Recall:    of what the answer key holds, how much the model found.
"""

import json
import re
import sys
import unicodedata
from collections import defaultdict

EVAL = "docs/eval"
BLIND = {"E13", "E14", "E15", "E17", "E20"}
TYPES = ["topic", "person", "place", "organization", "action"]
FILLER = {"the", "a", "an", "and", "of", "at", "in", "on", "for", "to", "its", "milwaukee", "mke"}


def words(text: str) -> set[str]:
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    ascii_text = re.sub(r"['’]", "", ascii_text)
    # "Out's" → "outs" → "out": treat plurals and possessives as the same word
    stem = lambda w: w[:-1] if len(w) > 3 and w.endswith("s") else w
    return {stem(w) for w in re.split(r"[^a-z0-9]+", ascii_text) if w and w not in FILLER}


def same(label_type: str, a: str, b: str) -> bool:
    """Exact for topics; otherwise one name's words contain the other's, or they overlap enough."""
    if label_type == "topic":
        return a == b
    wa, wb = words(a), words(b)
    if not wa or not wb:
        return False
    if wa <= wb or wb <= wa:
        return True
    # ponytail: word overlap, not semantic matching; action wording varies, so its bar is lower
    bar = 0.5 if label_type == "action" else 0.6
    return len(wa & wb) / len(wa | wb) >= bar


def score(predicted: dict, key: dict, episodes: set[str]) -> dict:
    totals = defaultdict(lambda: {"tp_pred": 0, "pred": 0, "tp_key": 0, "key": 0})
    for ep in episodes:
        for label_type in TYPES:
            pred = [p["value"] for p in predicted.get(ep, []) if p["label_type"] == label_type]
            truth = [k["value"] for k in key.get(ep, []) if k["label_type"] == label_type]
            t = totals[label_type]
            t["pred"] += len(pred)
            t["key"] += len(truth)
            t["tp_pred"] += sum(any(same(label_type, p, k) for k in truth) for p in pred)
            t["tp_key"] += sum(any(same(label_type, p, k) for p in pred) for k in truth)
    return totals


def pct(n: int, d: int) -> str:
    return f"{100 * n / d:5.1f}%" if d else "   — "


def table(name: str, totals: dict, types: list[str]) -> None:
    for label_type in types:
        t = totals[label_type]
        if t["pred"] or t["key"]:
            print(f"  {name:7} {label_type:12} precision {pct(t['tp_pred'], t['pred'])} ({t['tp_pred']}/{t['pred']})"
                  f"   recall {pct(t['tp_key'], t['key'])} ({t['tp_key']}/{t['key']})")


def check() -> None:
    assert same("place", "Summerfest grounds", "Milwaukee Summerfest Grounds")
    assert same("place", "Immy's African Cuisine", "Immys African Cuisine")
    assert not same("place", "Aya", "Ardent")
    assert not same("topic", "business", "community")
    assert same("action", "Support My Way Out", "Support My Way Out's reentry program")
    s = score({"E01": [{"label_type": "topic", "value": "food-drink"}, {"label_type": "topic", "value": "arts"}]},
              {"E01": [{"label_type": "topic", "value": "food-drink"}, {"label_type": "topic", "value": "festival"}]},
              {"E01"})["topic"]
    assert (s["tp_pred"], s["pred"], s["tp_key"], s["key"]) == (1, 2, 1, 2)
    print("matcher self-check passed")


def main() -> None:
    by_episode = lambda items: {ep: v for ep, v in items.items()}
    key = defaultdict(list)
    for label in json.load(open(f"{EVAL}/answer-key.json"))["labels"]:
        key[label["episode"]].append(label)
    haiku = by_episode(json.load(open(f"{EVAL}/haiku-output.json"))["episodes"])
    jev = by_episode(json.load(open(f"{EVAL}/jev-topics.json"))["episodes"])
    judged = by_episode(json.load(open(f"{EVAL}/haiku-jev-judge-output.json"))["episodes"])
    sonnet = by_episode(json.load(open(f"{EVAL}/sonnet-output.json"))["episodes"])
    all_eps = set(key) | set(haiku)
    for title, eps in [("ALL 20 EPISODES", all_eps), ("BLIND 5 (control)", all_eps & BLIND),
                       ("SUGGESTION 15", all_eps - BLIND)]:
        print(f"\n{title}")
        table("Haiku", score(haiku, key, eps), TYPES)
        table("Jev", score(jev, key, eps), ["topic"])
        table("H+judge", score(judged, key, eps), ["person"])
        table("Sonnet", score(sonnet, key, eps), TYPES)


if __name__ == "__main__":
    check() if "--check" in sys.argv else main()
