"""Unit tests for the overlapping-window quiz batcher.

Covers:
  * ``iter_overlapping_windows`` — coverage, ordering, context-count math,
    edge cases (empty / single / exactly-one-batch / not divisible).
  * ``batch_analyze_text_slides`` — context-only slides are wrapped in
    ``<context_only>`` markers in the prompt and dropped from results.
"""
from __future__ import annotations

from typing import Any, Dict, List

import pytest

from backend.services.ai.orchestrator import (
    QUIZ_BATCH_CONFIG,
    _load_quiz_batch_config,
    batch_analyze_text_slides,
    iter_overlapping_windows,
)


# ---------------------------------------------------------------------------
# iter_overlapping_windows
# ---------------------------------------------------------------------------

class TestIterOverlappingWindows:
    def _collect(self, n: int, batch_size: int, overlap: int):
        items = list(range(n))
        return list(iter_overlapping_windows(items, batch_size, overlap))

    def test_empty_yields_nothing(self):
        assert self._collect(0, 5, 1) == []

    def test_fits_in_one_window(self):
        wins = self._collect(3, 5, 1)
        assert wins == [([0, 1, 2], 0)]

    def test_exact_batch_size_one_window(self):
        wins = self._collect(5, 5, 1)
        assert wins == [([0, 1, 2, 3, 4], 0)]

    def test_canonical_5_1_with_8_items(self):
        # Default batching: batch_size=5, overlap=1
        wins = self._collect(8, 5, 1)
        assert wins == [
            ([0, 1, 2, 3, 4], 0),
            ([4, 5, 6, 7], 1),
        ]

    def test_canonical_5_1_with_13_items(self):
        wins = self._collect(13, 5, 1)
        assert wins == [
            ([0, 1, 2, 3, 4], 0),
            ([4, 5, 6, 7, 8], 1),
            ([8, 9, 10, 11, 12], 1),
        ]

    def test_each_item_is_new_in_exactly_one_window(self):
        # Stronger guarantee: across all yielded windows, every input item
        # appears as a NON-context entry exactly once.
        for n in [1, 2, 4, 5, 6, 7, 9, 10, 11, 17, 30]:
            for bs, ov in [(5, 1), (5, 2), (4, 1), (3, 0), (8, 3)]:
                seen: List[int] = []
                for window, ctx in iter_overlapping_windows(list(range(n)), bs, ov):
                    seen.extend(window[ctx:])
                assert seen == list(range(n)), (
                    f"coverage broken for n={n}, batch_size={bs}, overlap={ov}: "
                    f"got {seen}"
                )

    def test_window_size_never_exceeds_batch_size(self):
        for window, _ctx in iter_overlapping_windows(list(range(40)), 5, 1):
            assert len(window) <= 5

    def test_zero_overlap_behaves_like_plain_chunking(self):
        wins = self._collect(7, 3, 0)
        assert wins == [
            ([0, 1, 2], 0),
            ([3, 4, 5], 0),
            ([6], 0),
        ]

    def test_invalid_batch_size_raises(self):
        with pytest.raises(ValueError):
            list(iter_overlapping_windows([1, 2], 0, 0))

    def test_invalid_overlap_raises(self):
        with pytest.raises(ValueError):
            list(iter_overlapping_windows([1, 2], 3, 3))
        with pytest.raises(ValueError):
            list(iter_overlapping_windows([1, 2], 3, -1))


# ---------------------------------------------------------------------------
# Config loader
# ---------------------------------------------------------------------------

class TestQuizBatchConfig:
    def test_defaults(self, monkeypatch):
        monkeypatch.delenv("QUIZ_BATCH_SIZE", raising=False)
        monkeypatch.delenv("QUIZ_BATCH_OVERLAP", raising=False)
        cfg = _load_quiz_batch_config()
        assert cfg.batch_size == 5
        assert cfg.context_overlap == 1

    def test_module_level_config_is_loaded(self):
        assert QUIZ_BATCH_CONFIG.batch_size >= 1
        assert 0 <= QUIZ_BATCH_CONFIG.context_overlap < QUIZ_BATCH_CONFIG.batch_size

    def test_overlap_clamped_when_too_large(self, monkeypatch):
        monkeypatch.setenv("QUIZ_BATCH_SIZE", "4")
        monkeypatch.setenv("QUIZ_BATCH_OVERLAP", "10")
        cfg = _load_quiz_batch_config()
        assert cfg.batch_size == 4
        assert cfg.context_overlap == 3  # bs - 1

    def test_garbage_env_falls_back(self, monkeypatch):
        monkeypatch.setenv("QUIZ_BATCH_SIZE", "not-a-number")
        monkeypatch.setenv("QUIZ_BATCH_OVERLAP", "also-bad")
        cfg = _load_quiz_batch_config()
        assert cfg.batch_size == 5
        assert cfg.context_overlap == 1


# ---------------------------------------------------------------------------
# batch_analyze_text_slides — context_only handling
# ---------------------------------------------------------------------------

def _slide(idx: int, text: str = "body", context_only: bool = False) -> Dict[str, Any]:
    s: Dict[str, Any] = {"index": idx, "page_number": idx + 1, "text": text}
    if context_only:
        s["context_only"] = True
    return s


def _make_response(slides: List[Dict[str, Any]]) -> str:
    """Render a JSON LLM response covering exactly the non-context slides."""
    import json
    items = []
    for s in slides:
        if s.get("context_only"):
            continue
        items.append({
            "page_number": s["page_number"],
            "title": f"T{s['index']}",
            "content": s["text"],
            "summary": "s",
            "questions": [{
                "question": f"Q for slide {s['index']}?",
                "options": [
                    "First plausible distractor option",
                    "Second plausible distractor option",
                    "Third plausible distractor option",
                    "Fourth plausible distractor option",
                ],
                "answer": "A",
                "explanation": "Because the first option states the correct concept clearly.",
                "concept": "test concept",
                "cognitive_level": "apply",
            }],
            "slide_type": "content_slide",
            "is_metadata": False,
        })
    return json.dumps(items)


class TestBatchAnalyzeContextOnly:
    @pytest.mark.asyncio
    async def test_context_only_slides_are_dropped_from_results(self, monkeypatch):
        slides = [
            _slide(3, "previous slide body", context_only=True),
            _slide(4, "current slide A"),
            _slide(5, "current slide B"),
        ]
        captured = {}

        async def fake_call_llm(fn):
            return fn()

        def fake_rotation(prompt: str, _chain):
            captured["prompt"] = prompt
            return _make_response(slides)

        monkeypatch.setattr(
            "backend.services.llm_client.call_llm", fake_call_llm,
        )
        monkeypatch.setattr(
            "backend.services.ai.orchestrator._generate_with_rotation",
            fake_rotation,
        )

        results = await batch_analyze_text_slides(slides)

        # Context-only slide dropped entirely.
        result_indices = sorted(r["index"] for r in results)
        assert result_indices == [4, 5]

        # Prompt wraps the context slide and includes the instruction header.
        prompt = captured["prompt"]
        assert "<context_only>" in prompt
        assert "</context_only>" in prompt
        assert "previous slide body" in prompt
        assert "Do NOT generate a question" in prompt

    @pytest.mark.asyncio
    async def test_no_context_header_when_no_context_slides(self, monkeypatch):
        slides = [_slide(0), _slide(1)]
        captured = {}

        async def fake_call_llm(fn):
            return fn()

        def fake_rotation(prompt: str, _chain):
            captured["prompt"] = prompt
            return _make_response(slides)

        monkeypatch.setattr(
            "backend.services.llm_client.call_llm", fake_call_llm,
        )
        monkeypatch.setattr(
            "backend.services.ai.orchestrator._generate_with_rotation",
            fake_rotation,
        )

        results = await batch_analyze_text_slides(slides)
        assert len(results) == 2
        assert "<context_only>" not in captured["prompt"]
        assert "Do NOT generate a question" not in captured["prompt"]

    @pytest.mark.asyncio
    async def test_misbehaving_model_cannot_leak_context_via_positional_zip(
        self, monkeypatch,
    ):
        # Model misbehaves: returns a list of length == len(active_slides)
        # but emits a context-slide entry and omits one active slide. We
        # must NOT silently positionally attach the context content to an
        # active index — the context entry must be filtered, and the
        # missing active slide must get a fallback row.
        import json
        slides = [
            _slide(0, "context body", context_only=True),
            _slide(1, "active alpha"),
            _slide(2, "active beta"),
        ]

        def _q(label: str) -> Dict[str, Any]:
            return {
                "page_number": label_to_pn[label],
                "title": f"T-{label}",
                "content": label,
                "summary": "s",
                "questions": [{
                    "question": f"Q {label}?",
                    "options": ["one", "two", "three", "four"],
                    "answer": "A",
                    "explanation": "Because option one is correct.",
                    "concept": "c",
                    "cognitive_level": "apply",
                }],
            }

        label_to_pn = {"ctx": 1, "alpha": 2, "beta": 3}
        # Length == 2 active slides, but the model included CONTEXT (page 1)
        # instead of beta (page 3).
        bad_response = json.dumps([_q("ctx"), _q("alpha")])

        async def fake_call_llm(fn):
            return fn()

        def fake_rotation(_prompt: str, _chain):
            return bad_response

        monkeypatch.setattr(
            "backend.services.llm_client.call_llm", fake_call_llm,
        )
        monkeypatch.setattr(
            "backend.services.ai.orchestrator._generate_with_rotation",
            fake_rotation,
        )

        results = await batch_analyze_text_slides(slides)

        by_idx = {r["index"]: r for r in results}
        # Context slide (index 0) must NOT appear.
        assert 0 not in by_idx
        # Active alpha keeps its real content.
        assert by_idx[1]["content"] == "alpha"
        # Missing active beta got a fallback row, NOT the context content.
        assert by_idx[2]["content"] == "active beta"
        assert by_idx[2].get("title") == "Slide 3"

    @pytest.mark.asyncio
    async def test_llm_failure_returns_active_slides_only(self, monkeypatch):
        slides = [
            _slide(0, context_only=True),
            _slide(1, "active"),
        ]

        async def fake_call_llm(_fn):
            raise RuntimeError("boom")

        monkeypatch.setattr(
            "backend.services.llm_client.call_llm", fake_call_llm,
        )

        results = await batch_analyze_text_slides(slides)
        assert [r["index"] for r in results] == [1]
        assert results[0]["parse_error"] == "boom"
