"""Offline check of the parse's routing rule (page_blocks.route_page) over the
Deck Lab decks: how many pages go to vision, and why. No AI calls, no network.

  python -m backend.eval.routing_check                 # decks in ~/Downloads
  python -m backend.eval.routing_check --labels FILE   # also: labelled pages caught

Exits 1 when the vision count leaves the expected range, so a change to
page_blocks that quietly moves many pages shows up before a deploy. Prints
counts and page numbers only, never slide text.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from backend.eval.decks import DECK_DIR, discover_decks
from backend.services.parser.page_blocks import extract_blocks, route_page

# 25 decks, 1,593 pages on main @ e4505583 (2026-11-05): 12 no_text + 75 figure.
VISION_MIN = 75
VISION_MAX = 100


@dataclass
class RoutingCount:
    decks: int
    pages: int
    by_reason: dict
    vision_pages: set = field(default_factory=set)  # (deck, 1-based page)

    @property
    def vision(self) -> int:
        return self.by_reason.get("no_text", 0) + self.by_reason.get("figure", 0)

    def within(self, lo: int, hi: int) -> bool:
        return lo <= self.vision <= hi


def count_routes(deck_dir: Path | None = None) -> RoutingCount:
    import fitz

    root = deck_dir if deck_dir is not None else DECK_DIR
    names = discover_decks(root)
    reasons: Counter = Counter()
    vision_pages = set()
    pages = 0
    for name in names:
        with fitz.open(root / name) as doc:
            for i, page in enumerate(doc):
                reason = route_page(extract_blocks(page, i + 1))
                reasons[reason] += 1
                pages += 1
                if reason != "text":
                    vision_pages.add((name.strip(), i + 1))
    return RoutingCount(decks=len(names), pages=pages, by_reason=dict(reasons), vision_pages=vision_pages)


def labelled_vision_pages(count: RoutingCount, labels: dict) -> tuple[int, int]:
    """(pages labelled "needs the image" that go to vision, pages so labelled).
    Label ids are "<deck>#p<page>", as the 2026-11-05 labelling page wrote them."""
    wanted = set()
    for item in labels.get("labels", []):
        if item.get("label") == "image":
            deck, page = item["id"].rsplit("#p", 1)
            wanted.add((deck.strip(), int(page)))
    return len(wanted & count.vision_pages), len(wanted)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--dir", type=Path, default=None, help="deck folder (default $DECK_LAB_DIR or ~/Downloads)")
    p.add_argument("--min", type=int, default=VISION_MIN)
    p.add_argument("--max", type=int, default=VISION_MAX)
    p.add_argument("--labels", type=Path, default=None, help="labels JSON from the labelling page")
    args = p.parse_args(argv)

    c = count_routes(args.dir)
    if not c.decks:
        print("no decks found")
        return 1
    print(f"{c.decks} decks, {c.pages} pages")
    for reason in ("no_text", "figure", "text"):
        print(f"  {reason:8} {c.by_reason.get(reason, 0)}")
    print(f"  vision   {c.vision} (expected {args.min}..{args.max})")
    if args.labels:
        caught, total = labelled_vision_pages(c, json.loads(args.labels.read_text()))
        print(f"  labelled 'needs the image' sent to vision: {caught}/{total}")
    return 0 if c.within(args.min, args.max) else 1


if __name__ == "__main__":
    sys.exit(main())
