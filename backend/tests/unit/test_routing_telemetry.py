"""Unit tests for routing telemetry helpers.

Covers:
  * classify_page now returns (Route, reason_label) tuples with the
    documented label set.
  * build_routing_manifest populates `reasons` and `route_labels` for
    every page.
  * layout_features_dict returns a JSON-safe shape.
  * _enrich_result / _make_skip_slide / _backfill_route_meta stamp the
    expected `_meta` fields.
  * diagnostics.flag_suspicious applies both heuristic rules.
"""
from __future__ import annotations

from backend.services.layout_analyzer import PageLayout, layout_features_dict
from backend.services.slide_classifier import (
    Route,
    build_routing_manifest,
    classify_page,
    route_to_label,
)
from backend.services.file_parse_service import (
    _backfill_route_meta,
    _enrich_result,
    _make_skip_slide,
)
from backend.services.diagnostics import flag_suspicious


def _layout(**kw) -> PageLayout:
    defaults = dict(
        index=0,
        page_number=1,
        word_count=100,
        alpha_ratio=0.9,
        image_coverage=0.0,
        drawing_count=0,
        has_table=False,
        column_count=1,
        has_code_block=False,
        has_math=False,
        raw_text="quick brown fox",
        odl_table_md="",
    )
    defaults.update(kw)
    return PageLayout(**defaults)


# ── classify_page returns (Route, label) ────────────────────────────────────

def test_classify_page_returns_tuple_with_label():
    layout = _layout(word_count=200)
    route, reason = classify_page(layout, is_metadata=False, vision_available=True)
    assert route == Route.TEXT
    assert isinstance(reason, str) and reason  # non-empty label


def test_classify_page_metadata_label():
    layout = _layout(word_count=200)
    _, reason = classify_page(layout, is_metadata=True, vision_available=True)
    assert reason == "is_metadata"


def test_classify_page_blank_label():
    layout = _layout(word_count=2, raw_text="hi")
    _, reason = classify_page(layout, is_metadata=False, vision_available=True)
    assert reason == "blank_page_heuristic"


def test_classify_page_odl_table_label():
    layout = _layout(odl_table_md="| a |\n| - |")
    _, reason = classify_page(layout, is_metadata=False, vision_available=True)
    assert reason == "odl_table_md"


def test_classify_page_pymupdf_table_label():
    layout = _layout(has_table=True)
    _, reason = classify_page(layout, is_metadata=False, vision_available=True)
    assert reason == "pymupdf_table"


def test_classify_page_math_override_label():
    layout = _layout(word_count=50, alpha_ratio=0.10, has_math=True)
    _, reason = classify_page(layout, is_metadata=False, vision_available=True)
    assert reason == "math_override"


def test_classify_page_vision_label_carries_no_vision_suffix_when_degraded():
    layout = _layout(image_coverage=0.40, word_count=80)
    _, reason = classify_page(layout, is_metadata=False, vision_available=False)
    # Vision rules degrade to text → label gets `_no_vision` suffix
    assert reason.endswith("_no_vision")


# ── build_routing_manifest populates reasons + route_labels ─────────────────

def test_manifest_reasons_and_labels_populated_for_every_page():
    layouts = {
        0: _layout(index=0, word_count=200),                            # TEXT
        1: _layout(index=1, image_coverage=0.40, word_count=80),        # VISION
        2: _layout(index=2, word_count=2, raw_text="hi"),               # SKIP
        3: _layout(index=3, odl_table_md="| a |\n| - |"),               # TABLE_ODL
    }
    m = build_routing_manifest(layouts, metadata_flags={}, ai_model="groq")
    assert set(m.reasons.keys()) == {0, 1, 2, 3}
    assert set(m.route_labels.keys()) == {0, 1, 2, 3}
    assert m.route_labels[0] == "text"
    assert m.route_labels[2] == "skip"
    assert m.route_labels[1] in ("vision_diagram", "vision_generic")
    assert m.route_labels[3] == "table_odl"
    assert m.reasons[2] == "blank_page_heuristic"


# ── layout_features_dict ────────────────────────────────────────────────────

def test_layout_features_dict_shape_is_json_safe():
    layout = _layout(word_count=42, image_coverage=0.5, has_math=True, has_table=True)
    feats = layout_features_dict(layout)
    assert feats["word_count"] == 42
    assert feats["image_coverage"] == 0.5
    assert feats["has_math"] is True
    assert feats["has_table"] is True
    # All values JSON-primitive
    for v in feats.values():
        assert isinstance(v, (int, float, bool, str))


# ── _enrich_result / _make_skip_slide stamp telemetry ───────────────────────

def test_enrich_result_stamps_route_telemetry_from_manifest():
    layout = _layout(word_count=200)
    manifest = build_routing_manifest({0: layout}, {}, ai_model="groq")
    result = {"index": 0, "slide_type": "content"}
    _enrich_result(result, layout, "deck.pdf", "Text", manifest)
    meta = result["_meta"]
    assert meta["route"] == manifest.route_labels[0]
    assert meta["route_reason"] == manifest.reasons[0]
    assert meta["layout_features"]["word_count"] == 200


def test_make_skip_slide_stamps_skip_route():
    layout = _layout(word_count=2, raw_text="hi")
    manifest = build_routing_manifest({0: layout}, {}, ai_model="groq")
    slide = _make_skip_slide(0, layout, "deck.pdf", manifest)
    assert slide["_meta"]["route"] == "skip"
    assert slide["_meta"]["route_reason"] == manifest.reasons[0]
    assert "layout_features" in slide["_meta"]


# ── _backfill_route_meta only fills missing fields ──────────────────────────

def test_backfill_route_meta_fills_missing_fields_and_returns_true():
    layout = _layout(word_count=200)
    manifest = build_routing_manifest({0: layout}, {}, ai_model="groq")
    cached = {"slide_index": 0, "_meta": {"engine": "Text"}}
    changed = _backfill_route_meta(cached, layout, manifest)
    assert changed is True
    meta = cached["_meta"]
    assert meta["route"] == manifest.route_labels[0]
    assert meta["route_reason"] == manifest.reasons[0]
    assert "layout_features" in meta
    assert meta["engine"] == "Text"  # untouched


def test_backfill_route_meta_preserves_existing_fields_and_returns_false():
    layout = _layout(word_count=200)
    manifest = build_routing_manifest({0: layout}, {}, ai_model="groq")
    cached = {
        "slide_index": 0,
        "_meta": {
            "route": "vision_diagram",
            "route_reason": "manual_override",
            "layout_features": {"word_count": 999},
        },
    }
    changed = _backfill_route_meta(cached, layout, manifest)
    assert changed is False
    assert cached["_meta"]["route"] == "vision_diagram"
    assert cached["_meta"]["route_reason"] == "manual_override"
    assert cached["_meta"]["layout_features"]["word_count"] == 999


# ── diagnostics.flag_suspicious ─────────────────────────────────────────────

def test_flag_suspicious_skip_with_images():
    rows = [
        {
            "slide_index": 4,
            "route": "skip",
            "layout_features": {"image_coverage": 0.5, "alpha_ratio": 0.9},
        }
    ]
    flags = flag_suspicious(rows)
    assert flags == [{"slide_index": 4, "reason": "skip_with_images"}]


def test_flag_suspicious_text_with_low_alpha():
    rows = [
        {
            "slide_index": 7,
            "route": "text",
            "layout_features": {"image_coverage": 0.0, "alpha_ratio": 0.10},
        }
    ]
    flags = flag_suspicious(rows)
    assert flags == [{"slide_index": 7, "reason": "text_with_low_alpha"}]


def test_flag_suspicious_quiet_for_normal_routes():
    rows = [
        {
            "slide_index": 0,
            "route": "text",
            "layout_features": {"image_coverage": 0.0, "alpha_ratio": 0.95},
        },
        {
            "slide_index": 1,
            "route": "vision_diagram",
            "layout_features": {"image_coverage": 0.6, "alpha_ratio": 0.20},
        },
    ]
    assert flag_suspicious(rows) == []


def test_flag_suspicious_tolerates_missing_fields():
    rows = [
        {"slide_index": 1},  # no route, no features
        {"route": "text"},   # no slide_index
        {"slide_index": "x", "route": "text", "layout_features": {}},  # bad index
    ]
    assert flag_suspicious(rows) == []
