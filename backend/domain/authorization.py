"""
Authorization domain — ownership and role-based access checks.
These are business rules, not HTTP middleware. Services call these functions
before performing sensitive operations so the API layer stays thin.
"""
from fastapi import HTTPException, status


def assert_lecture_owner(lecture: dict | None, professor_id: str, lecture_id: str) -> None:
    """Raise 403 if the professor does not own the lecture.

    Args:
        lecture: The lecture row fetched from the DB (or None if not found).
        professor_id: The authenticated professor's user ID.
        lecture_id: The lecture ID (used in the error message).
    """
    if lecture is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Lecture {lecture_id} not found.",
        )
    if lecture.get("professor_id") != professor_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to access this lecture.",
        )


def assert_student_access(user_role: str) -> None:
    """Raise 403 if the authenticated user is not a student."""
    if user_role != "student":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This endpoint is only accessible to students.",
        )


def assert_professor_access(user_role: str) -> None:
    """Raise 403 if the authenticated user is not a professor."""
    if user_role != "professor":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This endpoint is only accessible to professors.",
        )
