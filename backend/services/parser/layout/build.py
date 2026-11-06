"""One page in, one Layout page out: the PDF's own text and drawings, re-set as blocks, with the server checks
that decide whether the page is offered as Layout or stays the original. No AI, no rendering of page images.
The caller holds FITZ_LOCK for the page and computes repeated_places(doc) and running_lines(doc) once per document."""
import re

from backend.services.parser.layout.chars import (dingbat_paren_arrow, fix_chars, fix_dingbat_bullets, fix_paren_bullets,
                                                  map_text, pua_map, wing_bullets)
from backend.services.parser.layout.checks import TOO_MANY_LINES, server_checks
from backend.services.parser.layout.figures import (apply_pictures, apply_regions, content_pictures, diagram_regions,
                                                    drop_blank_figures, trim_figures)
from backend.services.parser.layout.geometry import area, inter
from backend.services.parser.layout.strokes import (drop_furniture, footlines, link_labels, lost_marks, numbered_lines,
                                                    reink)
from backend.services.parser.layout.tables import apply_tables, table_grids
from backend.services.parser.page_blocks import extract_blocks

LAYOUT_VERSION = 1
KEEP = ("id", "kind", "bbox", "text", "rows", "colW", "linked", "picture", "diagram")
TABLE_SHARE = 0.5        # a diagram region this much inside a table is that table
# Control characters PostgreSQL's jsonb refuses (a NUL) or a reader must never see. Removed from everything stored,
# after the checks have seen them (so the page is held: "broken characters").
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _scrub(s):
    return _CONTROL.sub("", s) if isinstance(s, str) else s


def _stored(b):
    out = {k: b[k] for k in KEEP if k in b}
    out["text"] = _scrub(out.get("text", ""))
    if "rows" in out:
        out["rows"] = [[_scrub(c) for c in r] for r in out["rows"]]
    return out


def _set(text, m, paren, wing):
    text = fix_dingbat_bullets(map_text(text, m), m)
    if paren:
        text = fix_paren_bullets(text)
    return fix_chars(text, wing)


def build_page_layout(page, n, repeated, running=frozenset()):
    """The Layout page of PDF page n (1-based): {"page", "verdict", "reasons", "blocks", "paths", "version"}.
    running: strokes.running_lines(doc). Without it no line counts as a running header or footer: footers stay
    as type, and a band line in no block is a missing word (never a silently lost line)."""
    pb = extract_blocks(page, n)
    blocks = pb["blocks"]
    dropped = drop_furniture(blocks, pb["footers"], n, running, footlines(page, n))
    m, wing, paren = pua_map(page), wing_bullets(page), dingbat_paren_arrow(page)
    for b in blocks:                                       # symbol-font characters, ligatures, accents, bullets
        b["text"] = _set(b.get("text", ""), m, paren, wing)
        if numbered_lines(b["text"]):
            b["kind"] = "paragraph"                        # an algorithm's line numbers: kept as text, line by line
    grids = table_grids(page, m)
    apply_tables(n, blocks, grids)
    for b in blocks:
        if b["kind"] == "table":
            b["rows"] = [[_set(c, {}, False, wing) for c in r] for r in b["rows"]]
            b["text"] = "\n".join(" | ".join(r) for r in b["rows"])
    regions = [r for r in diagram_regions(page)
               if not any(area(inter(r["bbox"], g["bbox"])) >= TABLE_SHARE * area(r["bbox"]) for g in grids)]
    apply_regions(n, blocks, regions)
    trim_figures(blocks)
    pics = content_pictures(page, repeated)
    apply_pictures(n, blocks, pics)
    drop_blank_figures(page, blocks, [b["bbox"] for b in blocks if b.get("picture")])
    keep_out = [g["bbox"] for g in grids] + [b["bbox"] for b in blocks if b["kind"] == "figure"]
    texts = [(b["bbox"], len(b["text"]), b["kind"]) for b in blocks if b.get("text") and b["kind"] not in ("figure", "table")]
    paths, diagrams = reink(page, keep_out, texts)
    link_labels(blocks, paths)
    reasons = server_checks(page, blocks, pics, diagrams, paths, dropped, marks=lost_marks(page, keep_out, texts, paths),
                            pua=m, running=running)
    blocks.sort(key=lambda b: b.get("readingOrder", 999))
    if TOO_MANY_LINES in reasons:
        paths = []                                     # held, never drawn: not stored either
    return {"page": n, "verdict": "original" if reasons else "layout", "reasons": [_scrub(r) for r in reasons],
            "blocks": [_stored(b) for b in blocks], "paths": paths, "version": LAYOUT_VERSION}
