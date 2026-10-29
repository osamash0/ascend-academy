"""Person-level views of a Space, behind FEATURE_LANDING_PEOPLE (off).

Built only from the Space's own facts and named only by per-Space pseudonyms:
no user id, email or account name ever leaves here. Real members see none of
this until Abi's privacy call (spec §0, §8).
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Optional

from backend.services.insights import detectors
from backend.services.insights.sources.space import SpaceData
from backend.services.insights.space_engine import MIN_READERS
from backend.services.insights.space_facts import DWELL_CEIL, LessonFacts, first_tries, lesson_facts, page_of
from backend.services.utils.analytics_utils import space_pseudonym


def _length(lf: LessonFacts) -> int:
    """As many pages as the Lesson has, else the highest page seen: the Landing's own rule. A page
    number is a member's own insert, so it never makes a Lesson longer than its document."""
    return lf.lesson.pages if lf.lesson.pages > 0 else max(lf.pages, default=0)


def _readers(facts: dict[str, LessonFacts]) -> set[str]:
    return set().union(*(lf.readers for lf in facts.values()))


def strugglers(data: SpaceData, salt: str) -> list[dict[str, Any]]:
    """People who are behind and have not asked for help, by pseudonym; empty under the floor."""
    facts = lesson_facts(data)
    readers = _readers(facts)
    if len(readers) < MIN_READERS:
        return []
    length = {lesson_id: _length(lf) for lesson_id, lf in facts.items()}
    total_pages = sum(length.values()) or 1
    tries: dict[str, list[bool]] = defaultdict(list)
    for t in first_tries(data):
        tries[t.user_id].append(t.correct)
    students = []
    untried: set[str] = set()
    for user in readers:
        pid, name = space_pseudonym(user, data.space_id, salt)
        # Only pages the Lesson has: progress cannot pass 100, and a page nobody can open counts for nothing.
        read = sum(1 for i, lf in facts.items() for n, pf in lf.pages.items() if n <= length[i] and user in pf.readers)
        helped = sum(
            1 for i, lf in facts.items() for n, pf in lf.pages.items() if n <= length[i] and user in (pf.explain | pf.ask)
        )
        mine = tries[user]
        if not mine:
            untried.add(pid)
        students.append({
            "student_id": pid,
            "student_name": name,
            "progress_percentage": round(100 * read / total_pages),
            # Nobody who has tried no question is behind on questions: for them progress alone decides.
            "quiz_score": round(100 * sum(mine) / len(mine)) if mine else 100,
            "ai_interactions": helped,
        })
    found = detectors.detect_silent_strugglers({"total_students": len(students), "students": students})
    people = (found[0].get("detail") or {}).get("students", []) if found else []
    return [
        {"id": p["studentId"], "name": p["name"], "progress": p["progress"],
         "firstTry": None if p["studentId"] in untried else p["quizScore"], "help": p["aiInteractions"]}
        for p in people
    ]


def journey(data: SpaceData, salt: str, person: str, lesson_id: str) -> Optional[list[dict[str, Any]]]:
    """One person's way through one Lesson, page by page. None if the pseudonym is no member here, the
    Lesson is not in this Space, or fewer than `MIN_READERS` people have read (as with `strugglers`)."""
    facts = lesson_facts(data)
    if len(_readers(facts)) < MIN_READERS:
        return None
    user = next((u for u in data.members if space_pseudonym(u, data.space_id, salt)[0] == person), None)
    lf = facts.get(lesson_id)
    if user is None or lf is None:
        return None
    seconds: dict[tuple[str, int], float] = defaultdict(float)
    for e in data.events:
        if e.user_id == user and e.type == "slide_view" and e.data.get("lectureId") == lesson_id:
            page = page_of(e, data)
            secs = e.data.get("duration_seconds")
            # Events are members' own inserts: a time that is no number of seconds counts for nothing
            # (the same rule `lesson_facts` reads a sitting by), rather than breaking the owner's view.
            if page is not None and isinstance(secs, (int, float)) and not isinstance(secs, bool) and secs > 0:
                seconds[(str(e.data.get("sessionId") or ""), page)] += float(secs)
    per_page: dict[int, float] = defaultdict(float)
    for (_session, page), secs in seconds.items():
        if secs <= DWELL_CEIL:
            per_page[page] += secs
    first: dict[int, list[bool]] = defaultdict(list)
    for t in first_tries(data):
        if t.user_id == user and t.lesson_id == lesson_id:
            first[t.page].append(t.correct)
    steps = []
    for page in range(1, _length(lf) + 1):
        pf = lf.pages.get(page)
        rating = pf.ratings.get(user) if pf else None
        steps.append({
            "page": page,
            "seconds": round(per_page.get(page, 0.0)),
            "foggy": None if rating is None else rating in ("unsure", "confused"),
            "firstTry": all(first[page]) if first.get(page) else None,
            "help": bool(pf and user in (pf.explain | pf.ask)),
        })
    return steps
