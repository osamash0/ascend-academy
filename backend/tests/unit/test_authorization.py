"""Unit tests for backend.domain.authorization."""
import pytest
from fastapi import HTTPException

from backend.domain.authorization import (
    assert_lecture_owner,
    assert_professor_access,
    assert_student_access,
)


class TestAssertLectureOwner:
    def test_passes_when_owner_matches(self):
        assert_lecture_owner({"professor_id": "p-1"}, "p-1", "lec-1")  # no raise

    def test_404_when_lecture_missing(self):
        with pytest.raises(HTTPException) as exc:
            assert_lecture_owner(None, "p-1", "lec-1")
        assert exc.value.status_code == 404

    def test_403_when_other_professor(self):
        with pytest.raises(HTTPException) as exc:
            assert_lecture_owner({"professor_id": "p-1"}, "p-2", "lec-1")
        assert exc.value.status_code == 403

    def test_403_when_no_professor_id(self):
        with pytest.raises(HTTPException) as exc:
            assert_lecture_owner({}, "p-1", "lec-1")
        assert exc.value.status_code == 403

    def test_message_includes_lecture_id_when_missing(self):
        with pytest.raises(HTTPException) as exc:
            assert_lecture_owner(None, "p-1", "the-id")
        assert "the-id" in exc.value.detail


class TestRoleGates:
    def test_student_pass(self):
        assert_student_access("student")

    def test_student_block(self):
        with pytest.raises(HTTPException) as exc:
            assert_student_access("professor")
        assert exc.value.status_code == 403

    def test_professor_pass(self):
        assert_professor_access("professor")

    def test_professor_block(self):
        with pytest.raises(HTTPException) as exc:
            assert_professor_access("student")
        assert exc.value.status_code == 403
