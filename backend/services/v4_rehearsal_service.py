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

import json
import logging
import random
from typing import Annotated, Any, Literal, Optional, Union
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, Field, TypeAdapter, ValidationError

from backend.core.database import get_db_connection
from backend.services.localization_service import get_lecture_content_for_locale
from backend.services.v4_reader_service import IDEAS_VERSION, _generate_json, write_in
from backend.services.cache import get_cache, set_cache
from backend.services.v4_personal import space_lectures

logger = logging.getLogger(__name__)

MAX_SLIDES_PER_LECTURE = 14
#: ~4 chars a token: a prompt under this leaves groq room for the answer within its per-minute budget.
GROQ_PROMPT_CHARS = 16_000
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


def grade_answer(question: dict[str, Any], answer: dict[str, Any]) -> bool:
    """Grade one checkpoint answer the way the reader does (``rehearsal/grade.ts``):
    tool questions by computing the answer, choice and order against the
    slides. Anything malformed is simply wrong — never an error."""

    def same(got: Any, expected: set) -> bool:
        return isinstance(got, list) and len(got) == len(expected) and set(got) == expected

    try:
        kind = question.get("kind")
        if answer.get("kind") != kind:
            return False
        if kind == "choice":
            right = next((i for i, o in enumerate(question["options"]) if o.get("correct")), None)
            return right is not None and answer.get("index") == right
        if kind == "order":
            order = answer.get("order")
            return isinstance(order, list) and len(order) == len(question["items"]) and all(
                v == i for i, v in enumerate(order)
            )
        if kind == "fdHolds":
            holds = {
                i for i, fd in enumerate(question["candidates"])
                if _holds(question["columns"], question["rows"], fd["lhs"], fd["rhs"])
            }
            return same(answer.get("holds"), holds)
        fds = [(set(fd["lhs"]), set(fd["rhs"])) for fd in question["fds"]]
        if kind == "closure":
            c = _closure(set(question["start"]), fds)
            return same(answer.get("attrs"), {a for a in question["attrs"] if a in c})
        if kind == "bcnf":
            attrs = set(question["attrs"])
            violating = {i for i, (lhs, rhs) in enumerate(fds) if not rhs <= lhs and not attrs <= _closure(lhs, fds)}
            return same(answer.get("violating"), violating)
    except (KeyError, IndexError, TypeError, ValueError, AttributeError):
        return False
    return False


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


def _shuffle(n: int) -> list[int]:
    """A display order for an ordering question that is never already the answer."""
    order = list(range(n))
    if n < 2:
        return order
    while order == sorted(order):
        random.shuffle(order)
    return order


# ─── composing ───────────────────────────────────────────────────────────

KINDS = """Every question has: "lecture_id" (from the list), "page" (the slide it tests),
"idea" (2-5 words), "prompt" (the question), "why" (1-2 sentences: the reason,
shown after answering). Kinds:
- {"kind":"choice","options":[{"text":"...","correct":true},{"text":"..."},{"text":"..."},{"text":"..."}]}
  exactly one correct; distractors must be plausible mistakes a student makes.
- {"kind":"order","items":["first","second","third","fourth"]}  items in the CORRECT order
  (they will be shuffled); for processes, algorithms, phases.
- {"kind":"fdHolds","columns":["A","B","C"],"rows":[["..","..",".."],...],"candidates":[{"lhs":["A"],"rhs":["B"]},...]}
  prompt asks which candidate FDs hold on this data; 4-6 concrete rows; at least
  one candidate must hold and at least one must be broken by the rows.
- {"kind":"closure","attrs":["A","B","C","D","E"],"fds":[{"lhs":["A"],"rhs":["B"]},...],"start":["A"]}
  prompt asks for the closure of start; at least two FDs should fire.
- {"kind":"bcnf","relation":"R","attrs":["..."],"fds":[{"lhs":["..."],"rhs":["..."]},...]}
  prompt asks which FDs violate BCNF in R; at least one must, at least one must not."""

PROMPT = """You are writing an exam rehearsal for a university course, from its own slides.
Write exactly {count} questions that test understanding, not recall of wording,
spread across the lectures below{weak}. Mix the kinds: mostly "choice", some
"order", and — only for lectures that teach them — the database-theory tools.

Course: {course}
{context}

{kinds}
{write_in} Be correct.
Answer with ONE JSON object only: {{"title":"a short name for this rehearsal","questions":[...]}}"""


async def _lecture_context(lecture: dict[str, Any], locale: str) -> tuple[str, int]:
    content, served = await get_lecture_content_for_locale(UUID(lecture["id"]), locale)
    lecture["served"] = served
    slides = (content or {}).get("slides") or []
    if not slides:
        return "", 0
    ideas = await get_cache(f"v4reader:{IDEAS_VERSION}:{lecture['id']}:{lecture['content_revision']}")
    idea_line = (
        "Ideas: "
        + "; ".join(
            f"{i['name']} (from p{min(i['slide_indices']) + 1})" for i in ideas if i.get("slide_indices")
        )
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
        # A course's lectures, or your own uploads in your personal Space.
        rows = await conn.fetch(
            f"""SELECT l.id, l.title, l.content_revision FROM lectures l
               WHERE {space_lectures("$1")} AND l.id = ANY($2::uuid[]) AND COALESCE(l.is_archived, false) = false
               ORDER BY l.created_at""",
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
        kinds=KINDS,
        write_in=write_in(locale, next((lec.get("served") for lec in lectures if lec.get("served")), locale)),
    )
    # Groq writes a rehearsal in seconds but its free tier caps tokens per
    # minute; Gemini has the headroom but measured 10s to 90s+ (timing out).
    # So: groq first while the prompt fits its budget, Gemini first beyond it,
    # and the other as the fallback — a timeout does not fail over in the
    # chain on its own.
    questions: list[dict[str, Any]] = []
    data: Any = None
    order = ("groq", "gemini") if len(prompt) < GROQ_PROMPT_CHARS else ("gemini", "groq")
    for prefer in order:
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
            q["shuffle"] = _shuffle(len(q["items"]))
    titles = {lec["id"]: lec["title"] for lec in lectures}
    return {
        "title": str((data or {}).get("title") or "Exam rehearsal")[:80],
        "lectures": titles,
        "questions": questions[:count],
    }


# ─── checkpoints ─────────────────────────────────────────────────────────
#
# One or two questions on a single idea, asked as the reader finishes it.
# Written once per idea (per deck revision and language) and cached for
# everyone: the second student to finish "Closure Algorithm" gets theirs at
# once, and the model is asked once, not once per reader.

CHECKPOINT_VERSION = "checkpoint-v1"
CHECKPOINT_TTL = 60 * 60 * 24 * 60
CHECKPOINT_SLIDES = 12

CHECKPOINT_PROMPT = """A student has just read the part of a lecture below, on one idea.
Write {count} questions that check they understood it — the kind a good tutor
asks at the end of a section: not recall of wording, not trick questions.
Only about these pages. Prefer "choice"; use "order" for a procedure; use a
database-theory tool only if these pages teach it.

Lecture: {lecture} — lecture_id {lecture_id}
Idea: {idea} (pages {first}–{last})
{pages}

{kinds}
{write_in} Be correct.
Answer with ONE JSON object only: {{"questions":[...]}}"""


def checkpoint_key(lecture_id: UUID, revision: Any, locale: str, first: int, last: int) -> str:
    return f"v4reader:{CHECKPOINT_VERSION}:{lecture_id}:{revision}:{locale}:{first}-{last}"


async def cached_checkpoint(lecture_id: UUID, first: int, last: int, locale: str) -> Optional[dict[str, Any]]:
    """The checkpoint as it was served (answers included), or None once it has expired."""
    from backend.services.v4_reader_service import _lecture_row

    meta = await _lecture_row(lecture_id)
    cached = await get_cache(checkpoint_key(lecture_id, meta["content_revision"], locale, first, last))
    return cached if isinstance(cached, dict) and cached.get("questions") else None


async def checkpoint(
    lecture_id: UUID,
    first: int,
    last: int,
    idea: str,
    *,
    user_id: str,
    locale: str,
) -> dict[str, Any]:
    from backend.services.v4_reader_service import _lecture_row

    meta = await _lecture_row(lecture_id)
    content, served = await get_lecture_content_for_locale(lecture_id, locale)
    slides = (content or {}).get("slides") or []
    total = len(slides)
    if not total:
        raise HTTPException(status_code=409, detail="This lecture has no text yet.")
    first, last = max(1, first), min(total, last)
    if last < first:
        raise HTTPException(status_code=422, detail="Those pages are not in this lecture.")

    key = checkpoint_key(lecture_id, meta["content_revision"], locale, first, last)
    cached = await get_cache(key)
    if isinstance(cached, dict) and cached.get("questions"):
        return {**cached, "cached": True}

    span = [s for s in slides if first <= int(s.get("slide_number") or 0) <= last]
    texty = [s for s in span if len((s.get("content_text") or "").strip()) > 30] or span
    step = max(1, len(texty) // CHECKPOINT_SLIDES)
    pages = "\n".join(
        f"  p{s.get('slide_number')}: {(s.get('title') or '').strip()[:70]} — "
        f"{' '.join((s.get('content_text') or '').split())[:SLIDE_TEXT_CHARS * 2]}"
        for s in texty[::step][:CHECKPOINT_SLIDES]
    )
    prompt = CHECKPOINT_PROMPT.format(
        count=2,
        lecture=meta.get("title") or "",
        lecture_id=str(lecture_id),
        idea=idea[:80],
        first=first,
        last=last,
        pages=pages,
        kinds=KINDS,
        write_in=write_in(locale, served),
    )
    questions: list[dict[str, Any]] = []
    for prefer in ("groq", "gemini"):
        try:
            data = await _generate_json(
                prompt, user_id=user_id, course_id=str(meta["course_id"]), feature="v4_checkpoint", prefer=prefer
            )
        except Exception as exc:
            if exc.__class__.__name__ == "LLMBudgetExceededError":
                raise HTTPException(status_code=429, detail="You have reached this month's AI allowance.")
            logger.warning("checkpoint via %s failed for %s p%s-%s: %s", prefer, lecture_id, first, last, exc)
            continue
        questions = [
            q for q in validate_rehearsal(data, {str(lecture_id): total}) if first <= q["page"] <= last
        ]
        if questions:
            break
    if not questions:
        raise HTTPException(status_code=502, detail="Couldn't write a checkpoint just now.")
    for i, q in enumerate(questions[:2]):
        q["id"] = i + 1
        if q["kind"] == "order":
            q["shuffle"] = _shuffle(len(q["items"]))
    result = {"idea": idea[:80], "first": first, "last": last, "questions": questions[:2]}
    await set_cache(key, result, ttl_seconds=CHECKPOINT_TTL)
    return {**result, "cached": False}


# ─── history ─────────────────────────────────────────────────────────────

HISTORY_WINDOW = 20


async def save_attempt(
    course_id: UUID,
    user_id: str,
    title: str,
    lecture_ids: list[UUID],
    results: list[dict[str, Any]],
) -> dict[str, Any]:
    """Store a finished rehearsal. The score is counted here, from the results, not taken from the client."""
    async with await get_db_connection() as conn:
        known = {
            str(r["id"])
            for r in await conn.fetch(
                "SELECT id FROM lectures WHERE course_id = $1 AND id = ANY($2::uuid[])", course_id, lecture_ids
            )
        }
        clean = [
            {
                "lecture_id": str(r["lecture_id"]),
                "page": int(r["page"]),
                "idea": str(r["idea"])[:60],
                "kind": str(r["kind"])[:12],
                "correct": bool(r["correct"]),
            }
            for r in results
            if str(r.get("lecture_id")) in known
        ]
        if not clean:
            raise HTTPException(status_code=422, detail="Nothing in that rehearsal belongs to this course.")
        row = await conn.fetchrow(
            """INSERT INTO public.v4_rehearsal_attempts (user_id, course_id, title, lecture_ids, score, total, results)
               VALUES ($1::uuid, $2, $3, $4::uuid[], $5, $6, $7::jsonb)
               RETURNING id, created_at""",
            user_id,
            course_id,
            title[:120] or "Exam rehearsal",
            sorted({UUID(c["lecture_id"]) for c in clean}, key=str),
            sum(1 for c in clean if c["correct"]),
            len(clean),
            json.dumps(clean),
        )
    return {"id": str(row["id"]), "created_at": row["created_at"].isoformat()}


async def history(course_id: UUID, user_id: str) -> dict[str, Any]:
    """Recent attempts, and the ideas whose latest answer was wrong — the weak spots."""
    async with await get_db_connection() as conn:
        rows = await conn.fetch(
            """SELECT id, title, score, total, results, created_at
               FROM public.v4_rehearsal_attempts
               WHERE user_id = $1::uuid AND course_id = $2
               ORDER BY created_at DESC LIMIT $3""",
            user_id,
            course_id,
            HISTORY_WINDOW,
        )
        titles = {
            str(r["id"]): r["title"]
            for r in await conn.fetch("SELECT id, title FROM lectures WHERE course_id = $1", course_id)
        }

    ideas: dict[tuple[str, str], dict[str, Any]] = {}
    decided_by: dict[tuple[str, str], Any] = {}  # the attempt an idea's latest result comes from
    for row in rows:  # newest first: the first attempt that tests an idea gives its latest result
        results = row["results"] if isinstance(row["results"], list) else json.loads(row["results"])
        for r in results:
            key = (r["lecture_id"], r["idea"].strip().lower())
            e = ideas.get(key)
            if e is not None and decided_by[key] == row["id"] and not r["correct"]:
                # Two answers on one idea in the same attempt: it is right only if both were.
                # A miss listed second used to be dropped, so a 1/2 check showed "No weak spots" (LS-057).
                e["latest_correct"] = False
            if e is None:
                decided_by[key] = row["id"]
                e = ideas[key] = {
                    "lecture_id": r["lecture_id"],
                    "lecture_title": titles.get(r["lecture_id"], ""),
                    "idea": r["idea"],
                    "page": r["page"],
                    "latest_correct": r["correct"],
                    "at": row["created_at"].isoformat(),
                    "seen": 0,
                    "missed": 0,
                }
            e["seen"] += 1
            e["missed"] += 0 if r["correct"] else 1

    weak = sorted((e for e in ideas.values() if not e["latest_correct"]), key=lambda e: (-e["missed"], e["idea"]))
    steady = [e for e in ideas.values() if e["latest_correct"]]
    return {
        "attempts": [
            {
                "id": str(r["id"]),
                "title": r["title"],
                "score": r["score"],
                "total": r["total"],
                "created_at": r["created_at"].isoformat(),
            }
            for r in rows
        ],
        "weak": weak[:12],
        "steady_count": len(steady),
        # Every tested idea's latest result, by page — what lights the course map.
        "marks": [
            {"lecture_id": e["lecture_id"], "page": e["page"], "correct": e["latest_correct"], "at": e["at"]}
            for e in ideas.values()
        ][:200],
    }
