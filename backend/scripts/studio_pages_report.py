#!/usr/bin/env python3
"""Studio geometry report over a folder of real PDFs (real-pages spec §9.5).

No AI calls: it measures what page_blocks alone gives each file, which is
the part that decides Peek and Morph quality. Usage:
  python backend/scripts/studio_pages_report.py <folder> > docs/STUDIO_PAGES_REPORT_2026_10.md
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import fitz  # noqa: E402

from backend.services.parser.page_blocks import extract_blocks, is_image_only  # noqa: E402


def measure(pdf: Path) -> tuple[int, int, int, int]:
    with fitz.open(pdf) as d:
        pages = image = blocks = footer = 0
        for i, page in enumerate(d):
            pb = extract_blocks(page, i + 1)
            pages += 1
            image += is_image_only(pb)
            blocks += len(pb["blocks"])
            footer += len(pb["footers"])
    return pages, image, blocks, footer


def main(folder: str) -> None:
    rows, tot = [], {"pages": 0, "image": 0, "blocks": 0, "footer": 0}
    ok = 0
    for pdf in sorted(Path(folder).glob("*.pdf")):
        # One unreadable file (encrypted, corrupt) must not stop the run.
        # Only the exception class is printed, never its message or the file contents.
        try:
            pages, image, blocks, footer = measure(pdf)
        except Exception as exc:  # noqa: BLE001
            rows.append((pdf.name, type(exc).__name__, None))
            continue
        ok += 1
        rows.append((pdf.name, (pages, image, blocks, footer), None))
        for k, v in zip(("pages", "image", "blocks", "footer"), (pages, image, blocks, footer)):
            tot[k] += v
    print("# Studio pages: geometry report\n")
    print("| File | Pages | Image-only (to vision) | Blocks / page | Footer blocks |")
    print("|---|---:|---:|---:|---:|")
    for name, stats, _ in rows:
        if isinstance(stats, str):
            print(f"| {name} | error | – | – | – |")
            continue
        p, im, b, f = stats
        print(f"| {name} | {p} | {im} ({im / max(p, 1):.0%}) | {b / max(p, 1):.1f} | {f} |")
    p = max(tot["pages"], 1)
    errors = len(rows) - ok
    print(f"| **All {ok} readable files** ({errors} unreadable) | {tot['pages']} | "
          f"{tot['image']} ({tot['image'] / p:.0%}) | {tot['blocks'] / p:.1f} | {tot['footer']} |")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
