"""v4 on real data: the shapes the v4 namespace renders, read from the
existing product tables. Each function returns exactly the TypeScript type it
is named after in src/features/spaces/types.ts, so the frontend's live
repository is a thin transport and never reshapes."""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from backend.core.database import get_db_connection


def _person(row: Any) -> Dict[str, Any]:
    """profiles row → Person. Content is never anonymous, so a missing name
    falls back to the email's local part rather than to nothing."""
    name = (row["display_name"] or row["full_name"] or "").strip()
    if not name and row["email"]:
        name = row["email"].split("@", 1)[0]
    return {"id": str(row["user_id"]), "name": name or "Learner", "avatarUrl": row["avatar_url"]}


async def get_person(user_id: str) -> Optional[Dict[str, Any]]:
    conn_cm = await get_db_connection()
    async with conn_cm as conn:
        row = await conn.fetchrow(
            "SELECT user_id, display_name, full_name, email, avatar_url "
            "FROM public.profiles WHERE user_id = $1::uuid",
            user_id,
        )
    return _person(row) if row else None


# ── The viewer's world: Spaces and their Lessons ─────────────────────────────
#
# A course is a Space, a lecture is a Lesson (the reader already reads them
# that way). One round trip loads everything the core loop renders, so the
# frontend can keep answering `spaceById(id)` synchronously, exactly as it
# does over the fixtures. Lesson *content* still loads per lesson (reader).

# Courses the viewer can see: theirs, joined, or open to join. A course is open
# when it is published, not archived, and has at least one lecture to read.
_SPACES_SQL = """
WITH visible AS (
  SELECT c.*,
    CASE WHEN c.professor_id = $1::uuid THEN 'owner'
         WHEN EXISTS (SELECT 1 FROM course_enrollments e
                      WHERE e.course_id = c.id AND e.user_id = $1::uuid) THEN 'member'
    END AS viewer_role
  FROM courses c
)
SELECT v.id, v.title, v.description, v.is_archived, v.status, v.updated_at, v.created_at,
       v.professor_id, v.viewer_role,
       (SELECT count(*) FROM course_enrollments e WHERE e.course_id = v.id) AS member_count,
       (SELECT last_visited_at FROM course_visits cv
         WHERE cv.course_id = v.id AND cv.user_id = $1::uuid) AS last_visit
FROM visible v
WHERE v.viewer_role IS NOT NULL
   OR (v.status = 'published' AND NOT COALESCE(v.is_archived, false)
       AND EXISTS (SELECT 1 FROM lectures l WHERE l.course_id = v.id
                   AND NOT COALESCE(l.is_archived, false)
                   AND COALESCE(l.visibility, 'course') = 'course'))
"""

_LESSONS_SQL = """
SELECT l.id, l.course_id, l.title, l.created_at, l.professor_id, l.pdf_url,
       COALESCE(l.total_slides, 0) AS total_slides,
       (SELECT count(*) FROM quiz_questions q JOIN slides s ON s.id = q.slide_id
         WHERE s.lecture_id = l.id) AS practice_count,
       sp.completed_slides, sp.completed_at, sp.id IS NOT NULL AS started
FROM lectures l
LEFT JOIN student_progress sp ON sp.lecture_id = l.id AND sp.user_id = $1::uuid
WHERE l.course_id = ANY($2::uuid[])
  AND NOT COALESCE(l.is_archived, false)
  AND COALESCE(l.visibility, 'course') = 'course'
ORDER BY l.course_id, l.created_at
"""

_CONCEPTS_SQL = """
SELECT cl.lecture_id, c.id, c.canonical_name, cl.weight,
       cm.attempts, cm.mastery_score
FROM concept_lectures cl
JOIN concepts c ON c.id = cl.concept_id
LEFT JOIN concept_mastery cm ON cm.concept_id = c.id AND cm.user_id = $1::uuid
WHERE cl.lecture_id = ANY($2::uuid[])
ORDER BY cl.lecture_id, cl.weight DESC NULLS LAST, c.canonical_name
"""

# The last time the viewer touched each visible lecture — progress saved or
# lecture opened, whichever is later. Home's "continue" and "recent" read this.
_ACTIVITY_SQL = """
SELECT lecture_id, max(at) AS at FROM (
  SELECT lecture_id, updated_at AS at FROM student_progress
   WHERE user_id = $1::uuid AND lecture_id = ANY($2::uuid[]) AND updated_at IS NOT NULL
  UNION ALL
  SELECT lecture_id, visited_at FROM lecture_visits
   WHERE user_id = $1::uuid AND lecture_id = ANY($2::uuid[])
) t
GROUP BY lecture_id
ORDER BY at DESC
LIMIT 20
"""

# A lesson shows its strongest ideas, not every tag the graph collected.
_MAX_CONCEPTS = 12
_CLEARED_AT = 0.8


def short_code(title: str, filenames: Optional[List[str]] = None) -> str:
    """The tile watermark.

    Courses carry no code, but their uploads usually do: every Datenbanksysteme
    deck is "NN DBS <topic>.pdf". An all-caps 2–5 letter token found in at least
    half of a course's file names (and at least two) is the name people use.
    Otherwise: initials of a multi-word title ("Advanced Topics in Cryptology"
    → "ATC"), or a short title as-is ("NPW").
    """
    names = [n for n in (filenames or []) if n]
    if len(names) >= 2:
        counts: Dict[str, int] = {}
        for n in names:
            for tok in set(re.split(r"[^A-Za-z]+", n.rsplit(".", 1)[0])):
                if re.fullmatch(r"[A-Z]{2,5}", tok):
                    counts[tok] = counts.get(tok, 0) + 1
        best = max(counts.items(), key=lambda kv: kv[1], default=None)
        if best and best[1] >= max(2, len(names) / 2):
            return best[0]
    small = {"und", "and", "der", "die", "das", "of", "the", "zur", "zum", "für", "for", "in"}
    words = [w for w in title.replace("-", " ").split() if w and w.lower() not in small]
    if len(words) >= 2:
        return "".join(w[0] for w in words[:4]).upper()
    word = words[0] if words else title
    return word.upper() if len(word) <= 4 else word[:3].upper()


def _percent(completed_slides: Any, completed_at: Any, total: int) -> int:
    if completed_at is not None:
        return 100
    if not total or not completed_slides:
        return 0
    return min(100, round(len(set(completed_slides)) / total * 100))


def _concept_progress(attempts: Any, score: Any) -> str:
    if score is not None and score >= _CLEARED_AT:
        return "cleared"
    return "discovered" if attempts else "untouched"


async def get_world(user_id: str) -> Dict[str, Any]:
    conn_cm = await get_db_connection()
    async with conn_cm as conn:
        spaces = await conn.fetch(_SPACES_SQL, user_id)
        course_ids = [r["id"] for r in spaces]
        lessons = await conn.fetch(_LESSONS_SQL, user_id, course_ids)
        lecture_ids = [r["id"] for r in lessons]
        concepts = await conn.fetch(_CONCEPTS_SQL, user_id, lecture_ids)
        author_ids = {r["professor_id"] for r in [*spaces, *lessons] if r["professor_id"]}
        people_rows = await conn.fetch(
            "SELECT user_id, display_name, full_name, email, avatar_url "
            "FROM public.profiles WHERE user_id = ANY($1::uuid[])",
            list(author_ids),
        )
        viewer_row = await conn.fetchrow(
            "SELECT user_id, display_name, full_name, email, avatar_url, current_streak "
            "FROM public.profiles WHERE user_id = $1::uuid",
            user_id,
        )
        activity = await conn.fetch(_ACTIVITY_SQL, user_id, lecture_ids)

    people = {r["user_id"]: _person(r) for r in people_rows}
    unknown = {"id": "unknown", "name": "Former member", "avatarUrl": None}

    concepts_by_lesson: Dict[Any, List[Dict[str, Any]]] = {}
    for r in concepts:
        bucket = concepts_by_lesson.setdefault(r["lecture_id"], [])
        if len(bucket) < _MAX_CONCEPTS:
            bucket.append({
                "id": str(r["id"]),
                "name": r["canonical_name"],
                "progress": _concept_progress(r["attempts"], r["mastery_score"]),
            })

    lessons_out: List[Dict[str, Any]] = []
    order: Dict[Any, int] = {}
    for r in lessons:
        order[r["course_id"]] = order.get(r["course_id"], 0) + 1
        pct = _percent(r["completed_slides"], r["completed_at"], r["total_slides"])
        author = people.get(r["professor_id"], unknown)
        lessons_out.append({
            "id": str(r["id"]),
            "spaceId": str(r["course_id"]),
            "title": r["title"],
            "order": order[r["course_id"]],
            "state": "published",
            "origin": "official",
            "author": author,
            "grounding": None,
            "progress": "done" if pct == 100 else ("in-progress" if r["started"] else "not-started"),
            "percentComplete": pct,
            "concepts": concepts_by_lesson.get(r["id"], []),
            "material": {
                "id": str(r["id"]),
                "filename": (r["pdf_url"] or "").rsplit("/", 1)[-1] or f"{r['title']}.pdf",
                "sizeBytes": 0,
                "uploadedBy": author,
                "uploadedAt": r["created_at"].isoformat(),
                "sourceRemoved": not r["pdf_url"],
            } if r["pdf_url"] else None,
            "contributionCount": 0,
            "practiceCount": r["practice_count"],
        })

    spaces_out: List[Dict[str, Any]] = []
    for r in spaces:
        mine = [l for l in lessons_out if l["spaceId"] == str(r["id"])]
        newest = max((l["material"]["uploadedAt"] for l in mine if l["material"]), default=None)
        last_visit = r["last_visit"]
        new_since = sum(
            1 for l, row in zip(lessons_out, lessons)
            if l["spaceId"] == str(r["id"]) and last_visit and row["created_at"] > last_visit
        )
        last_active = max(
            [t for t in (
                last_visit.isoformat() if last_visit else None,
                newest,
                r["updated_at"].isoformat() if r["updated_at"] else None,
                r["created_at"].isoformat(),
            ) if t]
        )
        spaces_out.append({
            "id": str(r["id"]),
            "name": r["title"],
            "shortCode": short_code(r["title"], [
                l["material"]["filename"] for l in mine if l["material"]
            ]),
            "description": r["description"],
            "owner": people.get(r["professor_id"], unknown),
            "universe": None,
            "classification": {"domain": "", "subject": None},
            "mode": "guided",
            "visibility": "public" if r["status"] == "published" else "private",
            "state": "archived" if r["is_archived"] else "active",
            "groundingEnabled": False,
            "strictMode": False,
            "memberCount": r["member_count"],
            "starCount": 0,
            "starredByViewer": False,
            "viewerRole": r["viewer_role"],
            # Same definition as the fixtures' progressAcross: the mean of the path.
            "viewerProgress": round(sum(l["percentComplete"] for l in mine) / len(mine)) if mine else 0,
            "lessonCount": len(mine),
            "lessonsDone": sum(1 for l in mine if l["progress"] == "done"),
            "newSinceLastVisit": new_since,
            "lastActiveAt": last_active,
        })

    return {
        "viewer": _person(viewer_row) if viewer_row else None,
        "spaces": spaces_out,
        "lessons": lessons_out,
        # What Home ranks: the lessons the viewer last touched, newest first.
        "activity": [{"lessonId": str(r["lecture_id"]), "at": r["at"].isoformat()} for r in activity],
        "streakDays": (viewer_row["current_streak"] or 0) if viewer_row else 0,
    }
