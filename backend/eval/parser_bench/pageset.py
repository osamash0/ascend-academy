"""The frozen benchmark page set (spec "Test set").

Per source, 4 pages chosen on purpose (each with a page type and a written reason) and 2 drawn at
random from the rest with a recorded seed. The set is the file
docs/thesis/experiments/parser-benchmark/pages.json, committed with PROTOCOL.md before any
benchmark run. It holds file names, page numbers, types and reasons: never slide text.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

from backend.eval.decks import DECK_DIR
from backend.eval.parser_bench import checks
from backend.eval.parser_bench.sources import BENCHMARK_SOURCES, candidates_of, select_pages, sha256_file
from backend.eval.parser_bench.store import REPO

PAGESET = REPO / "docs" / "thesis" / "experiments" / "parser-benchmark" / "pages.json"
PAGE_TYPES = ("layout", "lists", "table_formula", "diagram", "dense_text")
CHOSEN, RANDOM = 4, 2


@dataclass(frozen=True)
class BenchPage:
    key: str      # "swt-p12", "sheets2-p3": unique, safe in a URL
    source: str   # sources.Source.id
    file: str     # relative to DECK_DIR
    sha256: str
    page: int     # 1-based
    type: str     # one of PAGE_TYPES
    how: str      # "chosen" | "random"
    reason: str


def _key(source_id: str, files: Sequence[str], file: str, page: int) -> str:
    number = "" if len(files) == 1 else str(files.index(file) + 1)
    return f"{source_id}{number}-p{page}"


def validate(pages: Sequence[BenchPage]) -> list[str]:
    """Everything wrong with a page set, in words; empty when it follows the selection rule."""
    problems: list[str] = []
    keys = [p.key for p in pages]
    for key in sorted({k for k in keys if keys.count(k) > 1}):
        problems.append(f"{key} appears twice")
    known = {s.id for s in BENCHMARK_SOURCES}
    for p in pages:
        if p.source not in known:
            problems.append(f"{p.key}: unknown source {p.source!r}")
        if p.type not in PAGE_TYPES:
            problems.append(f"{p.key}: page type {p.type!r} is not one of {', '.join(PAGE_TYPES)}")
        if p.how not in ("chosen", "random"):
            problems.append(f"{p.key}: 'how' must be chosen or random")
        if p.how == "chosen" and not p.reason.strip():
            problems.append(f"{p.key}: a chosen page needs its reason")
    for source in BENCHMARK_SOURCES:
        mine = [p for p in pages if p.source == source.id]
        chosen = sum(p.how == "chosen" for p in mine)
        drawn = sum(p.how == "random" for p in mine)
        if (chosen, drawn) != (CHOSEN, RANDOM):
            problems.append(f"{source.id}: {chosen} chosen and {drawn} random pages, need {CHOSEN} and {RANDOM}")
    return problems


def load(path: Path = PAGESET) -> list[BenchPage]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    pages = [BenchPage(**p) for p in data["pages"]]
    problems = validate(pages)
    if problems:
        raise ValueError("the page set breaks the selection rule: " + "; ".join(problems))
    return pages


def load_or_empty(path: Path = PAGESET) -> list[BenchPage]:
    """The page set, or no pages before the protocol step has written it."""
    return load(path) if Path(path).exists() else []


def seed_of(path: Path = PAGESET) -> int:
    return int(json.loads(Path(path).read_text(encoding="utf-8"))["seed"])


def pages_for(sha256: str, pages: Sequence[BenchPage]) -> list[int]:
    """The benchmark pages of one PDF, by its SHA-256; empty when the file is not in the set."""
    return sorted(p.page for p in pages if p.sha256 == sha256)


def draw(chosen: Mapping[str, Sequence[Mapping[str, Any]]], seed: int, deck_dir: Path = DECK_DIR) -> dict[str, Any]:
    """The pages.json content: per source the 4 chosen pages ({file, page, type, reason}), then 2
    drawn from the rest with `seed`. Drawn pages carry type None until someone looks at them and
    tags them; load() refuses the set until every page has a type."""
    out: list[dict[str, Any]] = []
    for source in BENCHMARK_SOURCES:
        picks = list(chosen.get(source.id, []))
        if len(picks) != CHOSEN:
            raise ValueError(f"{source.id}: {len(picks)} chosen pages, need {CHOSEN}")
        refs = [(str(p["file"]), int(p["page"])) for p in picks]
        if len(set(refs)) != len(refs):
            raise ValueError(f"{source.id}: a chosen page appears twice")
        for p in picks:
            if p["type"] not in PAGE_TYPES:
                raise ValueError(f"{source.id} page {p['page']}: type {p['type']!r} is not one of {', '.join(PAGE_TYPES)}")
            if not str(p.get("reason", "")).strip():
                raise ValueError(f"{source.id} page {p['page']}: a chosen page needs its reason")
        selected = select_pages(candidates_of(source, deck_dir), refs, RANDOM, seed)
        shas = {f: sha256_file(path) for f, path in zip(source.files, source.paths(deck_dir))}
        by_ref = dict(zip(refs, picks))
        for file, page in selected:
            pick = by_ref.get((file, page))
            out.append({
                "key": _key(source.id, source.files, file, page),
                "source": source.id,
                "file": file,
                "sha256": shas[file],
                "page": page,
                "type": pick["type"] if pick else None,
                "how": "chosen" if pick else "random",
                "reason": str(pick["reason"]) if pick else f"random draw, seed {seed}",
            })
    return {"seed": seed, "pages": out}


def write(data: Mapping[str, Any], path: Path = PAGESET) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def as_entry(page: BenchPage) -> dict[str, Any]:
    """A page as a comparison records it (compare.json): everything but the reason."""
    entry = asdict(page)
    entry.pop("reason")
    return entry


def describe(pdf: Path) -> list[dict[str, Any]]:
    """Per page: its title and structure, to help choose pages. Printed locally, never committed."""
    import fitz

    facts = checks.document_facts(pdf)
    rows = []
    with fitz.open(pdf) as doc:
        for number, page in enumerate(doc, start=1):
            pf = facts.pages[number]
            rows.append({
                "page": number,
                "title": checks.title_of(pf) or "",
                "lines": len(pf.lines),
                "words": len(page.get_text("words")),
                "images": len(page.get_images()),
                "drawings": len(page.get_drawings()),
                "symbol_font": bool(pf.symbol_chars),
            })
    return rows
