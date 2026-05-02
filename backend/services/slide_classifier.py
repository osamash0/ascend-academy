"""
Slide routing — maps a PageLayout to exactly one processing Route.

Every slide gets one route; there is no MIXED ambiguity.  The routing
priority is designed so each rule is mutually exclusive:

    SKIP > TABLE_ODL > TABLE_LLM > MATH_OVERRIDE(TEXT) > VISION > TEXT

The math override prevents equation-heavy slides (low alpha_ratio but
valid text) from being incorrectly sent to the vision pipeline.

When vision is unavailable (Ollama-only mode), VISION and TABLE_LLM
routes fall back to TEXT; the file_parse_service will gate OCR via
OCRFallback.is_needed() for those slides.

Each call to ``classify_page`` returns the chosen ``Route`` AND a short
rule label describing which branch fired — that label is the single
source of truth for ``_meta.route_reason`` recorded on every slide.
"""
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Tuple

from backend.services.layout_analyzer import PageLayout


class Route(Enum):
    TEXT      = "text"       # LLM batch text analysis
    VISION    = "vision"     # VLM image analysis (diagram / scanned)
    TABLE_LLM = "table_llm"  # VLM with TABLE_VISION_PROMPT (no ODL table data)
    TABLE_ODL = "table_odl"  # ODL markdown available → text batch, no vision call
    SKIP      = "skip"       # Metadata / blank → yield immediately, no LLM


# Stable string identifiers persisted to slide_parse_cache as `_meta.route`.
# Vision route is split into "diagram" vs "generic" purely for telemetry
# purposes (drawing-heavy vs image-heavy); processing is identical.
ROUTE_TEXT          = "text"
ROUTE_VISION_DIAGRAM = "vision_diagram"
ROUTE_VISION_GENERIC = "vision_generic"
ROUTE_TABLE_LLM     = "table_llm"
ROUTE_TABLE_ODL     = "table_odl"
ROUTE_SKIP          = "skip"


@dataclass
class RoutingManifest:
    """
    Routing decisions for an entire document.

    text_indices includes both TEXT and TABLE_ODL slides; TABLE_ODL slides
    have their odl_table_md injected as the text payload before batching.

    ``reasons`` maps slide_index → the short rule label returned by
    classify_page, e.g. ``"image_coverage_high"`` or ``"odl_table_md"``.
    ``route_labels`` maps slide_index → the persisted route string (one of
    ROUTE_*).  Both are optional from the consumer's perspective but are
    populated by build_routing_manifest for downstream telemetry.
    """
    text_indices:      List[int] = field(default_factory=list)
    vision_indices:    List[int] = field(default_factory=list)
    table_llm_indices: List[int] = field(default_factory=list)
    skip_indices:      List[int] = field(default_factory=list)
    odl_table_indices: List[int] = field(default_factory=list)  # subset of text_indices
    layouts:           Dict[int, PageLayout] = field(default_factory=dict)
    reasons:           Dict[int, str] = field(default_factory=dict)
    route_labels:      Dict[int, str] = field(default_factory=dict)


_VISION_MODELS = frozenset({"groq", "gemini-2.0-flash"})


def classify_page(
    layout: PageLayout,
    is_metadata: bool,
    vision_available: bool,
) -> Tuple[Route, str]:
    """
    Deterministic route for a single slide.

    Rules (applied in priority order, first match wins):

    1. SKIP  — blank page: word_count < 5 AND image_coverage < 0.15 AND drawing_count < 5
    2. SKIP  — is_metadata flag set by content_filter
    3. TABLE_ODL — ODL provided reliable table markdown
    4. TABLE_LLM — PyMuPDF detected a table structure (no ODL data)
    5. TEXT  — MATH OVERRIDE: has_math=True AND word_count >= 10
               (equations have low alpha_ratio but text extraction is valid)
    6. VISION — image_coverage >= 0.25
               OR drawing_count >= 20
               OR alpha_ratio < 0.25  (scanned / garbage, not caught by math override)
               OR (word_count < 30 AND image_coverage > 0.08)
    7. TEXT  — everything else (rich text, code, multi-column)

    If vision_available=False, VISION and TABLE_LLM degrade to TEXT.

    Returns
    -------
    (Route, str)
        The routing decision plus a short rule label identifying the
        branch that fired.  When a vision-eligible rule degrades to TEXT
        because no vision model is available, the reason is suffixed
        ``"_no_vision"`` so telemetry can distinguish a degraded TEXT
        slide from an organic one.
    """
    # 1 & 2: Skip
    if is_metadata:
        return Route.SKIP, "is_metadata"
    if (
        layout.word_count < 5
        and layout.image_coverage < 0.15
        and layout.drawing_count < 5
    ):
        return Route.SKIP, "blank_page_heuristic"

    # 3: ODL table
    if layout.odl_table_md:
        return Route.TABLE_ODL, "odl_table_md"

    # 4: PyMuPDF table (no ODL)
    if layout.has_table:
        if not vision_available:
            return Route.TEXT, "pymupdf_table_no_vision"
        return Route.TABLE_LLM, "pymupdf_table"

    # 5: Math override — keep as TEXT even if alpha_ratio is low
    if layout.has_math and layout.word_count >= 10:
        return Route.TEXT, "math_override"

    # 6: Vision signals — capture which sub-rule fired
    if layout.image_coverage >= 0.25:
        reason = "image_coverage_high"
    elif layout.drawing_count >= 20:
        reason = "drawing_count_high"
    elif layout.alpha_ratio < 0.25:
        reason = "alpha_ratio_low"
    elif layout.word_count < 30 and layout.image_coverage > 0.08:
        reason = "image_with_sparse_text"
    else:
        reason = ""

    if reason:
        if not vision_available:
            return Route.TEXT, f"{reason}_no_vision"
        return Route.VISION, reason

    # 7: Default text path
    return Route.TEXT, "default_text"


def _vision_label(layout: PageLayout, reason: str) -> str:
    """Pick a persisted vision route label based on the firing rule.

    drawing_count_high → ``vision_diagram`` (vector diagrams),
    everything else (image-heavy, scanned, sparse-text-with-image) →
    ``vision_generic``.  This is purely a telemetry distinction; the
    pipeline runs the same vision call either way.
    """
    if reason == "drawing_count_high":
        return ROUTE_VISION_DIAGRAM
    return ROUTE_VISION_GENERIC


def route_to_label(route: Route, layout: PageLayout, reason: str) -> str:
    """Map (Route, reason) → the persisted ``_meta.route`` string."""
    if route == Route.VISION:
        return _vision_label(layout, reason)
    if route == Route.TABLE_LLM:
        return ROUTE_TABLE_LLM
    if route == Route.TABLE_ODL:
        return ROUTE_TABLE_ODL
    if route == Route.SKIP:
        return ROUTE_SKIP
    return ROUTE_TEXT


def build_routing_manifest(
    layouts: Dict[int, PageLayout],
    metadata_flags: Dict[int, bool],
    ai_model: str,
) -> RoutingManifest:
    """
    Classifies every page and builds the full routing manifest.

    TABLE_ODL pages are added to both odl_table_indices and text_indices
    so they flow through the text batch path with ODL markdown injected.
    """
    vision_available = ai_model in _VISION_MODELS
    manifest = RoutingManifest(layouts=dict(layouts))

    for idx, layout in sorted(layouts.items()):
        is_meta = metadata_flags.get(idx, False)
        route, reason = classify_page(layout, is_meta, vision_available)
        manifest.reasons[idx] = reason
        manifest.route_labels[idx] = route_to_label(route, layout, reason)

        if route == Route.SKIP:
            manifest.skip_indices.append(idx)
        elif route == Route.TABLE_ODL:
            manifest.odl_table_indices.append(idx)
            manifest.text_indices.append(idx)  # processed via text batch
        elif route == Route.TABLE_LLM:
            manifest.table_llm_indices.append(idx)
        elif route == Route.VISION:
            manifest.vision_indices.append(idx)
        else:  # TEXT
            manifest.text_indices.append(idx)

    return manifest


def vision_available_for_model(ai_model: str) -> bool:
    """Returns True if the given ai_model supports vision (image) analysis."""
    return ai_model in _VISION_MODELS
