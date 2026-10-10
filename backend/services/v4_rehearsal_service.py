"""Exam rehearsal: a short mixed test written from a course's own slides.

The model writes the questions; it does not get the last word on the
answers. Every tool question (which FDs hold on a table, an attribute
closure, which FDs violate BCNF) is graded on the client by *computing* the
answer, and this module refuses a tool question whose computed answer would
be trivial or empty. Multiple choice and ordering are taken from the slides
and checked for shape: exactly one correct option, distinct items.

Every question names the lecture and page it came from, so a wrong answer
is one press away from the page that teaches it.
"""
from __future__ import annotations

import logging
import random
from typing import Annotated, Any, Literal, Optional, Union
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, Field, TypeAdapter, ValidationError

from backend.core.database import get_db_connection
from backend.services.localization_service import get_lecture_content_for_locale
from backend.services.v4_reader_service import IDEAS_VERSION, _generate_json
from backend.services.cache import get_cache

logger = logging.getLogger(__name__)

MAX_SLIDES_PER_LECTURE = 14
SLIDE_TEXT_CHARS = 280


# ─── FD arithmetic, the same as `iui/fd.ts` ──────────────────────────────


def _closure(start: set[str], fds: list[tuple[set[str], set[str]]]) -> set[str]:
    out = set(start)
    changed = True
    while changed:
        changed = False
        for lhs, rhs in fds:
            if lhs <= out and not rhs <= out:
                out |= rhs
                changed = True
    return out


def _holds(columns: list[str], rows: list[list[str]], lhs: list[str], rhs: list[str]) -> bool:
    li = [columns.index(a) for a in lhs]
    ri = [columns.index(a) for a in rhs]
    norm = lambda v: v.strip().lower()  # noqa: E731
    for a in range(len(rows)):
        for b in range(a + 1, len(rows)):
            if all(norm(rows[a][i]) == norm(rows[b][i]) for i in li) and not all(
                norm(rows[a][i]) == norm(rows[b][i]) for i in ri
            ):
                return False
    return True


# ─── the questions ───────────────────────────────────────────────────────


class FD(BaseModel):
    lhs: list[str] = Field(min_length=1, max_length=5)
    rhs: list[str] = Field(min_length=1, max_length=5)


class _Base(BaseModel):
    lecture_id: UUID
    page: int = Field(ge=1, le=2000)
    idea: str = Field(min_length=1, max_length=60)
    prompt: str = Field(min_length=4, max_length=320)
    why: str = Field(default="", max_length=500)


class Option(BaseModel):
    text: str = Field(min_length=1, max_length=200)
    correct: Optional[bool] = None


class ChoiceQ(_Base):
    kind: Literal["choice"]
    options: list[Option] = Field(min_length=2, max_length=5)


class OrderQ(_Base):
    kind: Literal["order"]
    items: list[str] = Field(min_length=3, max_length=6)


class FdHoldsQ(_Base):
    kind: Literal["fdHolds"]
    columns: list[str] = Field(min_length=2, max_length=5)
    rows: list[list[str]] = Field(min_length=3, max_length=7)
    candidates: list[FD] = Field(min_length=2, max_length=4)


class ClosureQ(_Base):
    kind: Literal["closure"]
    attrs: list[str] = Field(min_length=3, max_length=7)
    fds: list[FD] = Field(min_length=2, max_length=6)
    start: list[str] = Field(min_length=1, max_length=4)


class BcnfQ(_Base):
    kind: Literal["bcnf"]
    relation: str = Field(default="R", max_length=30)
    attrs: list[str] = Field(min_length=3, max_length=7)
    fds: list[FD] = Field(min_length=2, max_length=5)


Question = Annotated[Union[ChoiceQ, OrderQ, FdHoldsQ, ClosureQ, BcnfQ], Field(discriminator="kind")]
_question = TypeAdapter(Question)


def _gradable(q: BaseModel) -> bool:
    """A question earns its place only if its answer is well-defined and not trivial."""
    if isinstance(q, ChoiceQ):
        return sum(1 for o in q.options if o.correct) == 1 and len({o.text.strip().lower() for o in q.options}) == len(q.options)
    if isinstance(q, OrderQ):
        return len({i.strip().lower() for i in q.items}) == len(q.items)
    if isinstance(q, FdHoldsQ):
        cols = set(q.columns)
        if any(len(r) != len(q.columns) for r in q.rows):
            return False
        if not all(set(f.lhs + f.rhs) <= cols for f in q.candidates):
            return False
        verdicts = [_holds(q.columns, q.rows, f.lhs, f.rhs) for f in q.candidates]
        return any(verdicts) and not all(verdicts)  # something holds, something does not
    if isinstance(q, ClosureQ):
        attrs = set(q.attrs)
        if not set(q.start) <= attrs or not all(set(f.lhs + f.rhs) <= attrs for f in q.fds):
            return False
        result = _closure(set(q.start), [(set(f.lhs), set(f.rhs)) for f in q.fds])
        return result != set(q.start)  # at least one FD must fire
    if isinstance(q, BcnfQ):
        attrs = set(q.attrs)
        if not all(set(f.lhs + f.rhs) <= attrs for f in q.fds):
            return False
        pairs = [(set(f.lhs), set(f.rhs)) for f in q.fds]
        violating = [f for f in q.fds if not set(f.rhs) <= set(f.lhs) and _closure(set(f.lhs), pairs) != attrs]
        return 0 < len(violating) < len(q.fds) or len(q.fds) == 1
    return False


def validate_rehearsal(data: Any, allowed: dict[str, int]) -> list[dict[str, Any]]:
    """The questions that parse, point at a real page of a chosen lecture, and can be graded."""
    if not isinstance(data, dict):
        return []
    out: list[dict[str, Any]] = []
    for raw in data.get("questions") or []:
        try:
            q = _question.validate_python(raw)
        except ValidationError:
            continue
        lid = str(q.lecture_id)
        if lid not in allowed or q.page > allowed[lid]:
            continue
        if _gradable(q):
            out.append(q.model_dump(mode="json", exclude_none=True))
    return out


# ─── composing ───────────────────────────────────────────────────────────

PROMPT = """You are writing an exam rehearsal for a university course, from its own slides.
Write exactly {count} questions that test understanding, not recall of wording,
spread across the lectures below{weak}. Mix the kinds: mostly "choice", some
"order", and — only for lectures that teach them — the database-theory tools.

Course: {course}
{context}

Every question has: "lecture_id" (from the list), "page" (the slide it tests),
"idea" (2-5 words), "prompt" (the question), "why" (1-2 sentences: the reason,
shown after answering). Kinds:
- {{"kind":"choice","options":[{{"text":"...","correct":true}},{{"text":"..."}},{{"text":"..."}},{{"text":"..."}}]}}
  exactly one correct; distractors must be plausible mistakes a student makes.
- {{"kind":"order","items":["first","second","third","fourth"]}}  items in the CORRECT order
  (they will be shuffled); for processes, algorithms, phases.
- {{"kind":"fdHolds","columns":["A","B","C"],"rows":[["..","..",".."],...],"candidates":[{{"lhs":["A"],"rhs":["B"]}},...]}}
  prompt asks which candidate FDs hold on this data; 4-6 concrete rows; at least
  one candidate must hold and at least one must be broken by the rows.
- {{"kind":"closure","attrs":["A","B","C","D","E"],"fds":[{{"lhs":["A"],"rhs":["B"]}},...],"start":["A"]}}
  prompt asks for the closure of start; at least two FDs should fire.
- {{"kind":"bcnf","relation":"R","attrs":["..."],"fds":[{{"lhs":["..."],"rhs":["..."]}},...]}}
  prompt asks which FDs violate BCNF in R; at least one must, at least one must not.

Write in {language}. Be correct.
Answer with ONE JSON object only: {{"title":"a short name for this rehearsal","questions":[...]}}"""


async def _lecture_context(lecture: dict[str, Any], locale: str) -> tuple[str, int]:
    content, _ = await get_lecture_content_for_locale(UUID(lecture["id"]), locale)
    slides = (content or {}).get("slides") or []
    if not slides:
        return "", 0
    ideas = await get_cache(f"v4reader:{IDEAS_VERSION}:{lecture['id']}:{lecture['content_revision']}")
    idea_line = (
        "Ideas: " + "; ".join(f"{i['name']} (from p{min(i['slide_indices']) + 1})" for i in ideas)
        if isinstance(ideas, list)
        else ""
    )
    # Evenly spaced pages with real text: a fair sample of the whole deck.
    texty = [s for s in slides if len((s.get("content_text") or "").strip()) > 60]
    step = max(1, len(texty) // MAX_SLIDES_PER_LECTURE)
    sample = texty[::step][:MAX_SLIDES_PER_LECTURE]
    pages = "\n".join(
        f"  p{s.get('slide_number')}: {(s.get('title') or '').strip()[:70]} — "
        f"{' '.join((s.get('content_text') or '').split())[:SLIDE_TEXT_CHARS]}"
        for s in sample
    )
    return (
        f'\nLecture "{lecture["title"]}" — lecture_id {lecture["id"]}, {len(slides)} pages\n{idea_line}\n{pages}',
        len(slides),
    )


async def compose_rehearsal(
    course_id: UUID,
    lecture_ids: list[UUID],
    count: int,
    *,
    weak_ideas: list[str],
    user_id: str,
    locale: str,
) -> dict[str, Any]:
    async with await get_db_connection() as conn:
        course_title = await conn.fetchval("SELECT title FROM courses WHERE id = $1", course_id)
        rows = await conn.fetch(
            """SELECT id, title, content_revision FROM lectures
               WHERE course_id = $1 AND id = ANY($2::uuid[]) AND COALESCE(is_archived, false) = false
               ORDER BY created_at""",
            course_id,
            lecture_ids,
        )
    if not rows:
        raise HTTPException(status_code=404, detail="None of those lectures are in this course.")
    lectures = [{"id": str(r["id"]), "title": r["title"], "content_revision": r["content_revision"]} for r in rows]

    parts, allowed = [], {}
    for lec in lectures:
        text, pages = await _lecture_context(lec, locale)
        if pages:
            parts.append(text)
            allowed[lec["id"]] = pages
    if not allowed:
        raise HTTPException(status_code=409, detail="These lectures have no text to rehearse from yet.")

    prompt = PROMPT.format(
        count=count,
        weak=(f", focusing on these ideas the student got wrong last time: {', '.join(weak_ideas[:8])}" if weak_ideas else ""),
        course=course_title or "",
        context="\n".join(parts),
        language="German" if locale == "de" else "English",
    )
    # Gemini first (long structured output, big budget); groq when Gemini is
    # slow or down — a timeout does not fail over inside the chain on its own.
    questions: list[dict[str, Any]] = []
    data: Any = None
    for prefer in ("gemini", "groq"):
        try:
            data = await _generate_json(prompt, user_id=user_id, course_id=str(course_id), feature="v4_rehearsal", prefer=prefer)
        except Exception as exc:
            if exc.__class__.__name__ == "LLMBudgetExceededError":
                raise HTTPException(status_code=429, detail="You have reached this month's AI allowance.")
            logger.warning("rehearsal: compose via %s failed for %s: %s", prefer, course_id, exc)
            continue
        questions = validate_rehearsal(data, allowed)
        if len(questions) >= 3:
            break
    if len(questions) < 3:
        raise HTTPException(status_code=502, detail="Couldn't compose a rehearsal just now.")
    for i, q in enumerate(questions[:count]):
        q["id"] = i + 1
        if q["kind"] == "order":
            # Kept in the right order for grading; the client shuffles what it shows.
            q["shuffle"] = random.sample(range(len(q["items"])), len(q["items"]))
    titles = {lec["id"]: lec["title"] for lec in lectures}
    return {
        "title": str((data or {}).get("title") or "Exam rehearsal")[:80],
        "lectures": titles,
        "questions": questions[:count],
    }
