"""v4 on real data: the shapes the v4 namespace renders, read from the
existing product tables. Each function returns exactly the TypeScript type it
is named after in src/features/spaces/types.ts, so the frontend's live
repository is a thin transport and never reshapes."""
from __future__ import annotations

import asyncio
import re
from typing import Any, Dict, List, Optional
from uuid import UUID

from backend.core.config import settings
from backend.core.database import get_db_connection
from backend.services import materials_service
from backend.services.v4_personal import TITLE as PERSONAL_TITLE
from backend.services.v4_reader_service import POSTER_BUCKET, signed_pdf_url


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


async def create_space(user_id: str, name: str, description: Optional[str] = None) -> str:
    """Make a Space (a course) owned by the viewer, and return its id (LS-050).

    The same row the course manager's create makes — owner, title,
    description — so the two cannot drift. It starts as a draft (the column
    default) and empty, so only its owner sees it (see _SPACES_SQL) until it
    is published with something inside; nobody joins an empty room.
    """
    conn_cm = await get_db_connection()
    async with conn_cm as conn:
        new_id = await conn.fetchval(
            "INSERT INTO courses (professor_id, title, description) VALUES ($1::uuid, $2, $3) RETURNING id",
            user_id, name, description,
        )
    return str(new_id)


async def set_space_published(course_id: str, user_id: str, published: bool) -> Optional[str]:
    """Publish or unpublish a Space its owner made (LS-072). Returns the new status,
    or None when the viewer does not own it (the caller says "not found").

    Published is what the course manager's Publish sets. A published Space
    still shows to others only once it has a lecture to read (_SPACES_SQL).
    """
    conn_cm = await get_db_connection()
    async with conn_cm as conn:
        return await conn.fetchval(
            "UPDATE courses SET status = $3, updated_at = now() "
            "WHERE id = $1::uuid AND professor_id = $2::uuid RETURNING status",
            course_id, user_id, "published" if published else "draft",
        )


async def join_space(course_id: str, user_id: str) -> bool:
    """Enrol the viewer in an open Space. Idempotent.

    Open means exactly what /world offers as joinable: published, not
    archived, with at least one lecture to read. Anything else — a draft, an
    archived course, a course that does not exist — answers False, and the
    caller says "not found" rather than revealing which.
    """
    conn_cm = await get_db_connection()
    async with conn_cm as conn:
        joinable = await conn.fetchval(
            """
            SELECT EXISTS (
              SELECT 1 FROM courses c
              WHERE c.id = $1::uuid AND c.status = 'published'
                AND NOT COALESCE(c.is_archived, false)
                AND EXISTS (SELECT 1 FROM lectures l WHERE l.course_id = c.id
                            AND NOT COALESCE(l.is_archived, false)
                            AND COALESCE(l.visibility, 'course') = 'course'))
            """,
            course_id,
        )
        if not joinable:
            return False
        await conn.execute(
            "INSERT INTO course_enrollments (user_id, course_id) VALUES ($1::uuid, $2::uuid) "
            "ON CONFLICT (user_id, course_id) DO NOTHING",
            user_id, course_id,
        )
    return True


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
       -- The owner is a member of their own Space (as in the personal Space),
       -- whether or not they also hold an enrollment row.
       (SELECT count(*) FROM course_enrollments e
         WHERE e.course_id = v.id AND e.user_id IS DISTINCT FROM v.professor_id)
         + CASE WHEN v.professor_id IS NULL THEN 0 ELSE 1 END AS member_count,
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
SELECT l.id, l.course_id, l.title, l.created_at, l.professor_id, l.pdf_url, l.poster_url,
       COALESCE(l.total_slides, 0) AS total_slides,
       (SELECT count(*) FROM quiz_questions q JOIN slides s ON s.id = q.slide_id
         WHERE s.lecture_id = l.id) AS practice_count,
       sp.completed_slides, sp.completed_at, sp.id IS NOT NULL AS started,
       sp.last_slide_viewed, sp.updated_at AS read_at
FROM lectures l
LEFT JOIN student_progress sp ON sp.lecture_id = l.id AND sp.user_id = $1::uuid
WHERE NOT COALESCE(l.is_archived, false)
  AND (
    (l.course_id = ANY($2::uuid[]) AND COALESCE(l.visibility, 'course') = 'course')
    -- The viewer's own uploads: their personal Space (v4_personal).
    OR (l.course_id IS NULL AND l.student_owner_id = $1::uuid AND l.visibility = 'private_student')
  )
ORDER BY COALESCE(l.course_id, $1::uuid), l.created_at
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

# Faces for a Space's card: a few of the people learning there, newest first.
# Only for Spaces the viewer is in — the people they already share it with
# (the same circle as _SHARED_SQL). A Space you are only browsing shows its
# owner and a count, never strangers' faces.
_FACES_SQL = """
SELECT course_id, user_id, display_name, full_name, email, avatar_url FROM (
  SELECT e.course_id, p.user_id, p.display_name, p.full_name, p.email, p.avatar_url,
         row_number() OVER (PARTITION BY e.course_id ORDER BY e.created_at DESC NULLS LAST) AS n
  FROM course_enrollments e
  JOIN courses c ON c.id = e.course_id
  JOIN public.profiles p ON p.user_id = e.user_id
  WHERE e.course_id = ANY($2::uuid[])
    AND e.user_id <> $1::uuid AND e.user_id <> c.professor_id
) t
WHERE n <= 3
"""
_MAX_FACES = 3

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
            "SELECT user_id, display_name, full_name, email, avatar_url, current_streak, total_xp "
            "FROM public.profiles WHERE user_id = $1::uuid",
            user_id,
        )
        activity = await conn.fetch(_ACTIVITY_SQL, user_id, lecture_ids)
        joined_ids = [r["id"] for r in spaces if r["viewer_role"]]
        face_rows = await conn.fetch(_FACES_SQL, user_id, joined_ids) if joined_ids else []
        record = await _record(conn, user_id)
        social = await _social(conn, user_id)
        my_notes = await notes_for(conn, user_id)
        notes = await conn.fetch(
            "SELECT id, title, message, type, read, created_at FROM notifications "
            "WHERE user_id = $1::uuid ORDER BY created_at DESC LIMIT 30",
            user_id,
        )
        is_student = await conn.fetchval(
            "SELECT EXISTS (SELECT 1 FROM user_roles WHERE user_id = $1::uuid AND role = 'student')",
            user_id,
        )

    uploads_on = settings.feature_student_uploads
    uploads = await uploads_for(user_id) if uploads_on else []

    people = {r["user_id"]: _person(r) for r in people_rows}
    unknown = {"id": "unknown", "name": "Former member", "avatarUrl": None}
    viewer = _person(viewer_row) if viewer_row else None
    # A lesson's Space: its course, or — for an upload of your own — your personal Space.
    space_of = lambda r: str(r["course_id"] or user_id)  # noqa: E731

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
        sid = space_of(r)
        order[sid] = order.get(sid, 0) + 1
        pct = _percent(r["completed_slides"], r["completed_at"], r["total_slides"])
        author = (viewer if r["course_id"] is None else None) or people.get(r["professor_id"], unknown)
        lessons_out.append({
            "id": str(r["id"]),
            "spaceId": sid,
            "title": r["title"],
            "order": order[sid],
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

    faces: Dict[str, List[Dict[str, Any]]] = {}
    for r in face_rows:
        faces.setdefault(str(r["course_id"]), []).append(_person(r))

    rows_by_lesson = {str(r["id"]): r for r in lessons}
    # Each Space's cover is its first Lesson's page 1 — the poster, a small
    # WebP, never the PDF. Signed once per poster and cached for hours.
    first_poster: Dict[str, Optional[str]] = {}
    for l in lessons_out:
        if l["spaceId"] not in first_poster:
            first_poster[l["spaceId"]] = rows_by_lesson[l["id"]]["poster_url"]
    sids = list(first_poster)
    signed = await asyncio.gather(*(signed_pdf_url(first_poster[sid], POSTER_BUCKET) for sid in sids))
    covers = dict(zip(sids, signed))

    def last_place(mine: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """Where the viewer stopped reading in this Space: the most recently
        read Lesson they have not finished, and its page."""
        open_ = [
            (rows_by_lesson[l["id"]], l) for l in mine
            if l["progress"] == "in-progress" and rows_by_lesson[l["id"]]["read_at"]
        ]
        if not open_:
            return None
        row, lesson = max(open_, key=lambda p: p[0]["read_at"])
        return {
            "lessonId": lesson["id"],
            "lessonTitle": lesson["title"],
            "page": max(1, row["last_slide_viewed"] or 1),
        }

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
            "cover": covers.get(str(r["id"])),
            "faces": faces.get(str(r["id"]), [])[:_MAX_FACES],
            "lastPlace": last_place(mine) if r["viewer_role"] else None,
        })

    personal_lessons = [l for l in lessons_out if l["spaceId"] == user_id]
    personal = _personal_space(user_id, viewer, personal_lessons, uploads)
    if personal:
        personal.update({
            "cover": covers.get(user_id),
            "faces": [],
            "lastPlace": last_place(personal_lessons),
        })
        spaces_out.append(personal)

    return {
        "viewer": viewer,
        "spaces": spaces_out,
        "lessons": lessons_out,
        # What Home ranks: the lessons the viewer last touched, newest first.
        "activity": [{"lessonId": str(r["lecture_id"]), "at": r["at"].isoformat()} for r in activity],
        "streakDays": (viewer_row["current_streak"] or 0) if viewer_row else 0,
        # The XP ledger's running total (grant_xp keeps profiles.total_xp).
        "xp": (viewer_row["total_xp"] or 0) if viewer_row else 0,
        "notifications": [_notification(r) for r in notes],
        "record": record,
        "social": social,
        "notes": my_notes,
        # Files you brought in, newest first — the Library shelf (live).
        "uploads": uploads,
        # Students bring files in (FEATURE_STUDENT_UPLOADS); the endpoint enforces both.
        "canUpload": bool(uploads_on and is_student),
    }


# ── Your own uploads: the personal Space and the shelf ───────────────────────


_DONE = {"complete", "completed", "succeeded", "done"}
_FAILED = {"failed", "error", "cancelled"}


def reading_view(run: Dict[str, Any], slides_done: int, pdf_url: Optional[str]) -> Dict[str, Any]:
    """What the early reader needs: the file, and how far Luna has read it.

    The file is readable from the moment it is stored; the Lesson exists once
    the pipeline has made it. Progress is the slides written so far, capped at
    the page count; a finished run is fully read.
    """
    status = (run.get("status") or "").lower()
    pages = int(run.get("page_count") or 0)
    ready = bool(run.get("lecture_id")) and status in _DONE
    stage = "failed" if status in _FAILED else ("ready" if ready else "developing")
    read = pages if ready else min(max(0, int(slides_done)), pages)
    return {
        "pdfUrl": pdf_url,
        "pages": pages,
        "pagesRead": read,
        "stage": stage,
        "lessonId": str(run["lecture_id"]) if run.get("lecture_id") else None,
    }


async def early_reading(user_id: str, run_id: str) -> Optional[Dict[str, Any]]:
    """The caller's own run only; None for anything else (the route answers 404)."""
    from backend.services.v4_reader_service import signed_pdf_url

    async with await get_db_connection() as conn:
        run = await conn.fetchrow(
            "SELECT status, page_count, lecture_id, pdf_hash FROM parse_runs WHERE run_id = $1 AND user_id = $2",
            UUID(run_id),
            UUID(user_id),
        )
        if not run:
            return None
        done = 0
        if run["lecture_id"]:
            done = await conn.fetchval("SELECT count(*) FROM slides WHERE lecture_id = $1", run["lecture_id"]) or 0
    pdf_url = await signed_pdf_url(f"{run['pdf_hash']}.pdf", "pdf-uploads")
    return reading_view(dict(run), done, pdf_url)


async def uploads_for(user_id: str) -> List[Dict[str, Any]]:
    """Every private upload run, newest first, in the shelf's terms.

    A run is ``developing`` until the pipeline has made its lecture, ``failed``
    if it stopped, and ``ready`` once there is a lecture to open.
    """
    rows = await materials_service.list_my_materials(user_id)
    out: List[Dict[str, Any]] = []
    for r in rows:
        status = (r.get("status") or "").lower()
        failed = status in {"failed", "error", "cancelled"}
        ready = bool(r.get("lecture_id")) and status in {"complete", "completed", "succeeded", "done"}
        out.append({
            "id": r["run_id"],
            "lessonId": r.get("lecture_id"),
            "filename": r.get("filename") or r.get("title") or "Upload.pdf",
            "title": r.get("title"),
            "pageCount": r.get("total_slides") or 0,
            "stage": "failed" if failed else ("ready" if ready else "developing"),
            "addedAt": r["created_at"],
        })

    # Uploads older than run tagging have a lecture but no run of this
    # pipeline version: without these, the shelf was empty while the Space held
    # them. Each is ready, named by its lecture, keyed by its lecture id.
    seen = {u["lessonId"] for u in out if u["lessonId"]}
    conn_cm = await get_db_connection()
    async with conn_cm as conn:
        orphans = await conn.fetch(
            """
            SELECT l.id, l.title, COALESCE(l.total_slides, 0) AS total, l.created_at
            FROM lectures l
            WHERE l.student_owner_id = $1::uuid AND l.course_id IS NULL
              AND l.visibility = 'private_student' AND NOT COALESCE(l.is_archived, false)
            """,
            user_id,
        )
    for r in orphans:
        if str(r["id"]) in seen:
            continue
        out.append({
            "id": str(r["id"]),
            "lessonId": str(r["id"]),
            # The lecture's own name: its stored file is keyed by content hash.
            "filename": r["title"] or "Upload.pdf",
            "title": r["title"],
            "pageCount": r["total"],
            "stage": "ready",
            "addedAt": r["created_at"].isoformat(),
        })
    out.sort(key=lambda u: u["addedAt"], reverse=True)
    return out


async def remove_upload(user_id: str, upload_id: str) -> bool:
    """Take one of your uploads off your shelf, for good.

    A file that was read is its lecture: deleting that removes its slides,
    practice, progress and run with it (every reference cascades), while your
    notes on it stay, no longer anchored. A file that failed never became a
    lecture, so its run is what is forgotten. A file still being read is not
    removable — the pipeline would make its lecture after the fact.
    """
    if await materials_service.delete_material(user_id, upload_id):
        return True
    conn_cm = await get_db_connection()
    async with conn_cm as conn:
        result = await conn.execute(
            """
            DELETE FROM parse_runs
            WHERE run_id = $1::uuid AND user_id = $2::uuid AND pipeline_version = $3
              AND lecture_id IS NULL AND status IN ('failed', 'cancelled')
            """,
            upload_id, user_id, materials_service.STUDENT_PIPELINE_VERSION,
        )
    return result.split()[-1] != "0"


def _personal_space(
    user_id: str, viewer: Optional[Dict[str, Any]], mine: List[Dict[str, Any]], uploads: List[Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    """Your uploads as a Space you own — present once you have brought something in."""
    if not mine and not uploads:
        return None
    newest = max((u["addedAt"] for u in uploads), default=None) or max(
        (l["material"]["uploadedAt"] for l in mine if l["material"]), default=None
    )
    return {
        "id": user_id,
        "name": PERSONAL_TITLE,
        "shortCode": "MY",
        "description": "Files you brought in. Only you can see them.",
        "owner": viewer or {"id": user_id, "name": "You", "avatarUrl": None},
        "universe": None,
        "classification": {"domain": "", "subject": None},
        "mode": "guided",
        "visibility": "private",
        "state": "active",
        "groundingEnabled": False,
        "strictMode": False,
        "memberCount": 1,
        "starCount": 0,
        "starredByViewer": False,
        "viewerRole": "owner",
        "personal": True,
        "viewerProgress": round(sum(l["percentComplete"] for l in mine) / len(mine)) if mine else 0,
        "lessonCount": len(mine),
        "lessonsDone": sum(1 for l in mine if l["progress"] == "done"),
        "newSinceLastVisit": 0,
        "lastActiveAt": newest or "",
    }


# ── Social: friends, requests, the race ──────────────────────────────────────

# The people the viewer shares a Space with (owner or member, live courses).
_SHARED_SQL = """
WITH mine AS (
  SELECT c.id FROM courses c
  WHERE NOT COALESCE(c.is_archived, false)
    AND (c.professor_id = $1::uuid OR EXISTS (
         SELECT 1 FROM course_enrollments e WHERE e.course_id = c.id AND e.user_id = $1::uuid))
),
members AS (
  SELECT e.user_id, e.course_id FROM course_enrollments e JOIN mine m ON m.id = e.course_id
  UNION
  SELECT c.professor_id, c.id FROM courses c JOIN mine m ON m.id = c.id WHERE c.professor_id IS NOT NULL
)
SELECT user_id, array_agg(DISTINCT course_id::text) AS ids
FROM members WHERE user_id <> $1::uuid
GROUP BY user_id
"""

_FRIENDS_SQL = """
SELECT CASE WHEN requester_id = $1::uuid THEN addressee_id ELSE requester_id END AS user_id
FROM friend_requests
WHERE status = 'accepted' AND $1::uuid IN (requester_id, addressee_id)
"""

#: How many people the race shows, the viewer always among them.
_RACE_SIZE = 25


async def _social(conn: Any, user_id: str) -> Dict[str, Any]:
    shared_ids = {r["user_id"]: list(r["ids"]) for r in await conn.fetch(_SHARED_SQL, user_id)}
    shared = {uid: len(ids) for uid, ids in shared_ids.items()}
    friend_ids = {r["user_id"] for r in await conn.fetch(_FRIENDS_SQL, user_id)}
    request_ids = [
        r["requester_id"]
        for r in await conn.fetch(
            "SELECT requester_id FROM friend_requests WHERE addressee_id = $1::uuid AND status = 'pending' "
            "ORDER BY created_at DESC",
            user_id,
        )
    ]
    # Test, seed and staff accounts never race real students — but a friend
    # you chose is shown whatever their account. The classification arrives
    # with migration 20261013000000 (PR #92); before it, everyone races.
    classified = await conn.fetchval("SELECT to_regclass('public.account_classification') IS NOT NULL")
    internal = (
        "(SELECT a.is_internal FROM account_classification a WHERE a.user_id = p.user_id)"
        if classified else "false"
    )
    racers = await conn.fetch(
        f"""
        SELECT p.user_id, p.display_name, p.full_name, p.email, p.avatar_url, COALESCE(p.total_xp, 0) AS xp
        FROM profiles p
        WHERE p.user_id = ANY($1::uuid[])
          AND (p.user_id = ANY($2::uuid[]) OR NOT COALESCE({internal}, false))
        ORDER BY xp DESC
        LIMIT {_RACE_SIZE - 1}
        """,
        list({*shared, *friend_ids}), list(friend_ids),
    )
    me = await conn.fetchrow(
        "SELECT user_id, display_name, full_name, email, avatar_url, COALESCE(total_xp, 0) AS xp "
        "FROM profiles WHERE user_id = $1::uuid",
        user_id,
    )
    # Your own row counts the Spaces you are in, not ones "shared with" you.
    my_spaces = await conn.fetchval(
        "SELECT count(*) FROM courses c WHERE NOT COALESCE(c.is_archived, false) AND (c.professor_id = $1::uuid "
        "OR EXISTS (SELECT 1 FROM course_enrollments e WHERE e.course_id = c.id AND e.user_id = $1::uuid))",
        user_id,
    )
    people = {
        r["user_id"]: _person(r)
        for r in await conn.fetch(
            "SELECT user_id, display_name, full_name, email, avatar_url FROM profiles WHERE user_id = ANY($1::uuid[])",
            list({*friend_ids, *request_ids}),
        )
    }

    race = [
        {"person": _person(r), "xp": r["xp"], "sharedSpaces": shared.get(r["user_id"], 0), "isViewer": False}
        for r in racers
    ]
    if me:
        race.append({"person": _person(me), "xp": me["xp"], "sharedSpaces": my_spaces, "isViewer": True})
    # By XP; on a tie the viewer sits below, so a tie is never shown as a lead.
    race.sort(key=lambda r: (-r["xp"], r["isViewer"]))

    return {
        "leaderboard": race,
        "friends": [people[i] for i in friend_ids if i in people],
        "requests": [{"person": people[i], "sharedSpaces": shared.get(i, 0)} for i in request_ids if i in people],
        # The Spaces you share with each person shown anywhere above, by id —
        # a person's page names them, so a count is not enough.
        "sharedSpaceIds": {str(uid): ids for uid, ids in shared_ids.items()},
    }


async def answer_friend_request(user_id: str, requester_id: str, accept: bool) -> bool:
    """Accept or decline a pending request addressed to the viewer. False if there was none."""
    conn_cm = await get_db_connection()
    async with conn_cm as conn:
        result = await conn.execute(
            "UPDATE friend_requests SET status = $3, responded_at = now() "
            "WHERE addressee_id = $1::uuid AND requester_id = $2::uuid AND status = 'pending'",
            user_id, requester_id, "accepted" if accept else "declined",
        )
    return result == "UPDATE 1"


# ── The viewer's record: study days, the XP ledger, Moments ──────────────────

_STUDY_DAYS_SQL = """
SELECT (created_at AT TIME ZONE 'utc')::date AS day,
       count(*) FILTER (WHERE event_type = 'slide_view') AS pages,
       count(*) FILTER (WHERE event_type IN ('quiz_attempt', 'micro_quiz_attempt')) AS answered,
       count(*) FILTER (WHERE event_type IN ('quiz_attempt', 'micro_quiz_attempt')
                          AND (event_data->>'correct')::boolean) AS right_answers,
       count(*) FILTER (WHERE event_type = 'lecture_complete') AS finished
FROM learning_events
WHERE user_id = $1::uuid
  AND event_type IN ('slide_view', 'quiz_attempt', 'micro_quiz_attempt', 'lecture_complete')
GROUP BY 1
ORDER BY 1 DESC
LIMIT 120
"""


def _day_summary(r: Any) -> str:
    """One line, in the student's terms: what that day held."""
    parts = []
    if r["finished"]:
        parts.append("Finished a Lesson" if r["finished"] == 1 else f"Finished {r['finished']} Lessons")
    if r["pages"]:
        parts.append(f"Read {r['pages']} page{'s' if r['pages'] != 1 else ''}")
    if r["answered"]:
        noun = "question" if r["answered"] == 1 else "questions"
        parts.append(f"{r['right_answers']} of {r['answered']} {noun} right")
    return " · ".join(parts)


def _xp_source(reason: Optional[str]) -> tuple[str, str]:
    """An xp_events reason as a v4 XP source and a label."""
    reason = reason or ""
    if reason.startswith("badge:"):
        return "milestone", f"Earned “{reason.split(':', 1)[1]}”"
    if reason == "course_created":
        return "milestone", "Made a Space"
    if reason == "lecture_complete":
        return "learning", "Finished a Lesson"
    if reason == "quiz_correct":
        return "learning", "Answered a question right"
    return "learning", "Learning"


async def _record(conn: Any, user_id: str) -> Dict[str, Any]:
    days = await conn.fetch(_STUDY_DAYS_SQL, user_id)
    xp = await conn.fetch(
        "SELECT id, xp, reason, created_at FROM xp_events WHERE user_id = $1::uuid "
        "ORDER BY created_at DESC LIMIT 200",
        user_id,
    )
    earned = await conn.fetch(
        "SELECT id, badge_name, badge_description, earned_at FROM achievements "
        "WHERE user_id = $1::uuid ORDER BY earned_at",
        user_id,
    )
    xp_events = []
    for r in xp:
        source, label = _xp_source(r["reason"])
        xp_events.append({
            "id": str(r["id"]), "source": source, "label": label, "spaceName": None,
            "amount": r["xp"], "at": r["created_at"].isoformat(),
        })
    return {
        "studyDays": [{"date": r["day"].isoformat(), "summary": _day_summary(r)} for r in days],
        "xpEvents": xp_events,
        # A Moment is the first time something happened — exactly what an
        # earned achievement records. Oldest first, as the fixtures are.
        "moments": [
            {"id": str(r["id"]), "title": r["badge_name"], "detail": r["badge_description"] or "",
             "at": r["earned_at"].isoformat() if r["earned_at"] else None}
            for r in earned
        ],
    }


# The kinds the v4 panel draws. The engine's level_up is an achievement there.
_KINDS = {"endorsed", "promoted", "liked", "new_lessons", "friend_request", "achievement", "streak"}


def _notification(r: Any) -> Dict[str, Any]:
    kind = r["type"] if r["type"] in _KINDS else "achievement"
    return {
        "id": str(r["id"]),
        "title": r["title"] or "",
        "message": r["message"] or "",
        "type": kind,
        "read": bool(r["read"]),
        "created_at": r["created_at"].isoformat(),
        # Achievements, level-ups and streaks are about you: they open Profile.
        "target": {"kind": "profile"},
    }


async def ask(user_id: str, question: str, space_id: Optional[str]) -> Dict[str, Any]:
    """Home's ask bar: the grounded course tutor, in the Space you are working in.

    The Space is the one asked about if you are in it, else the one you last
    read in, else any Space you are in. The tutor answers only from that
    course's slides and says so when they do not cover the question; its
    `[Source N]` citations come back as Lesson pages to open.
    """
    from backend.services.search_service import ask_course

    conn_cm = await get_db_connection()
    async with conn_cm as conn:
        mine = await conn.fetch(
            """
            SELECT c.id::text AS id, c.title,
                   (SELECT max(v.visited_at) FROM lecture_visits v
                     WHERE v.user_id = $1::uuid AND v.course_id = c.id) AS last_read
            FROM courses c
            WHERE NOT COALESCE(c.is_archived, false)
              AND (c.professor_id = $1::uuid OR EXISTS (
                   SELECT 1 FROM course_enrollments e WHERE e.course_id = c.id AND e.user_id = $1::uuid))
            ORDER BY last_read DESC NULLS LAST, c.title
            """,
            user_id,
        )
    if not mine:
        return {"reply": "Join a Space first — I answer from the material in the Spaces you are in.",
                "grounded": False, "citations": [], "spaceId": None, "spaceName": None}
    chosen = next((m for m in mine if m["id"] == space_id), mine[0])

    result = await ask_course(user_id, False, chosen["id"], question, ai_model="auto")
    citations = [
        {
            "lessonId": str(c["lecture_id"]),
            "lessonTitle": c.get("lecture_title"),
            "page": int(c["slide_index"]) + 1,
        }
        for c in result.get("citations", [])
        if c.get("lecture_id") is not None and c.get("slide_index") is not None
    ]
    return {
        "reply": result.get("reply", ""),
        "grounded": bool(result.get("grounded")),
        "citations": citations,
        "spaceId": chosen["id"],
        "spaceName": chosen["title"],
        "budgetExceeded": bool(result.get("budget_exceeded")),
    }


async def mark_notifications_read(user_id: str) -> int:
    conn_cm = await get_db_connection()
    async with conn_cm as conn:
        result = await conn.execute(
            "UPDATE notifications SET read = true WHERE user_id = $1::uuid AND NOT read", user_id,
        )
    return int(result.split()[-1]) if result else 0


# ── Notes: private, anchored, outliving their anchor ─────────────────────────

# The live names win while the anchor exists; the remembered ones after.
_NOTE_SELECT = """
SELECT n.id, n.user_id, n.body, n.lecture_id, n.course_id, n.updated_at,
       COALESCE(l.title, n.lesson_title) AS lesson_title,
       COALESCE(c.title, n.space_name) AS space_name
FROM {source} n
LEFT JOIN lectures l ON l.id = n.lecture_id
LEFT JOIN courses c ON c.id = n.course_id
"""


def _note(r: Any) -> Dict[str, Any]:
    """notes row → v4 Note. A gone anchor reads as empty, never as a sentence."""
    return {
        "id": str(r["id"]),
        "authorId": str(r["user_id"]),
        "body": r["body"],
        "lessonId": str(r["lecture_id"]) if r["lecture_id"] else "",
        "lessonTitle": r["lesson_title"] or "",
        "spaceId": str(r["course_id"]) if r["course_id"] else "",
        "spaceName": r["space_name"] or "",
        "updatedAt": r["updated_at"].isoformat(),
    }


async def notes_for(conn: Any, user_id: str) -> List[Dict[str, Any]]:
    if not await conn.fetchval("SELECT to_regclass('public.notes') IS NOT NULL"):
        return []  # migration 20261014010000 not applied yet
    rows = await conn.fetch(
        _NOTE_SELECT.format(source="notes")
        + " WHERE n.user_id = $1::uuid ORDER BY n.updated_at DESC LIMIT 500",
        user_id,
    )
    return [_note(r) for r in rows]


async def add_note(user_id: str, body: str, lesson_id: Optional[str]) -> Dict[str, Any]:
    """Write a note, anchored to a Lesson the viewer can open — or to nothing.

    The names it keeps come from the database at write time, never from the
    client: they are what the note will show if its Lesson is later deleted.
    Raises LookupError for a Lesson the viewer cannot open.
    """
    conn_cm = await get_db_connection()
    async with conn_cm as conn:
        lecture = None
        if lesson_id:
            lecture = await conn.fetchrow(
                """
                SELECT l.id, l.title, c.id AS course_id, c.title AS course_title
                FROM lectures l LEFT JOIN courses c ON c.id = l.course_id
                WHERE l.id = $1::uuid AND (
                  c.professor_id = $2::uuid OR l.student_owner_id = $2::uuid OR EXISTS (
                    SELECT 1 FROM course_enrollments e WHERE e.course_id = c.id AND e.user_id = $2::uuid))
                """,
                lesson_id, user_id,
            )
            if lecture is None:
                raise LookupError("lesson")
        row = await conn.fetchrow(
            "WITH ins AS (INSERT INTO notes (user_id, lecture_id, course_id, lesson_title, space_name, body) "
            "VALUES ($1::uuid, $2, $3, $4, $5, $6) RETURNING *) " + _NOTE_SELECT.format(source="ins"),
            user_id,
            lecture["id"] if lecture else None,
            lecture["course_id"] if lecture else None,
            lecture["title"] if lecture else "",
            (lecture["course_title"] or "") if lecture else "",
            body.strip(),
        )
    return _note(row)


async def update_note(user_id: str, note_id: str, body: str) -> Optional[Dict[str, Any]]:
    """Edit your own note in place; None if it is not yours or not there."""
    conn_cm = await get_db_connection()
    async with conn_cm as conn:
        row = await conn.fetchrow(
            "WITH upd AS (UPDATE notes SET body = $3, updated_at = now() "
            "WHERE id = $2::uuid AND user_id = $1::uuid RETURNING *) " + _NOTE_SELECT.format(source="upd"),
            user_id, note_id, body.strip(),
        )
    return _note(row) if row else None


async def delete_note(user_id: str, note_id: str) -> bool:
    conn_cm = await get_db_connection()
    async with conn_cm as conn:
        result = await conn.execute(
            "DELETE FROM notes WHERE id = $2::uuid AND user_id = $1::uuid", user_id, note_id,
        )
    return result == "DELETE 1"
