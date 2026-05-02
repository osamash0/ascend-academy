"""Unit tests for the 3-layer content filter."""
import pytest

from backend.services.content_filter import (
    _compute_content_density,
    _heuristic_check,
    _is_heavy_stem,
    is_metadata_slide,
)


class TestHeavyStem:
    def test_equation_rich_slide(self):
        # Needs ≥3 of: operators / Greek letters / math symbols / sub-super / def-keyword
        text = "Theorem: Let f(x) = α∑x_i^2 / n. Then proof shows lim → 0."
        assert _is_heavy_stem(text) is True

    def test_plain_text_not_stem(self):
        assert _is_heavy_stem("This is a paragraph about history.") is False


class TestHeuristicCheck:
    def test_thank_you_slide_is_metadata(self):
        assert _heuristic_check("Thank you", 5, 10) == "metadata"

    def test_questions_slide_is_metadata(self):
        assert _heuristic_check("Questions?", 5, 10) == "metadata"

    def test_extremely_short_is_metadata(self):
        assert _heuristic_check("Hi", 1, 10) == "metadata"

    def test_email_present_is_metadata(self):
        text = "Contact: prof@uni.example for questions about office hours"
        assert _heuristic_check(text, 0, 10) == "metadata"

    def test_long_dense_content_is_educational(self):
        text = " ".join(["concept" + str(i) for i in range(150)])
        assert _heuristic_check(text, 5, 50) == "educational"

    def test_short_title_is_uncertain(self):
        # 5–19 words, no signals → uncertain (let layer 2/3 decide)
        assert _heuristic_check("Introduction to cellular biology theory", 0, 10) == "uncertain"


class TestContentDensity:
    def test_empty_text_zero_density(self):
        assert _compute_content_density("") == 0.0

    def test_only_stop_words_low_density(self):
        text = "the and of in to for on with at by from as into the and of"
        assert _compute_content_density(text) < 0.15

    def test_unique_content_high_density(self):
        # Repetition keeps unique-ratio reasonable; assert > stop-words case.
        text = " ".join(
            ["mitochondria", "cytoplasm", "ribosomes", "endoplasmic", "reticulum",
             "nucleus", "chromatin", "vesicles", "lysosome", "peroxisome"] * 3
        )
        assert _compute_content_density(text) > 0.2


class TestIsMetadataSlide:
    def test_thank_you_layer1(self, mock_llm_provider):
        out = is_metadata_slide("Thank you", 9, 10)
        assert out["is_metadata"] is True
        assert out["layer"] == 1

    def test_dense_educational_layer1(self, mock_llm_provider):
        text = " ".join(["definition", "theorem", "proof", "axiom", "corollary"] * 30)
        out = is_metadata_slide(text, 5, 20)
        assert out["is_metadata"] is False
        assert out["layer"] in (1, 2)

    def test_metadata_keywords_email_layer1(self, mock_llm_provider):
        text = "Office hours Mon 10-12. Email: prof@uni.example.test"
        out = is_metadata_slide(text, 0, 10)
        assert out["is_metadata"] is True
        assert out["layer"] == 1

    def test_stem_short_not_metadata(self, mock_llm_provider):
        # 3+ STEM signals: '=' operator, ∑ symbol, α Greek letter
        text = "Theorem: ∑α_i = α_n, proof: F = ma + ∑x_i^2"
        out = is_metadata_slide(text, 5, 20)
        assert out["is_metadata"] is False
        assert out["layer"] == 1
