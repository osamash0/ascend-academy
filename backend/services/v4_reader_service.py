"""The v4 reader, on real lectures.

Three reads and one generation, for the Lesson reader in `src/features/spaces`:

- a course as the reader's Space: its lectures in order;
- a lecture as the reader's Lesson: localized slides, its ideas, a signed PDF;
- a lecture's ideas, when the concept graph has none: grouped by the model
  from the slide titles, cached per content revision;
- **Explain**: one page answered as an interface — a JSON document of blocks
  from a fixed library (see `src/features/spaces/components/reader/iui/spec.ts`)
  — validated here against the same shapes, cached per page and revision.

Access mirrors `localized_content`: the caller must be able to view the
lecture (owner, student owner, enrolled, or assigned). Model output is never
trusted as is: every answer is parsed, validated block by block, and blocks
that fail are dropped rather than shown broken.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Annotated, Any, Literal, Optional, Union
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, Field, TypeAdapter, ValidationError

from backend.core.database import get_db_connection, run_sync, supabase_admin
from backend.services.cache import get_cache, set_cache
from backend.services.localization_service import get_lecture_content_for_locale

logger = logging.getLogger(__name__)

PDF_BUCKET = "lecture-pdfs"
#: The token lives 8h; reuse it for 6h so every reader shares one URL and the
#: storage CDN can cache the file (per-view signing defeated it — the 2026-08
#: egress incident).
SIGNED_TTL = 8 * 3600
SIGNED_REUSE = 6 * 3600
#: Bump when the prompt or the block library changes, so stale answers age out.
EXPLAIN_VERSION = "explain-v3"
ASK_VERSION = "ask-v1"
IDEAS_VERSION = "ideas-v2"  # v2: count scales with the deck, names say what is taught
CACHE_TTL = 60 * 60 * 24 * 60  # 60 days; keyed on content_revision anyway


# ─── access ──────────────────────────────────────────────────────────────


async def can_view_lecture(lecture_id: UUID, user_id: str) -> bool:
    from backend.api.v1.localized_content import _can_view_lecture

    return await _can_view_lecture(lecture_id, user_id)


async def can_view_course(course_id: UUID, user_id: str) -> bool:
    async with await get_db_connection() as conn:
        return bool(
            await conn.fetchval(
                """
                SELECT EXISTS (
                  SELECT 1 FROM courses c WHERE c.id = $1 AND (
                    c.professor_id = $2::uuid
                    OR EXISTS (SELECT 1 FROM course_enrollments ce
                               WHERE ce.course_id = c.id AND ce.user_id = $2::uuid)
                    OR EXISTS (SELECT 1 FROM lectures l
                               WHERE l.course_id = c.id AND l.student_owner_id = $2::uuid)
                  )
                )
                """,
                course_id,
                user_id,
            )
        )


LANGUAGE_NAMES = {"de": "German", "en": "English"}


#: The product's German register (docs/BRAND_VOICE.md, "German register"), for
#: everything the model writes to a German reader — the first German run said
#: "Ordnen Sie …".
GERMAN_REGISTER = (
    "Address the student as du, never Sie (\"Ordne …\", \"Schau dir … an\"); use "
    "gender-inclusive forms (Studierende, Dozent:in); no exclamation marks."
)


def write_in(locale: str, served: str) -> str:
    """How a reader prompt is told which language to answer in.

    The answer follows the *reader's* language, not the slides'. Most decks
    have no translation, so a German reader is usually served English slides
    — and was answered in English, cached under the German key. When the two
    differ, the slides' technical terms are kept (the exam asks in the deck's
    language), with the original in brackets the first time a term is
    translated, and anything quoted from the slide stays exactly as written:
    the reader lights those words on the page and must find them there.
    """
    want = LANGUAGE_NAMES.get(locale, "English")
    have = LANGUAGE_NAMES.get(served, want)
    rule = (
        f"Write in {want}."
        if want == have
        else (
            f"Write everything in {want} — titles, steps, questions, options, explanations — even "
            f"though the slides are in {have}. Two exceptions only: the first time you use a technical "
            f"term of the subject, add the slides' {have} term in brackets (e.g. a German "
            f"\"Attributhülle (attribute closure)\"), never for everyday words; and any \"spot\" is "
            f"copied word for word from the slide, in {have}, because the reader finds it there."
        )
    )
    return f"{rule} {GERMAN_REGISTER}" if want == "German" else rule


async def preferred_language(user_id: str) -> str:
    from backend.api.v1.localized_content import _preferred_language

    return await _preferred_language(user_id)


# ─── course ──────────────────────────────────────────────────────────────


async def get_course(course_id: UUID) -> dict[str, Any]:
    async with await get_db_connection() as conn:
        course = await conn.fetchrow(
            "SELECT id, title, description, color, professor_id FROM courses WHERE id = $1", course_id
        )
        if not course:
            raise HTTPException(status_code=404, detail="Course not found.")
        lectures = await conn.fetch(
            """
            SELECT l.id, l.title, l.total_slides, l.created_at
            FROM lectures l
            WHERE l.course_id = $1 AND COALESCE(l.is_archived, false) = false
            ORDER BY l.created_at ASC
            """,
            course_id,
        )
        professor = await conn.fetchval(
            "SELECT COALESCE(full_name, display_name) FROM profiles WHERE user_id = $1",
            course["professor_id"],
        ) if course["professor_id"] else None
    return {
        "id": str(course["id"]),
        "title": course["title"],
        "description": course["description"],
        "color": course["color"],
        "author": professor,
        "lectures": [
            {"id": str(r["id"]), "title": r["title"], "total_slides": r["total_slides"] or 0, "order": i + 1}
            for i, r in enumerate(lectures)
        ],
    }


# ─── lecture ─────────────────────────────────────────────────────────────


def _storage_path(raw: str) -> str:
    m = re.search(r"lecture-pdfs/(.+)$", raw)
    return m.group(1) if m else raw


async def signed_pdf_url(raw: Optional[str], bucket: str = PDF_BUCKET) -> Optional[str]:
    """A signed URL for a stored file, shared by every reader for 6h (CDN-cacheable)."""
    if not raw:
        return None
    m = re.search(rf"{re.escape(bucket)}/(.+)$", raw)
    path = m.group(1) if m else raw
    key = f"v4reader:{bucket}:{path}"
    cached = await get_cache(key)
    if isinstance(cached, dict) and cached.get("url"):
        return cached["url"]
    try:
        signed = await run_sync(lambda: supabase_admin.storage.from_(bucket).create_signed_url(path, SIGNED_TTL))
        url = (signed.get("signedURL") or signed.get("signedUrl") or signed.get("signed_url")) if isinstance(signed, dict) else signed
    except Exception as exc:  # storage hiccup: the reader can still show the text
        logger.warning("v4 reader: signing %s failed: %s", path, exc)
        return None
    if url:
        await set_cache(key, {"url": url}, ttl_seconds=SIGNED_REUSE)
    return url


async def _lecture_row(lecture_id: UUID) -> dict[str, Any]:
    async with await get_db_connection() as conn:
        row = await conn.fetchrow(
            """
            SELECT l.id, l.title, l.description, l.total_slides, l.created_at, l.pdf_url, l.poster_url,
                   l.course_id, l.is_archived, l.source_language, l.content_revision
            FROM lectures l WHERE l.id = $1
            """,
            lecture_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="Lecture not found.")
    return dict(row)


async def graph_concepts(lecture_id: UUID) -> list[dict[str, Any]]:
    """The concept graph's view of a lecture, in `LectureConcept` shape. Often empty."""
    try:
        from backend.services.concept_graph import concepts_for_lecture

        return list(await concepts_for_lecture(str(lecture_id)) or [])
    except Exception as exc:
        logger.info("v4 reader: concept graph unavailable for %s: %s", lecture_id, exc)
        return []


async def get_lecture(lecture_id: UUID, locale: str) -> dict[str, Any]:
    meta = await _lecture_row(lecture_id)
    content, served = await get_lecture_content_for_locale(lecture_id, locale)
    if content is None:
        raise HTTPException(status_code=409, detail="This lecture is still being prepared.")
    localized = content.get("lecture") or {}
    slides = content.get("slides") or []
    lecture = {
        "id": str(meta["id"]),
        "title": localized.get("title") or meta["title"],
        "description": localized.get("description") or meta["description"],
        "total_slides": meta["total_slides"],
        "created_at": meta["created_at"].isoformat(),
        "pdf_url": meta["pdf_url"],
        "poster_url": meta["poster_url"],
        "course_id": str(meta["course_id"]) if meta["course_id"] else None,
        "is_archived": meta["is_archived"],
        "source_language": meta["source_language"],
        "content_revision": meta["content_revision"],
    }
    return {
        "bundle": {
            "locale": served,
            "requested_locale": locale,
            "is_original_language": served != locale,
            "lecture": lecture,
            "slides": [
                {
                    "id": str(s.get("id")),
                    "slide_number": s.get("slide_number"),
                    "title": s.get("title"),
                    "content_text": s.get("content_text"),
                    "summary": s.get("summary"),
                }
                for s in slides
            ],
            "questions": [],
        },
        "concepts": await graph_concepts(lecture_id),
        "pdf_signed_url": await signed_pdf_url(meta["pdf_url"]),
    }


# ─── model calls ─────────────────────────────────────────────────────────


async def _generate_json(
    prompt: str, *, user_id: str, course_id: Optional[str], feature: str, prefer: str = "cerebras"
) -> Any:
    """One model call through the quality chain; `prefer` moves a provider to its head."""
    from backend.services.ai.orchestrator import generate_text, parse_json_response

    raw = await generate_text(
        prompt, prefer, json_mode=True, user_id=user_id, course_id=course_id, feature=feature
    )
    return parse_json_response(raw)


# ─── ideas ───────────────────────────────────────────────────────────────


class _Idea(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    first_page: int = Field(ge=1)


def _ideas_to_concepts(ideas: list[_Idea], total: int, lecture_id: UUID) -> list[dict[str, Any]]:
    """Ordered ideas with a first page each → contiguous `LectureConcept` ranges."""
    ideas = sorted({i.first_page: i for i in ideas if i.first_page <= total}.values(), key=lambda i: i.first_page)
    if not ideas:
        return []
    if ideas[0].first_page != 1:
        ideas[0] = _Idea(name=ideas[0].name, first_page=1)
    out = []
    for n, idea in enumerate(ideas):
        end = ideas[n + 1].first_page - 1 if n + 1 < len(ideas) else total
        out.append(
            {
                "concept_id": f"idea-{lecture_id}-{n + 1}",
                "name": idea.name,
                "weight": round((end - idea.first_page + 1) / total, 3),
                "slide_indices": list(range(idea.first_page - 1, end)),
            }
        )
    return out


def idea_count(total: int) -> int:
    """About one idea per nine slides: fine enough to check after, coarse enough to be a topic."""
    return max(3, min(12, round(total / 9)))


def ideas_prompt(title: str, total: int, listing: str) -> str:
    n = idea_count(total)
    return f"""You are organising a university lecture deck into the ideas it teaches.

Lecture: "{title}" ({total} slides). Slide titles, numbered:
{listing}

Group the deck into about {n} consecutive ideas (between {max(3, n - 2)} and {n + 2}),
in teaching order. Each idea is what a student would study as one topic and be
tested on as one topic, so it should rarely run past 14 slides.

Name each idea by what it teaches, in at most 5 words — "Second normal form",
"Attribute closure", "Lossless decomposition". Never a vague name: no
"Overview", "Understanding …", "Introduction to …", "Advanced … concepts",
"Fundamentals", no numbering. Every slide belongs to exactly one idea; give only
where each idea starts.

Answer with a JSON object only:
{{"ideas": [{{"name": "...", "first_page": 1}}, ...]}}"""


async def get_ideas(lecture_id: UUID, user_id: str) -> list[dict[str, Any]]:
    """The lecture's ideas: the concept graph's when it has some, else the model's grouping."""
    graph = await graph_concepts(lecture_id)
    if graph:
        return graph
    meta = await _lecture_row(lecture_id)
    key = f"v4reader:{IDEAS_VERSION}:{lecture_id}:{meta['content_revision']}"
    cached = await get_cache(key)
    if isinstance(cached, list):
        return cached
    content, _ = await get_lecture_content_for_locale(lecture_id, meta["source_language"] or "en")
    slides = (content or {}).get("slides") or []
    total = len(slides)
    if total == 0:
        return []
    listing = "\n".join(f"{s.get('slide_number')}. {(s.get('title') or '').strip()[:90]}" for s in slides)
    prompt = ideas_prompt(meta["title"], total, listing)
    try:
        # Gemini first: a course page groups its lectures back to back, which
        # empties groq's per-minute token budget by the third lecture.
        data = await _generate_json(
            prompt, user_id=user_id, course_id=str(meta["course_id"]), feature="v4_reader_ideas", prefer="gemini"
        )
        ideas = TypeAdapter(list[_Idea]).validate_python((data or {}).get("ideas") if isinstance(data, dict) else data)
        concepts = _ideas_to_concepts(ideas, total, lecture_id)
    except Exception as exc:
        logger.warning("v4 reader: idea grouping failed for %s: %s", lecture_id, exc)
        return []
    if concepts:
        await set_cache(key, concepts, ttl_seconds=CACHE_TTL)
    return concepts


# ─── Explain ─────────────────────────────────────────────────────────────
# Mirrors `spec.ts`. Kept strict: an answer is shown only in shapes the panel
# knows how to draw.


class FD(BaseModel):
    lhs: list[str] = Field(min_length=1, max_length=6)
    rhs: list[str] = Field(min_length=1, max_length=6)


class Relation(BaseModel):
    name: str = Field(max_length=40)
    attrs: list[str] = Field(min_length=2, max_length=10)


class TextBlock(BaseModel):
    type: Literal["text"]
    md: str = Field(max_length=1500)


class KeyBlock(BaseModel):
    type: Literal["key"]
    md: str = Field(max_length=400)


class Part(BaseModel):
    id: str = Field(max_length=40)
    label: str = Field(max_length=32)
    body: str = Field(max_length=700)
    spot: Optional[str] = Field(default=None, max_length=120)


class ExploreBlock(BaseModel):
    type: Literal["explore"]
    title: str = Field(max_length=80)
    intro: str = Field(max_length=300)
    parts: list[Part] = Field(min_length=2, max_length=8)
    flow: bool = False


class Column(BaseModel):
    title: str = Field(max_length=60)
    tone: Optional[Literal["a", "b"]] = None
    points: list[str] = Field(min_length=1, max_length=6)


class CompareBlock(BaseModel):
    type: Literal["compare"]
    columns: list[Column] = Field(min_length=2, max_length=3)
    note: Optional[str] = Field(default=None, max_length=300)


class FdTableBlock(BaseModel):
    type: Literal["fdTable"]
    title: str = Field(max_length=80)
    columns: list[str] = Field(min_length=2, max_length=6)
    rows: list[list[str]] = Field(min_length=2, max_length=8)
    fd: FD
    prompt: str = Field(max_length=300)


class ClosureBlock(BaseModel):
    type: Literal["closure"]
    title: str = Field(max_length=80)
    attrs: list[str] = Field(min_length=2, max_length=8)
    fds: list[FD] = Field(min_length=1, max_length=8)
    start: list[str] = Field(min_length=1, max_length=8)


class BcnfBlock(BaseModel):
    type: Literal["bcnf"]
    title: str = Field(max_length=80)
    relation: Relation
    fds: list[FD] = Field(min_length=1, max_length=6)


class Option(BaseModel):
    text: str = Field(max_length=160)
    correct: Optional[bool] = None
    why: str = Field(max_length=400)


class CheckBlock(BaseModel):
    type: Literal["check"]
    question: str = Field(max_length=300)
    options: list[Option] = Field(min_length=2, max_length=4)


class Step(BaseModel):
    label: str = Field(max_length=40)
    body: str = Field(max_length=400)


class StepsBlock(BaseModel):
    type: Literal["steps"]
    title: str = Field(max_length=80)
    steps: list[Step] = Field(min_length=2, max_length=7)


class SandboxBlock(BaseModel):
    """A small app the model writes, run in an isolated iframe on the client.

    The isolation is the client's (sandbox without same-origin, a CSP with no
    network, a validated message bridge). `_coherent` adds a static screen so
    an app that reaches for the network, storage or its parent is dropped
    rather than merely blocked.
    """

    type: Literal["sandbox"]
    title: str = Field(max_length=80)
    caption: Optional[str] = Field(default=None, max_length=220)
    height: int = Field(default=380, ge=160, le=720)
    html: str = Field(max_length=14000)
    css: str = Field(default="", max_length=9000)
    js: str = Field(default="", max_length=20000)


Block = Annotated[
    Union[
        TextBlock, KeyBlock, ExploreBlock, CompareBlock, FdTableBlock, ClosureBlock, BcnfBlock,
        CheckBlock, StepsBlock, SandboxBlock,
    ],
    Field(discriminator="type"),
]

#: What a generated app may never reach for. The iframe could not use most of
#: these anyway; an app that tries is a wrong answer, not a blocked one.
_SANDBOX_FORBIDDEN = re.compile(
    r"\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|importScripts|\bimport\s*\(|sendBeacon"
    r"|<\s*script[^>]*\bsrc\b|<\s*link\b|<\s*iframe\b|<\s*(object|embed|base|meta)\b"
    r"|\b(window|self|globalThis)\s*\.\s*(top|parent|opener)\b|\btop\s*\.\s*location"
    r"|\bparent\s*\.\s*(postMessage|location|document)"
    r"|document\s*\.\s*cookie|localStorage|sessionStorage|indexedDB|\beval\s*\(|new\s+Function\s*\(|https?://",
    re.IGNORECASE,
)
_block = TypeAdapter(Block)


def _coherent(block: BaseModel) -> bool:
    """Checks a schema cannot express: the tools must be computable as given."""
    if isinstance(block, FdTableBlock):
        cols = set(block.columns)
        return all(len(r) == len(block.columns) for r in block.rows) and set(block.fd.lhs + block.fd.rhs) <= cols
    if isinstance(block, ClosureBlock):
        attrs = set(block.attrs)
        return set(block.start) <= attrs and all(set(f.lhs + f.rhs) <= attrs for f in block.fds)
    if isinstance(block, BcnfBlock):
        attrs = set(block.relation.attrs)
        return all(set(f.lhs + f.rhs) <= attrs for f in block.fds)
    if isinstance(block, CheckBlock):
        return sum(1 for o in block.options if o.correct) == 1
    if isinstance(block, SandboxBlock):
        return bool(block.html.strip()) and not _SANDBOX_FORBIDDEN.search(block.html + block.css + block.js)
    return True


#: What the answer's centre is called, when the model names block types instead.
_FORMAT_BY_BLOCK = {
    "sandbox": "A tool to try",
    "fdTable": "A table you can break",
    "closure": "A calculator",
    "bcnf": "A decomposer",
    "steps": "Step by step",
    "compare": "Side by side",
    "explore": "Parts to explore",
    "check": "A quick check",
    "key": "In one line",
    "text": "Just text",
}


def _format_label(raw: str, blocks: list[dict[str, Any]]) -> str:
    """The model's own words for its choice — unless they are just our block names."""
    words = [w.strip().lower() for w in re.split(r"[,/+&]| and ", raw) if w.strip()]
    names = {k.lower() for k in _FORMAT_BY_BLOCK}
    if raw.strip() and not all(w in names or w in {"block", "blocks"} for w in words):
        return raw.strip()[:40]
    for kind in _FORMAT_BY_BLOCK:  # ordered: the most interactive block names the answer
        if any(b["type"] == kind for b in blocks):
            return _FORMAT_BY_BLOCK[kind]
    return "Explained"


def validate_answer(data: Any) -> Optional[dict[str, Any]]:
    """Keep the blocks that parse and make sense; None if nothing usable is left."""
    if not isinstance(data, dict):
        return None
    blocks = []
    sandboxes = 0
    for raw in data.get("blocks") or []:
        try:
            b = _block.validate_python(raw)
        except ValidationError:
            continue
        if not _coherent(b):
            continue
        if isinstance(b, SandboxBlock):
            # One generated app per answer: it is the answer's centre, not decoration.
            if sandboxes:
                continue
            sandboxes += 1
        blocks.append(b.model_dump(exclude_none=True))
    title = str(data.get("title") or "").strip()[:120]
    if not blocks or not title:
        return None
    nxt = [str(q).strip()[:80] for q in (data.get("next") or []) if str(q).strip()][:3]
    return {
        "title": title,
        "format": _format_label(str(data.get("format") or ""), blocks),
        "blocks": blocks[:6],
        "next": nxt,
    }


SANDBOX_SPEC = """- {{"type":"sandbox","title":"...","caption":"one line on what to try","height":380,"html":"...","css":"...","js":"..."}}
   A small interactive app YOU write, for when no block above can show the idea:
   simulations, animations, data structures you can operate (a B+-tree you
   insert keys into, a transaction schedule that flags conflicts, a relational-
   algebra expression evaluated on a tiny table, a query plan whose join order
   you can change). Rules for it:
   * vanilla HTML/CSS/JS only; no libraries, no network, no URLs or external
     images; draw with inline SVG or <canvas>. "html" is the body's inner HTML,
     "js" runs after it (never put <script> tags in html).
   * it MUST be genuinely interactive (controls that change state) and its
     logic MUST be correct; start from a meaningful example taken from the slide.
   * the page is pre-styled dark: use the CSS variables --bg --card --line
     --text --quiet --accent --good --bad and the classes .card .row .btn
     .btn.primary .chip .chip.on .mono .muted; inputs, selects and ranges are
     already styled. Keep its own css short.
   * call LS.ask("question") from a button to let the student ask a follow-up
     about what they see (e.g. "Why did inserting 17 split the leaf?").
   * keep it under 250 lines; "height" is its natural height in px (160-720)."""


EXPLAIN_PROMPT = """You are Learnstation's tutor. A student is on one slide of a university lecture
and asked you to explain it. Answer as a small interface, not an essay: choose
the blocks that make THIS slide easiest to understand. A comparison works best
side by side; a process as steps; a slide that is a diagram or list as parts to
explore; a definition you can test as a tool.

Rules:
- Use 3 to 5 blocks. Open with the block that does the most work (usually an
  interactive one), and end with a "check" whenever the slide teaches something
  a student could get wrong.
- Never just restate the slide. Add the intuition, a concrete example with real
  values, or the mistake students make.
- "title" states the insight in plain words — NOT the slide's own title.
  Good: "A → B is a promise about every row the table will ever hold".
- "format" names your choice in 2-4 plain words, e.g. "A table you can break",
  "Side by side", "Parts to explore", "Step by step", "A calculator".

Course: {course}
Lecture: {lecture}
Slide {page} of {total}. Title: {title}
Slide text:
\"\"\"
{text}
\"\"\"
Neighbouring slide titles: {neighbours}

{write_in} Be correct; never invent facts the slide does not support.

Block library (use the exact field names):
- {{"type":"text","md":"markdown, 1-3 short paragraphs"}}
- {{"type":"key","md":"the one sentence that matters most"}}
- {{"type":"explore","title":"...","intro":"one line","flow":false,"parts":[{{"id":"a","label":"2-3 words","body":"1-3 sentences","spot":"exact words copied from the slide text that this part is about"}}]}}
   (use flow:true when the parts are an ordered process)
- {{"type":"compare","columns":[{{"title":"...","tone":"a","points":["..."]}},{{"title":"...","tone":"b","points":["..."]}}],"note":"optional"}}
- {{"type":"steps","title":"...","steps":[{{"label":"2-3 words","body":"..."}}]}}
- {{"type":"check","question":"...","options":[{{"text":"...","correct":true,"why":"..."}},{{"text":"...","why":"..."}}]}}  (exactly one correct)
Database-theory tools. These are REQUIRED when the slide's topic matches, and
must not be used otherwise:
- slide defines, uses or gives examples of functional dependencies (A → B) → include an fdTable
- slide is about attribute closure, the closure (A+) algorithm or the membership problem → include a closure
- slide is about BCNF, its algorithm, or decomposing a relation → include a bcnf
Give them concrete, correct content: real attribute names from the slide's
example when it has one, otherwise a small believable one (e.g. Movie(title,
year, length, studio)).
- {{"type":"fdTable","title":"Try it","columns":["A","B","C"],"rows":[["..","..",".."]],"fd":{{"lhs":["A"],"rhs":["B"]}},"prompt":"what to try"}}  (functional dependencies; 3-6 rows of concrete values)
- {{"type":"closure","title":"Compute a closure","attrs":["A","B","C","D"],"fds":[{{"lhs":["A"],"rhs":["B"]}}],"start":["A"]}}  (attribute closure)
- {{"type":"bcnf","title":"Decompose step by step","relation":{{"name":"R","attrs":["..."]}},"fds":[{{"lhs":["..."],"rhs":["..."]}}]}}  (BCNF decomposition)
At most one generated app, and only when the slide shows a process or a
structure none of the blocks above can (index structures, transactions,
query plans, relational algebra):
""" + SANDBOX_SPEC + """

Answer with ONE JSON object only:
{{"title":"a plain-language headline for this slide, max 12 words","format":"2-4 words naming the format you chose","blocks":[...],"next":["up to 2 follow-up questions"]}}"""


async def explain_page(lecture_id: UUID, page: int, *, user_id: str, locale: str) -> dict[str, Any]:
    meta = await _lecture_row(lecture_id)
    key = f"v4reader:{EXPLAIN_VERSION}:{lecture_id}:{meta['content_revision']}:{locale}:{page}"
    cached = await get_cache(key)
    if isinstance(cached, dict) and cached.get("blocks"):
        return {**cached, "format": _format_label(cached.get("format", ""), cached["blocks"]), "cached": True}

    content, served = await get_lecture_content_for_locale(lecture_id, locale)
    slides = (content or {}).get("slides") or []
    by_no = {s.get("slide_number"): s for s in slides}
    slide = by_no.get(page)
    if not slide:
        raise HTTPException(status_code=404, detail="No such page.")
    course_title = ""
    if meta["course_id"]:
        async with await get_db_connection() as conn:
            course_title = await conn.fetchval("SELECT title FROM courses WHERE id = $1", meta["course_id"]) or ""
    neighbours = ", ".join(
        f'{n}: "{(by_no[n].get("title") or "").strip()[:60]}"' for n in (page - 2, page - 1, page + 1, page + 2) if n in by_no
    )
    prompt = EXPLAIN_PROMPT.format(
        course=course_title,
        lecture=meta["title"],
        page=page,
        total=len(slides),
        title=(slide.get("title") or "").strip(),
        text=((slide.get("content_text") or slide.get("summary") or "").strip())[:3500],
        neighbours=neighbours or "none",
        write_in=write_in(locale, served),
    )

    answer = None
    for attempt in range(2):
        try:
            data = await _generate_json(prompt, user_id=user_id, course_id=str(meta["course_id"]), feature="v4_reader_explain")
        except Exception as exc:
            logger.warning("v4 reader: explain call failed (%s p%s, try %s): %s", lecture_id, page, attempt + 1, exc)
            if exc.__class__.__name__ == "LLMBudgetExceededError":
                raise HTTPException(status_code=429, detail="You have reached this month's AI allowance.")
            continue
        answer = validate_answer(data)
        if answer:
            break
    if not answer:
        raise HTTPException(status_code=502, detail="Explain could not compose an answer for this page.")
    await set_cache(key, answer, ttl_seconds=CACHE_TTL)
    return {**answer, "cached": False}


# ─── Ask: any question about the page, answered as an interface ──────────

ASK_PROMPT = """You are Learnstation's tutor, inside a lecture reader. A student is on one
slide and asked a question. Answer it as a small interface. Decide first what
helps most:
- a direct, short answer → one "text" (or "key") block, nothing else;
- understanding a concept → explore / steps / compare, plus a check;
- a database-theory exercise → the matching tool (fdTable, closure, bcnf);
- seeing a process or structure work → one generated app ("sandbox").
Do not pad: 1 to 4 blocks. Never restate the question.

Course: {course}
Lecture: {lecture}
Slide {page} of {total}. Title: {title}
Slide text:
\"\"\"
{text}
\"\"\"
Earlier in this conversation (newest last): {thread}

The student asks: "{question}"

{write_in} Be correct; say so plainly if the slide or lecture does
not cover something.

Block library (exact field names):
- {{"type":"text","md":"markdown"}}
- {{"type":"key","md":"the one sentence that matters"}}
- {{"type":"explore","title":"...","intro":"one line","flow":false,"parts":[{{"id":"a","label":"2-3 words","body":"1-3 sentences","spot":"exact words from the slide text, if any"}}]}}
- {{"type":"compare","columns":[{{"title":"...","tone":"a","points":["..."]}},{{"title":"...","tone":"b","points":["..."]}}],"note":"optional"}}
- {{"type":"steps","title":"...","steps":[{{"label":"2-3 words","body":"..."}}]}}
- {{"type":"check","question":"...","options":[{{"text":"...","correct":true,"why":"..."}},{{"text":"...","why":"..."}}]}}  (exactly one correct)
- {{"type":"fdTable","title":"Try it","columns":["A","B","C"],"rows":[["..","..",".."]],"fd":{{"lhs":["A"],"rhs":["B"]}},"prompt":"what to try"}}
- {{"type":"closure","title":"Compute a closure","attrs":["A","B","C","D"],"fds":[{{"lhs":["A"],"rhs":["B"]}}],"start":["A"]}}
- {{"type":"bcnf","title":"Decompose step by step","relation":{{"name":"R","attrs":["..."]}},"fds":[{{"lhs":["..."],"rhs":["..."]}}]}}
""" + SANDBOX_SPEC + """

Answer with ONE JSON object only:
{{"title":"the answer's headline in plain words, max 12 words","format":"2-4 words naming the form you chose","blocks":[...],"next":["up to 2 natural follow-up questions"]}}"""


def _norm_question(q: str) -> str:
    return re.sub(r"\s+", " ", q.strip().lower())[:400]


async def ask_page(
    lecture_id: UUID,
    page: int,
    question: str,
    thread: list[dict[str, str]],
    *,
    user_id: str,
    locale: str,
) -> dict[str, Any]:
    import hashlib

    meta = await _lecture_row(lecture_id)
    thread = [
        {"q": str(t.get("question", ""))[:300], "a": str(t.get("title", ""))[:120]}
        for t in thread[-4:]
        if t.get("question")
    ]
    digest = hashlib.sha256(
        json.dumps([_norm_question(question), thread], ensure_ascii=False).encode()
    ).hexdigest()[:24]
    key = f"v4reader:{ASK_VERSION}:{lecture_id}:{meta['content_revision']}:{locale}:{page}:{digest}"
    cached = await get_cache(key)
    if isinstance(cached, dict) and cached.get("blocks"):
        return {**cached, "format": _format_label(cached.get("format", ""), cached["blocks"]), "cached": True}

    content, served = await get_lecture_content_for_locale(lecture_id, locale)
    slides = (content or {}).get("slides") or []
    slide = next((s for s in slides if s.get("slide_number") == page), None)
    if not slide:
        raise HTTPException(status_code=404, detail="No such page.")
    course_title = ""
    if meta["course_id"]:
        async with await get_db_connection() as conn:
            course_title = await conn.fetchval("SELECT title FROM courses WHERE id = $1", meta["course_id"]) or ""
    prompt = ASK_PROMPT.format(
        course=course_title,
        lecture=meta["title"],
        page=page,
        total=len(slides),
        title=(slide.get("title") or "").strip(),
        text=((slide.get("content_text") or slide.get("summary") or "").strip())[:3500],
        thread="; ".join(f'Q: "{t["q"]}" → answered: "{t["a"]}"' for t in thread) or "nothing yet",
        question=question.strip()[:400].replace('"', "'"),
        write_in=write_in(locale, served),
    )

    # One attempt: the chain already fails over between providers, and a
    # second full attempt only doubles the wait. Gemini Flash leads here — it
    # writes long, code-heavy answers fast and has the headroom for them.
    answer = None
    # Gemini first; groq if Gemini times out or answers with nothing usable —
    # a timeout does not fail over inside the chain on its own.
    for attempt, prefer in enumerate(("gemini", "groq")):
        try:
            data = await _generate_json(
                prompt, user_id=user_id, course_id=str(meta["course_id"]), feature="v4_reader_ask", prefer=prefer
            )
        except Exception as exc:
            if exc.__class__.__name__ == "LLMBudgetExceededError":
                raise HTTPException(status_code=429, detail="You have reached this month's AI allowance.")
            logger.warning("v4 reader: ask failed (%s p%s, try %s): %s", lecture_id, page, attempt + 1, exc)
            continue
        answer = validate_answer(data)
        if answer:
            break
    if not answer:
        raise HTTPException(status_code=502, detail="Couldn't compose an answer to that just now.")
    await set_cache(key, answer, ttl_seconds=CACHE_TTL)
    return {**answer, "cached": False}


# ─── the course: a journey, and a search across it ───────────────────────

POSTER_BUCKET = "lecture-posters"


async def course_map(course_id: UUID) -> dict[str, Any]:
    """Each lecture with its poster and — where they are already known — its ideas.

    Ideas are read from the cache only; a lecture whose ideas were never
    grouped says so (`ideas: null`) and the page asks for them one by one.
    Posters, not PDFs: a poster is a small WebP of page 1, a PDF is the whole
    deck (the 2026-08 egress incident was exactly this).
    """
    course = await get_course(course_id)
    async with await get_db_connection() as conn:
        rows = await conn.fetch(
            "SELECT id, poster_url, content_revision FROM lectures WHERE course_id = $1", course_id
        )
    extra = {str(r["id"]): r for r in rows}

    async def station(lec: dict[str, Any]) -> dict[str, Any]:
        row = extra.get(lec["id"])
        if row is None:
            return {**lec, "poster": None, "ideas": None}
        graph, cached, poster = await asyncio.gather(
            graph_concepts(UUID(lec["id"])),
            get_cache(f"v4reader:{IDEAS_VERSION}:{lec['id']}:{row['content_revision']}"),
            signed_pdf_url(row["poster_url"], POSTER_BUCKET),
        )
        ideas = graph or cached
        return {
            **lec,
            "poster": poster,
            # A concept linked to the lecture as a whole has no page to jump to,
            # so it has no place on the map. One of those used to take the
            # whole Space down: min() of an empty list.
            "ideas": sorted(
                (
                    {"name": i["name"], "first_page": min(i["slide_indices"]) + 1}
                    for i in ideas
                    if i.get("slide_indices")
                ),
                key=lambda i: i["first_page"],
            )
            if isinstance(ideas, list)
            else None,
        }

    # Every lecture at once: ten sequential storage + cache round trips was ~10s.
    lectures = await asyncio.gather(*(station(lec) for lec in course["lectures"]))
    return {**course, "lectures": list(lectures)}


#: Words that join a topic's name rather than name it — matching them finds everything.
_STOPWORDS = {
    "and", "or", "the", "of", "in", "to", "a", "an", "for", "with", "vs", "on", "by", "is", "are",
    "how", "what", "why", "understanding", "introduction", "overview", "basics", "fundamentals",
    "und", "oder", "der", "die", "das", "von", "mit", "im", "zu", "ein", "eine",
}


def _tsquery(text: str, joiner: str) -> Optional[str]:
    words = [w for w in re.findall(r"[\w+\-]+", text.lower()) if len(w) > 1 and w not in _STOPWORDS][:8]
    if not words:
        return None
    return f" {joiner} ".join(f"{re.sub(r'[^a-z0-9äöüß]', '', w) or w}:*" for w in words if re.sub(r'[^a-z0-9äöüß]', '', w))


def _clean_snippet(text: str) -> str:
    """One line, without the deck's running footer ("Slide 67", the author's name)."""
    text = re.sub(r"\bSlide\s+\d+\b", " ", text)
    # Bullet glyphs from the deck's symbol fonts land in the Unicode private-use area.
    text = re.sub("[\ue000-\uf8ff\u25a0-\u25ff]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:220]


async def find_in_course(
    course_id: UUID,
    query: str,
    limit: int = 8,
    exclude_lecture: Optional[UUID] = None,
    strict: bool = False,
) -> list[dict[str, Any]]:
    """Where a topic is taught: pages across every lecture of the course, best first.

    Full-text search, titles weighted above body text, prefix matching, all
    words first and any word when that finds too little. No model call.
    """
    results: list[dict[str, Any]] = []
    async with await get_db_connection() as conn:
        # `strict`: every word must be there — for connections, where a loose
        # match is a wrong link rather than a near miss.
        for joiner in (("&",) if strict else ("&", "|")):
            tsq = _tsquery(query, joiner)
            if not tsq:
                return []
            rows = await conn.fetch(
                """
                WITH doc AS (
                  SELECT s.lecture_id, s.slide_number, s.title, s.content_text, l.title AS lecture_title,
                         setweight(to_tsvector('english', coalesce(s.title, '')), 'A') ||
                         setweight(to_tsvector('english', coalesce(s.content_text, '')), 'C') AS v
                  FROM slides s JOIN lectures l ON l.id = s.lecture_id
                  WHERE l.course_id = $1 AND COALESCE(l.is_archived, false) = false
                    AND ($4::uuid IS NULL OR l.id <> $4::uuid)
                )
                SELECT lecture_id, lecture_title, slide_number, title,
                       ts_headline('english', coalesce(content_text, ''), to_tsquery('english', $2),
                                   'MaxWords=18, MinWords=8, StartSel=«, StopSel=», MaxFragments=1') AS snippet,
                       ts_rank(v, to_tsquery('english', $2)) AS rank
                FROM doc
                WHERE v @@ to_tsquery('english', $2)
                ORDER BY rank DESC, slide_number
                LIMIT $3
                """,
                course_id,
                tsq,
                limit,
                exclude_lecture,
            )
            results = [
                {
                    "lecture_id": str(r["lecture_id"]),
                    "lecture_title": r["lecture_title"],
                    "page": r["slide_number"],
                    "title": r["title"],
                    "snippet": _clean_snippet(r["snippet"] or ""),
                }
                for r in rows
            ]
            if len(results) >= 3:
                break
    return results
