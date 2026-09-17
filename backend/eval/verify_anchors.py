# -*- coding: utf-8 -*-
"""Verify every golden-set anchor really occurs in its slide.

An anchor that is not a substring of the slide it points at scores 0 on
`anchor_found` for reasons that have nothing to do with retrieval — a silent
floor on one of the reported metrics. Checking is cheap and catches typos,
paraphrases written from memory, and text taken from the wrong slide.

Uses the SAME normalisation as the grid (`anchor_found`: case- and
whitespace-insensitive), so a pass here means a pass there.

Usage:
    python -m backend.eval.verify_anchors --golden backend/eval/data/golden_set.json

By default it re-reads each slide from the database, which is the real check.
Pass --previews <file.json> (keys "<lecture_id>:<slide_index>") to verify
against stored preview text instead, without a database.
"""
import json, sys
sys.path.insert(0, '.')
from backend.eval.retrieval_grid import anchor_found, load_golden_set

import argparse

ap = argparse.ArgumentParser(description="Verify golden-set anchors occur in their slides.")
ap.add_argument("--golden", default="backend/eval/data/golden_set.json")
ap.add_argument("--previews", default="",
                help="JSON of {'<lecture_id>:<slide_index>': 'slide text'}; "
                     "omit to read slides from the database instead")
args = ap.parse_args()

if args.previews:
    PREV = json.load(open(args.previews, encoding="utf-8"))
else:
    from backend.core.database import supabase_admin
    PREV = {}
    gs_tmp = load_golden_set(args.golden)
    for c in gs_tmp:
        # slides.slide_number is 1-based; slide_index is 0-based.
        res = (supabase_admin.table("slides")
               .select("title, content_text, summary")
               .eq("lecture_id", c.lecture_id)
               .eq("slide_number", c.slide_index + 1)
               .limit(1).execute()).data or []
        if res:
            r = res[0]
            PREV[f"{c.lecture_id}:{c.slide_index}"] = (
                f"{r.get('title') or ''} {r.get('content_text') or r.get('summary') or ''}")

gs = load_golden_set(args.golden)
bad = []
for c in gs:
    key = f"{c.lecture_id}:{c.slide_index}"
    prev = PREV.get(key)
    if prev is None:
        bad.append((c.id, "NO PREVIEW ON FILE")); continue
    if not anchor_found([prev], c.anchor):
        bad.append((c.id, f"ANCHOR NOT IN PREVIEW: {c.anchor!r}"))

print(f"checked {len(gs)} questions")
if bad:
    print(f"\n{len(bad)} PROBLEM(S):")
    for i, m in bad: print(f"  {i}: {m}")
    sys.exit(1)
print("every anchor verified verbatim against its slide preview")
