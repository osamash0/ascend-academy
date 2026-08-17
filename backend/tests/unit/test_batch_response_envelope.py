"""Regression tests for as_slide_item_list (batch LLM response normalisation).

Why this exists: the batch prompts ask for a bare JSON array, but we send them
with ``json_mode=True`` and JSON mode requires a top-level JSON *object* — so
the model cannot comply and wraps the array, in practice as ``{"slides": [...]}``.

The old code did ``if isinstance(parsed, dict): parsed = [parsed]``, which
treated that envelope as a single slide. The lone item had no ``page_number``,
so page-keyed matching found nothing, every batch raised "unusable JSON
response", and the pipeline silently fell back to per-slide synthesis — roughly
5x the LLM calls for a response whose data was fine. Observed failing 2/2
batches on a real 10-slide PDF before the fix.

These tests are model-free so they hold regardless of provider behaviour.
"""
import pytest

from backend.services.ai.orchestrator import as_slide_item_list


def _slide(page: int) -> dict:
    return {"page_number": page, "title": f"Slide {page}", "summary": "s"}


class TestEnvelopeUnwrapping:
    def test_unwraps_the_slides_envelope_json_mode_forces(self):
        """The exact shape that broke production: {"slides": [...]}."""
        parsed = {"slides": [_slide(1), _slide(2)]}
        assert as_slide_item_list(parsed) == [_slide(1), _slide(2)]

    @pytest.mark.parametrize("key", ["items", "results", "data", "output"])
    def test_unwraps_other_common_envelope_keys(self, key):
        assert as_slide_item_list({key: [_slide(1)]}) == [_slide(1)]

    def test_unwraps_an_unknown_key_with_a_sole_list_value(self):
        """Provider drift shouldn't reintroduce the outage."""
        assert as_slide_item_list({"analysed_slides": [_slide(7)]}) == [_slide(7)]

    def test_passes_a_bare_array_through_untouched(self):
        items = [_slide(1), _slide(2)]
        assert as_slide_item_list(items) is items


class TestSingleSlideAndDegenerateInput:
    def test_a_slide_shaped_dict_is_still_treated_as_one_slide(self):
        """Must not regress the legacy single-object response path."""
        assert as_slide_item_list(_slide(3)) == [_slide(3)]

    def test_slide_shaped_dict_wins_over_an_incidental_list_field(self):
        """A real slide carries `questions: [...]`; that must not be mistaken
        for the envelope payload."""
        slide = {"page_number": 4, "title": "T", "questions": [{"question": "q"}]}
        assert as_slide_item_list(slide) == [slide]

    def test_empty_dict_yields_one_unusable_item_not_a_crash(self):
        assert as_slide_item_list({}) == [{}]

    @pytest.mark.parametrize("bad", [None, "", "not json", 42])
    def test_non_dict_non_list_yields_empty(self, bad):
        assert as_slide_item_list(bad) == []

    def test_multiple_list_values_with_no_known_key_is_not_guessed(self):
        """Ambiguous envelope: don't silently pick one. Falls back to
        single-item so the caller's own validation reports it."""
        parsed = {"alpha": [_slide(1)], "beta": [_slide(2)]}
        assert as_slide_item_list(parsed) == [parsed]
