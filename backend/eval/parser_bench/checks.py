"""The automatic checks (spec "Automatic checks").

The reference is the page's own text layer, read with PyMuPDF. Known bias,
stated in the protocol: that makes `current` perfect by construction on
dropped and invented words.
"""
from __future__ import annotations

import difflib
import math
import re
import statistics
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from backend.eval.parser_bench.normalize import FIGURE

SYMBOL_FONTS = ("symbol", "wingdings", "zapf", "dingbat")
MISMAPPED = ("§", "®")
BULLETS = set("§•▪◦●■□–-*®")
EDGE = 0.15          # outer share of the page height, by line centre
BOILER_SHARE = 0.5   # share of pages a boilerplate line appears on
TITLE_RATIO = 1.2    # the title is at least this much larger than the median line
TITLE_MATCH = 0.8    # similarity for "title first"
CHECKS_VERSION = 3   # bumped whenever a check's definition changes; recorded in every run.json
CHECK_FIELDS = (
    "page", "footer_leaks", "footer_leaked", "footer_token_share", "title_first", "wrong_symbols", "lonely_bullets",
    "broken_line_pct", "line_breaks", "broken_lines",
    "headings", "list_items", "max_depth", "tables", "math_spans",
    "dropped_words_pct", "invented_words_pct", "chars",
)

_PUA = re.compile("[\ue000-\uf8ff\ufffd]")
_MD_PREFIX = re.compile(r"^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)")
_HEADING = re.compile(r"^\s{0,3}#{1,6}\s")
_ITEM = re.compile(r"^(\s*)(?:[-*+]|\d+[.)])\s+")
_TABLE_SEP = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$")
_MATH = re.compile(r"\$\$.+?\$\$|(?<!\$)\$[^$\n]+\$(?!\$)|\\\(.+?\\\)", re.S)
_ENDS_SENTENCE = re.compile(r"[.:;!?]\s*$")
_DIGITS = re.compile(r"\d+")
_WORD = re.compile(r"[^\W\d_]+")
_HEADING_MARK = re.compile(r"^\s*#{1,6}\s+")


@dataclass(frozen=True)
class Line:
    text: str
    size: float
    y0: float
    y1: float


@dataclass
class PageFacts:
    number: int
    height: float
    lines: list[Line]
    median_size: float
    symbol_chars: set[str] = field(default_factory=set)
    edge_numbers: set[str] = field(default_factory=set)  # printed slide numbers: bare-digit lines at the edge


@dataclass
class DocFacts:
    pages: dict[int, PageFacts]
    boilerplate: frozenset[str]
    boilerplate_tokens: frozenset[str]


def norm_line(s: str) -> str:
    s = unicodedata.normalize("NFKC", s).casefold()
    return re.sub(r"\s+", " ", re.sub(r"\d+", "#", s)).strip()


def tokens(text: str) -> list[str]:
    s = unicodedata.normalize("NFKC", text).casefold()
    s = re.sub(r"(\w)-\n(\w)", r"\1\2", s)
    return re.findall(r"[^\W_]{2,}", s)


def _at_edge(line: Line, height: float) -> bool:
    mid = (line.y0 + line.y1) / 2
    return mid < EDGE * height or mid > (1 - EDGE) * height


def document_facts(pdf: Path) -> DocFacts:
    import fitz

    pages: dict[int, PageFacts] = {}
    seen: Counter[str] = Counter()
    with fitz.open(pdf) as doc:
        for number, page in enumerate(doc, start=1):
            height = page.rect.height
            lines: list[Line] = []
            symbol_chars: set[str] = set()
            for block in page.get_text("dict")["blocks"]:
                for raw in block.get("lines", []):
                    spans = raw["spans"]
                    for span in spans:
                        if any(f in span["font"].lower() for f in SYMBOL_FONTS):
                            symbol_chars.update(ch for ch in span["text"] if not ch.isspace())
                    text = "".join(span["text"] for span in spans).strip()
                    if text:
                        lines.append(Line(text, max(s["size"] for s in spans), raw["bbox"][1], raw["bbox"][3]))
            edge_numbers = {l.text for l in lines if _at_edge(l, height) and _DIGITS.fullmatch(l.text)}
            median = statistics.median(l.size for l in lines) if lines else 0.0
            pages[number] = PageFacts(number, height, lines, median, symbol_chars, edge_numbers)
            seen.update({norm_line(l.text) for l in lines if _at_edge(l, height)})
    need = max(2, math.ceil(BOILER_SHARE * len(pages)))
    boiler = frozenset(t for t, c in seen.items() if c >= need)
    boiler_tokens = frozenset(w for b in boiler for w in _WORD.findall(b))
    return DocFacts(pages, boiler, boiler_tokens)


def title_of(pf: PageFacts) -> str | None:
    if not pf.lines:
        return None
    best = max(pf.lines, key=lambda l: (l.size, -l.y0))
    return best.text if best.size >= TITLE_RATIO * pf.median_size else None


def strip_md(line: str) -> str:
    s = line
    while (t := _MD_PREFIX.sub("", s, count=1)) != s:
        s = t
    return re.sub(r"[*_`]", "", s).strip().strip("|").strip()


def _heading_text(line: str) -> str:
    """Only heading marks and emphasis characters are stripped (spec: "heading marks stripped")."""
    return re.sub(r"[*_`]", "", _HEADING_MARK.sub("", line, count=1)).strip()


def footer_tokens(line: str) -> frozenset[str]:
    """A line as is_footer_line reads it: its case-folded words plus its numbers."""
    folded = unicodedata.normalize("NFKC", strip_md(line)).casefold()
    return frozenset(_WORD.findall(folded) + _DIGITS.findall(folded))


def is_footer_line(line: str, pf: PageFacts, doc: DocFacts) -> bool:
    """One predicate for both sides: the output is judged with the same rule that cleans the reference."""
    s = strip_md(line)
    if not s:
        return False
    if s in pf.edge_numbers:
        return True
    if re.search(r"[^\W\d_]", s) and norm_line(s) in doc.boilerplate:
        return True
    folded = unicodedata.normalize("NFKC", s).casefold()
    words = _WORD.findall(folded)
    numbers = _DIGITS.findall(folded)
    leftover = re.sub(r"[^\W_]+|\s+", "", folded)
    return (
        bool(words)
        and set(words) <= doc.boilerplate_tokens
        and all(n in pf.edge_numbers for n in numbers)
        and not leftover
    )


def footer_line_numbers(text: str, pf: PageFacts, doc: DocFacts) -> list[int]:
    """0-based numbers of the output lines the footer rule removes; the viewer marks them as junk."""
    return [i for i, line in enumerate(text.splitlines()) if is_footer_line(line, pf, doc)]


def _is_footer_part(l: Line, pf: PageFacts, doc: DocFacts) -> bool:
    return _at_edge(l, pf.height) and is_footer_line(l.text, pf, doc)


def footer_parts(pf: PageFacts, doc: DocFacts) -> set[frozenset[str]]:
    """The page's own footer, one token set per edge line the footer rule removes from the reference."""
    return {t for l in pf.lines if _is_footer_part(l, pf, doc) and (t := footer_tokens(l.text))}


def _ref_text(pf: PageFacts, doc: DocFacts) -> str:
    return "\n".join(l.text for l in pf.lines if not _is_footer_part(l, pf, doc))


def check_page(text: str, pf: PageFacts, doc: DocFacts) -> dict:
    lines = text.splitlines()
    line_is_footer = [is_footer_line(l, pf, doc) for l in lines]
    kept_idx = [i for i, l in enumerate(lines) if l.strip() and l.strip() != FIGURE]
    content = [lines[i] for i in kept_idx]
    footer = [line_is_footer[i] for i in kept_idx]

    # A part leaks when the output's footer lines, taken together, hold every one of its words and
    # numbers: the score is the same whether a tool prints the footer on three lines, joins it on
    # one, or splits one part across two (v3). The token share shows a footer cut short.
    out_footer = frozenset().union(*(footer_tokens(l) for l, f in zip(content, footer) if f))
    parts = footer_parts(pf, doc)
    leaks = sum(1 for part in parts if part <= out_footer)
    part_tokens = frozenset().union(*parts)
    token_share = round(len(part_tokens & out_footer) / len(part_tokens), 3) if part_tokens else None

    title = title_of(pf)
    if title is None:
        title_first = None
    else:
        first = norm_line(_heading_text(content[0])) if content else ""
        want = norm_line(_heading_text(title))
        title_first = first.startswith(want) or difflib.SequenceMatcher(None, first, want).ratio() >= TITLE_MATCH

    wrong = len(_PUA.findall(text)) + sum(text.count(ch) for ch in MISMAPPED if ch in pf.symbol_chars)
    lonely = sum(1 for l in content if l.strip() in BULLETS or strip_md(l) in BULLETS)

    breaks = broken = 0
    for i, (a, b) in enumerate(zip(lines, lines[1:])):
        if not a.strip() or not b.strip() or FIGURE in (a.strip(), b.strip()):
            continue
        if line_is_footer[i] or line_is_footer[i + 1]:
            continue
        if _HEADING.match(a) or _HEADING.match(b) or _ITEM.match(a) or _ITEM.match(b) or a.lstrip().startswith("|") or b.lstrip().startswith("|"):
            continue
        breaks += 1
        head = b.lstrip()[0]
        if not _ENDS_SENTENCE.search(a) and head.isalpha() and head.islower():
            broken += 1

    items = [m for l in content if (m := _ITEM.match(l))]
    depth = len({len(m.group(1).expandtabs(4)) for m in items})

    ref = Counter(tokens(_ref_text(pf, doc)))
    kept = "\n".join(l for l, is_footer in zip(content, footer) if not is_footer)
    out = Counter(tokens(kept.replace(FIGURE, " ")))
    total_ref, total_out = sum(ref.values()), sum(out.values())
    dropped = 100 * (1 - sum((ref & out).values()) / total_ref) if total_ref else 0.0
    invented = 100 * sum((out - ref).values()) / total_out if total_out else 0.0

    return dict(zip(CHECK_FIELDS, (
        pf.number,
        leaks,
        leaks > 0,
        token_share,
        title_first,
        wrong,
        lonely,
        round(100 * broken / breaks, 1) if breaks else None,  # None: no break to judge, not "none broken"
        breaks,
        broken,
        sum(1 for l in content if _HEADING.match(l)),
        len(items),
        depth,
        sum(1 for l in lines if _TABLE_SEP.match(l)),
        len(_MATH.findall(text)),
        round(dropped, 1),
        round(invented, 1),
        len(text),
    )))
