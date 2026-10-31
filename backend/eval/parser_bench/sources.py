"""The benchmark's source decks, the page-selection rule, and PDF helpers."""
from __future__ import annotations

import hashlib
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

from backend.eval.decks import DECK_DIR

PageRef = tuple[str, int]  # (file name relative to DECK_DIR, 1-based page)


@dataclass(frozen=True)
class Source:
    id: str
    label: str
    files: tuple[str, ...]  # relative to DECK_DIR; some names start with a space on purpose

    def paths(self, deck_dir: Path = DECK_DIR) -> tuple[Path, ...]:
        return tuple(deck_dir / f for f in self.files)


# Spec "Test set". Softwaretechnik 1 is excluded: Abi saw its outputs with
# tool names in the 2026-10-30 design demo, so it is no longer blind.
BENCHMARK_SOURCES = (
    Source("swt", "Softwaretechnik 2 — Versionsmanagement", ("Course SWT/Slides/2.pdf",)),
    Source("dbs", "DBS Normalization", ("03 DBS Normalization.pdf",)),
    Source("sr", "SR Prozesse", (" 03__SR_Prozesse_v07_27.04.2025.pdf",)),
    Source("sheets", "SWT exercise sheets 1–2", ("Course SWT/ueb01.pdf", "Course SWT/ueb02.pdf")),
)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def page_count(path: Path) -> int:
    import fitz

    with fitz.open(path) as doc:
        return len(doc)


def two_page_sample(path: Path, dest: Path) -> Path:
    """The warm-up input: the first two pages, so a model download is never timed."""
    import fitz

    with fitz.open(path) as doc, fitz.open() as out:
        out.insert_pdf(doc, from_page=0, to_page=min(1, len(doc) - 1))
        out.save(dest)
    return dest


def render_png(path: Path, page: int, zoom: float = 1.4) -> bytes:
    import fitz

    with fitz.open(path) as doc:
        if not 1 <= page <= len(doc):  # doc[-1] would quietly be the last page
            raise ValueError(f"page {page} is outside 1–{len(doc)}")
        return doc[page - 1].get_pixmap(matrix=fitz.Matrix(zoom, zoom)).tobytes("png")


def candidates_of(source: Source, deck_dir: Path = DECK_DIR) -> list[PageRef]:
    return [
        (name, n)
        for name, path in zip(source.files, source.paths(deck_dir))
        for n in range(1, page_count(path) + 1)
    ]


def select_pages(candidates: Sequence[PageRef], chosen: Sequence[PageRef], n_random: int, seed: int) -> list[PageRef]:
    """Spec selection rule: the deliberately chosen pages first, then n_random
    drawn from the rest with a recorded seed. Same inputs, same pages."""
    missing = [c for c in chosen if c not in candidates]
    if missing:
        raise ValueError(f"chosen pages not in this source: {missing}")
    taken = set(chosen)
    rest = sorted(c for c in candidates if c not in taken)
    if n_random > len(rest):
        raise ValueError(f"only {len(rest)} pages left to draw {n_random} from")
    return list(chosen) + sorted(random.Random(seed).sample(rest, n_random))
