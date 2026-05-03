"""
Deterministic, zero-LLM slide extractor.

Used by the on-demand AI parsing mode (Task #58). Given a `PageLayout`
already produced by Pass-1 layout analysis (PyMuPDF + column reading
order), build a slide dict shaped like the AI-pipeline output but
without any LLM-derived fields:

    {
        "index":        int,
        "slide_index":  int,
        "title":        str,   # heuristic from raw text
        "content":      str,   # remaining text in reading order
        "summary":      "",    # left blank — filled on demand by AI button
        "questions":    [],    # left empty — filled on demand by AI button
        "slide_type":   "content" | "metadata",
        "is_metadata":  bool,
        "ai_enhanced":  False,
        "_meta":        {...,  "engine": "heuristic-v1", ...},
    }

The extractor never raises — failures degrade to a "Slide N" placeholder
with the raw page text as content. The on-demand path must keep the
parse pipeline successful even on totally unparseable pages so the
professor can edit them by hand.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from backend.services.layout_analyzer import (
    PageLayout,
    layout_features_dict,
)
from backend.services.slide_classifier import ROUTE_SKIP, ROUTE_TEXT, RoutingManifest

logger = logging.getLogger(__name__)

ENGINE_NAME = "heuristic-v1"

_TITLE_MAX_CHARS = 140
_TITLE_MAX_WORDS = 16
_CONTENT_MAX_CHARS = 6000


def _split_first_nonempty_line(raw_text: str) -> tuple[str, str]:
    """Return (first_nonempty_line, remaining_text).

    Reading order is preserved by the upstream layout analyzer. This just
    peels the first non-empty line off as a candidate title, leaves the
    remaining lines (including any leading blanks beyond the consumed
    line) joined with newlines as content.
    """
    if not raw_text:
        return "", ""
    lines = raw_text.splitlines()
    title = ""
    cut_idx = -1
    for idx, line in enumerate(lines):
        stripped = line.strip()
        if stripped:
            title = stripped
            cut_idx = idx
            break
    if cut_idx < 0:
        return "", raw_text
    remaining = "\n".join(lines[cut_idx + 1 :]).strip()
    return title, remaining


def _looks_like_title(line: str) -> bool:
    """Heuristic: a candidate first line is a "real" title.

    We accept it when it's reasonably short (typical slide-deck titles)
    and doesn't look like a sentence (no terminal punctuation, no more
    than ~16 words). Falls back to a generic placeholder otherwise so
    the professor sees an obviously-empty title rather than a paragraph
    awkwardly hoisted into the title field.
    """
    if not line:
        return False
    if len(line) > _TITLE_MAX_CHARS:
        return False
    if len(line.split()) > _TITLE_MAX_WORDS:
        return False
    if line.rstrip().endswith((".", "!", "?")) and len(line.split()) > 8:
        return False
    return True


def build_slide_from_layout(
    layout: PageLayout,
    filename: str,
    is_metadata: bool = False,
    manifest: Optional[RoutingManifest] = None,
) -> Dict[str, Any]:
    """Construct a slide dict deterministically from a single PageLayout."""
    idx = layout.index
    raw_text = (layout.raw_text or "").strip()

    title_candidate, remaining = _split_first_nonempty_line(raw_text)
    if _looks_like_title(title_candidate):
        title = title_candidate
        content_body = remaining
    else:
        title = f"Slide {idx + 1}"
        # When the first line wasn't title-shaped, keep the full text so
        # the professor doesn't lose anything.
        content_body = raw_text

    if len(content_body) > _CONTENT_MAX_CHARS:
        content_body = content_body[:_CONTENT_MAX_CHARS].rstrip() + "…"

    slide_type = "metadata" if is_metadata else "content"

    route_label = ROUTE_SKIP if is_metadata else ROUTE_TEXT
    route_reason = (
        manifest.reasons.get(idx, "") if manifest else "deterministic_extractor"
    )

    return {
        "index": idx,
        "slide_index": idx,
        "title": title,
        "content": content_body,
        "summary": "",
        "questions": [],
        "slide_type": slide_type,
        "is_metadata": is_metadata,
        "ai_enhanced": False,
        "_meta": {
            "filename": filename,
            "page": idx + 1,
            "type": slide_type,
            "engine": ENGINE_NAME,
            "tokens": layout.word_count * 4,
            "parse_time_ms": 0,
            "column_count": layout.column_count,
            "has_math": layout.has_math,
            "has_code": layout.has_code_block,
            "route": route_label,
            "route_reason": route_reason,
            "layout_features": layout_features_dict(layout),
            "parsing_mode": "on_demand",
        },
    }


def build_slides_from_layouts(
    layouts: Dict[int, PageLayout],
    filename: str,
    metadata_flags: Optional[Dict[int, bool]] = None,
    manifest: Optional[RoutingManifest] = None,
) -> List[Dict[str, Any]]:
    """Bulk variant — builds slides for every page in `layouts`."""
    metadata_flags = metadata_flags or {}
    out: List[Dict[str, Any]] = []
    for idx in sorted(layouts):
        try:
            slide = build_slide_from_layout(
                layouts[idx],
                filename=filename,
                is_metadata=bool(metadata_flags.get(idx, False)),
                manifest=manifest,
            )
        except Exception as e:  # pragma: no cover — defensive
            logger.error("Deterministic extractor failed for slide %d: %s", idx, e)
            slide = {
                "index": idx,
                "slide_index": idx,
                "title": f"Slide {idx + 1}",
                "content": "",
                "summary": "",
                "questions": [],
                "slide_type": "content",
                "is_metadata": False,
                "ai_enhanced": False,
                "_meta": {
                    "filename": filename,
                    "page": idx + 1,
                    "type": "content",
                    "engine": ENGINE_NAME,
                    "tokens": 0,
                    "parse_time_ms": 0,
                    "parsing_mode": "on_demand",
                },
            }
        out.append(slide)
    return out
