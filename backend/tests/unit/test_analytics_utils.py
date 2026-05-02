"""Unit tests for analytics_utils helpers."""
import pytest

from backend.services.utils.analytics_utils import (
    calculate_student_typology,
    generate_anon_name,
)


class TestStudentTypology:
    def test_disengaged_low_progress_no_help(self):
        assert calculate_student_typology(20, 50, 0, 0) == "Disengaged (At Risk)"

    def test_highly_confused_seeks_help(self):
        assert (
            calculate_student_typology(20, 50, 5, 0)
            == "Highly Confused (Seeking Help)"
        )

    def test_natural_comprehension(self):
        assert calculate_student_typology(80, 90, 0, 0) == "Natural Comprehension"

    def test_reviser_high_effort(self):
        assert (
            calculate_student_typology(80, 85, 0, 5) == "The Reviser (High Effort)"
        )

    def test_struggling_critical(self):
        assert calculate_student_typology(80, 40, 0, 0) == "Struggling (Critical)"

    def test_standard_default(self):
        assert calculate_student_typology(80, 70, 0, 0) == "Standard"

    @pytest.mark.parametrize("prog,score", [(50, 80), (49, 80)])
    def test_boundary_progress_threshold(self, prog, score):
        # 50 is the boundary — < 50 is at risk, >= 50 transitions to scoring buckets
        result = calculate_student_typology(prog, score, 0, 0)
        if prog < 50:
            assert "Disengaged" in result or "Confused" in result
        else:
            assert "Disengaged" not in result


class TestAnonName:
    def test_deterministic(self):
        assert generate_anon_name("u-1") == generate_anon_name("u-1")

    def test_format(self):
        out = generate_anon_name("u-1")
        theme, hex_part = out.split("-")
        assert len(hex_part) == 4
        int(hex_part, 16)
