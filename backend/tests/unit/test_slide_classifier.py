"""Unit tests for backend.services.slide_classifier.

Covers:
  * Every routing rule in classify_page (priority order, math override,
    vision-unavailable degradation).
  * build_routing_manifest population for a mixed deck, including
    TABLE_ODL → both odl_table_indices and text_indices.
"""
from __future__ import annotations

from backend.services.layout_analyzer import PageLayout
from backend.services.slide_classifier import (
    Route,
    build_routing_manifest,
    classify_page,
    vision_available_for_model,
)


# ---------------------------------------------------------------------------
# PageLayout factory
# ---------------------------------------------------------------------------

def make_layout(
    *,
    index: int = 0,
    word_count: int = 100,
    alpha_ratio: float = 0.9,
    image_coverage: float = 0.0,
    drawing_count: int = 0,
    has_table: bool = False,
    column_count: int = 1,
    has_code_block: bool = False,
    has_math: bool = False,
    raw_text: str = "the quick brown fox",
    odl_table_md: str = "",
) -> PageLayout:
    return PageLayout(
        index=index,
        page_number=index + 1,
        word_count=word_count,
        alpha_ratio=alpha_ratio,
        image_coverage=image_coverage,
        drawing_count=drawing_count,
        has_table=has_table,
        column_count=column_count,
        has_code_block=has_code_block,
        has_math=has_math,
        raw_text=raw_text,
        odl_table_md=odl_table_md,
    )


# ---------------------------------------------------------------------------
# classify_page — SKIP rules
# ---------------------------------------------------------------------------

def test_skip_when_metadata_flag_true_overrides_everything():
    layout = make_layout(
        word_count=500, image_coverage=0.9, has_table=True, odl_table_md="| x |"
    )
    assert classify_page(layout, is_metadata=True, vision_available=True) == Route.SKIP


def test_skip_when_blank_page():
    layout = make_layout(
        word_count=2, image_coverage=0.0, drawing_count=0, raw_text="hi"
    )
    assert classify_page(layout, is_metadata=False, vision_available=True) == Route.SKIP


def test_not_skip_when_blank_text_but_image_heavy():
    layout = make_layout(
        word_count=2, image_coverage=0.5, drawing_count=0, raw_text="hi"
    )
    # word_count<5 but image_coverage>=0.15 → not SKIP, falls into VISION
    route = classify_page(layout, is_metadata=False, vision_available=True)
    assert route == Route.VISION


def test_not_skip_when_blank_text_but_drawing_heavy():
    layout = make_layout(
        word_count=2, image_coverage=0.0, drawing_count=10, raw_text="hi"
    )
    # word_count<5 but drawing_count>=5 → not SKIP. Drawings (<20) and low
    # image_coverage don't trigger VISION; alpha_ratio>0.25; falls to TEXT.
    route = classify_page(layout, is_metadata=False, vision_available=True)
    assert route == Route.TEXT


# ---------------------------------------------------------------------------
# classify_page — TABLE_ODL
# ---------------------------------------------------------------------------

def test_table_odl_takes_priority_over_table_llm():
    layout = make_layout(has_table=True, odl_table_md="| col |\n| -- |")
    assert classify_page(layout, is_metadata=False, vision_available=True) == Route.TABLE_ODL


def test_table_odl_when_only_odl_set():
    layout = make_layout(odl_table_md="| a | b |\n| - | - |")
    assert classify_page(layout, is_metadata=False, vision_available=True) == Route.TABLE_ODL


def test_table_odl_works_without_vision_too():
    layout = make_layout(odl_table_md="| a | b |")
    # ODL doesn't need vision — still TABLE_ODL
    assert classify_page(layout, is_metadata=False, vision_available=False) == Route.TABLE_ODL


# ---------------------------------------------------------------------------
# classify_page — TABLE_LLM
# ---------------------------------------------------------------------------

def test_table_llm_when_pymupdf_table_and_no_odl():
    layout = make_layout(has_table=True)
    assert classify_page(layout, is_metadata=False, vision_available=True) == Route.TABLE_LLM


def test_table_llm_degrades_to_text_when_no_vision():
    layout = make_layout(has_table=True)
    assert classify_page(layout, is_metadata=False, vision_available=False) == Route.TEXT


# ---------------------------------------------------------------------------
# classify_page — math override
# ---------------------------------------------------------------------------

def test_math_override_keeps_text_when_alpha_low():
    # Low alpha_ratio would normally trigger VISION, but math override wins
    layout = make_layout(
        word_count=50, alpha_ratio=0.10, has_math=True, image_coverage=0.0
    )
    assert classify_page(layout, is_metadata=False, vision_available=True) == Route.TEXT


def test_math_override_does_not_apply_when_word_count_too_low():
    layout = make_layout(
        word_count=8, alpha_ratio=0.10, has_math=True, image_coverage=0.0
    )
    # word_count<10 → math override skipped → low alpha → VISION
    assert classify_page(layout, is_metadata=False, vision_available=True) == Route.VISION


# ---------------------------------------------------------------------------
# classify_page — VISION triggers
# ---------------------------------------------------------------------------

def test_vision_triggered_by_high_image_coverage():
    layout = make_layout(image_coverage=0.30, word_count=80)
    assert classify_page(layout, is_metadata=False, vision_available=True) == Route.VISION


def test_vision_triggered_by_many_drawings():
    layout = make_layout(drawing_count=25, word_count=80)
    assert classify_page(layout, is_metadata=False, vision_available=True) == Route.VISION


def test_vision_triggered_by_low_alpha_ratio():
    layout = make_layout(alpha_ratio=0.20, word_count=80, has_math=False)
    assert classify_page(layout, is_metadata=False, vision_available=True) == Route.VISION


def test_vision_triggered_by_sparse_text_with_image():
    layout = make_layout(word_count=20, image_coverage=0.10)
    assert classify_page(layout, is_metadata=False, vision_available=True) == Route.VISION


def test_vision_degrades_to_text_when_unavailable():
    layout = make_layout(image_coverage=0.30, word_count=80)
    assert classify_page(layout, is_metadata=False, vision_available=False) == Route.TEXT


# ---------------------------------------------------------------------------
# classify_page — default TEXT
# ---------------------------------------------------------------------------

def test_default_text_for_rich_prose():
    layout = make_layout(
        word_count=200, alpha_ratio=0.95, image_coverage=0.0, drawing_count=0
    )
    assert classify_page(layout, is_metadata=False, vision_available=True) == Route.TEXT


def test_default_text_with_code_block():
    layout = make_layout(
        word_count=80, has_code_block=True, image_coverage=0.0
    )
    assert classify_page(layout, is_metadata=False, vision_available=True) == Route.TEXT


def test_default_text_with_multi_column():
    layout = make_layout(word_count=200, column_count=2)
    assert classify_page(layout, is_metadata=False, vision_available=True) == Route.TEXT


# ---------------------------------------------------------------------------
# vision_available_for_model
# ---------------------------------------------------------------------------

def test_vision_available_for_groq():
    assert vision_available_for_model("groq") is True


def test_vision_available_for_gemini():
    assert vision_available_for_model("gemini-2.0-flash") is True


def test_vision_unavailable_for_ollama():
    assert vision_available_for_model("llama3") is False


# ---------------------------------------------------------------------------
# build_routing_manifest — mixed deck
# ---------------------------------------------------------------------------

def test_build_routing_manifest_mixed_deck():
    layouts = {
        0: make_layout(index=0, word_count=200),                              # TEXT
        1: make_layout(index=1, image_coverage=0.40, word_count=80),          # VISION
        2: make_layout(index=2, has_table=True),                              # TABLE_LLM
        3: make_layout(index=3, has_table=True, odl_table_md="| a | b |"),    # TABLE_ODL
        4: make_layout(index=4, word_count=2, raw_text="hi"),                 # SKIP (blank)
        5: make_layout(index=5, word_count=300),                              # SKIP (metadata flag)
    }
    metadata_flags = {5: True}
    manifest = build_routing_manifest(layouts, metadata_flags, ai_model="groq")

    assert manifest.text_indices == [0, 3]
    assert manifest.vision_indices == [1]
    assert manifest.table_llm_indices == [2]
    assert manifest.skip_indices == [4, 5]
    assert manifest.odl_table_indices == [3]
    # TABLE_ODL pages must appear in BOTH odl_table_indices and text_indices
    assert 3 in manifest.text_indices and 3 in manifest.odl_table_indices
    # Layouts dict copied through
    assert set(manifest.layouts.keys()) == set(layouts.keys())


def test_build_routing_manifest_no_vision_model_degrades_table_llm_and_vision():
    layouts = {
        0: make_layout(index=0, has_table=True),                              # would be TABLE_LLM → TEXT
        1: make_layout(index=1, image_coverage=0.40, word_count=80),          # would be VISION → TEXT
        2: make_layout(index=2, odl_table_md="| a |\n| - |"),                 # TABLE_ODL stays
    }
    manifest = build_routing_manifest(layouts, metadata_flags={}, ai_model="llama3")
    assert manifest.vision_indices == []
    assert manifest.table_llm_indices == []
    # 0 (degraded), 2 (TABLE_ODL pass-through), and 1 (degraded) all in text
    assert sorted(manifest.text_indices) == [0, 1, 2]
    assert manifest.odl_table_indices == [2]


def test_build_routing_manifest_empty_input():
    manifest = build_routing_manifest({}, {}, ai_model="groq")
    assert manifest.text_indices == []
    assert manifest.vision_indices == []
    assert manifest.table_llm_indices == []
    assert manifest.skip_indices == []
    assert manifest.odl_table_indices == []
    assert manifest.layouts == {}


def test_build_routing_manifest_orders_by_index():
    layouts = {
        2: make_layout(index=2, word_count=200),
        0: make_layout(index=0, word_count=200),
        1: make_layout(index=1, word_count=200),
    }
    manifest = build_routing_manifest(layouts, {}, ai_model="groq")
    assert manifest.text_indices == [0, 1, 2]
