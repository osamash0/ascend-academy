"""The viewer's own Space: their private uploads ("My Materials").

A private upload is a lecture with ``student_owner_id`` set, ``visibility =
'private_student'`` and no ``course_id`` (see materials_service). v4 reads
lectures through Spaces, so those uploads get one Space of their own. It has
no row in ``courses``: its id is the owner's user id, which no course id can
equal (both are random UUIDs), and only its owner can open it —
``can_view_course`` admits it only when the id *is* the caller.

Every query that asks for "the lectures of Space $n" uses ``space_lectures``,
so a course and the personal Space answer the same question the same way.
"""
from __future__ import annotations

from typing import Any

#: What the Space is called on screen.
TITLE = "My materials"


def is_personal(space_id: Any, user_id: Any) -> bool:
    return bool(user_id) and str(space_id) == str(user_id)


def space_lectures(param: str, alias: str = "l") -> str:
    """SQL: lecture ``alias`` belongs to the Space whose id is ``param``.

    A course's lectures, or — when ``param`` is a user id — that user's
    private uploads. Callers must have checked access to the Space first.
    """
    a = alias
    return (
        f"({a}.course_id = {param} OR ({a}.course_id IS NULL AND {a}.student_owner_id = {param}"
        f" AND {a}.visibility = 'private_student'))"
    )
