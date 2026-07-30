"""Creation and retrieval of EN/DE variants of canonical study content.

The source fields on lectures, slides, and quiz_questions remain the only
editable representation.  A localization is a complete snapshot tied to a
single lecture revision; this avoids readers getting a translated title from
one edit and translated slides from another.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, Literal
from uuid import UUID

from backend.core.database import get_db_connection
from backend.services.ai.orchestrator import generate_text_bulk, parse_json_response

logger = logging.getLogger(__name__)
SupportedLocale = Literal["en", "de"]
SUPPORTED_LOCALES: tuple[SupportedLocale, ...] = ("en", "de")

_GERMAN_HINTS = re.compile(
    r"\b(der|die|das|und|mit|für|nicht|eine|einer|einführung|überblick|wissenschaft)\b",
    re.IGNORECASE,
)

# A deck is translated in slide batches rather than as one request. A 41-slide
# lecture serializes to ~40k chars, so a whole-deck translation is a ~10k-token
# completion — more than any provider in the rotation chain finishes inside
# LLM_TIMEOUT_SECONDS, and because that budget covers the *entire* chain, one
# slow provider used to starve every fallback and fail the locale outright.
# Each batch below emits ~1-2k tokens, so a stalled provider gives up early
# enough for the chain to rotate to the next one.
_BATCH_MAX_SLIDES = 8
_BATCH_CHAR_BUDGET = 7000
# Free provider tiers 429 on burst, and the rotator bans a rate-limited
# provider for 90s, so extra parallelism here costs the chain more than it buys.
_BATCH_CONCURRENCY = 2
_BATCH_ATTEMPTS = 2


def detect_source_language(text: str) -> SupportedLocale:
    """Conservative EN/DE detector for PDF text.

    It deliberately defaults to English in an ambiguous deck; the canonical
    content is still generated with an explicit locale and both display
    variants are produced, so this only affects the editor's source badge.
    """
    return "de" if len(_GERMAN_HINTS.findall(text or "")) >= 2 else "en"


async def _fetch_lecture_document(lecture_id: UUID) -> tuple[dict[str, Any], int]:
    async with await get_db_connection() as conn:
        lecture = await conn.fetchrow(
            "SELECT id, title, description, source_language, content_revision, course_id "
            "FROM lectures WHERE id = $1", lecture_id,
        )
        if not lecture:
            raise ValueError("Lecture not found")
        rows = await conn.fetch(
            """
            SELECT s.id AS slide_id, s.slide_number, s.title, s.content_text, s.summary,
                   q.id AS quiz_id, q.question_text, q.options, q.correct_answer, q.metadata
            FROM slides s
            LEFT JOIN quiz_questions q ON q.slide_id = s.id
            WHERE s.lecture_id = $1
            ORDER BY s.slide_number, q.id
            """,
            lecture_id,
        )

    slides: list[dict[str, Any]] = []
    by_id: dict[UUID, dict[str, Any]] = {}
    for row in rows:
        slide = by_id.get(row["slide_id"])
        if slide is None:
            slide = {
                "id": str(row["slide_id"]),
                "slide_number": row["slide_number"],
                "title": row["title"] or "",
                "content_text": row["content_text"] or "",
                "summary": row["summary"] or "",
                "questions": [],
            }
            by_id[row["slide_id"]] = slide
            slides.append(slide)
        if row["quiz_id"] is not None:
            metadata = row["metadata"] or {}
            if isinstance(metadata, str):
                metadata = json.loads(metadata)
            options = row["options"] or []
            if isinstance(options, str):
                options = json.loads(options)
            slide["questions"].append({
                "id": str(row["quiz_id"]),
                "slide_id": str(row["slide_id"]),
                "question_text": row["question_text"] or "",
                "options": options,
                "correct_answer": row["correct_answer"],
                "explanation": metadata.get("explanation", ""),
                "concept": metadata.get("concept", ""),
                "cognitive_level": metadata.get("cognitive_level"),
                "linked_slides": metadata.get("linked_slides"),
            })
    return {
        "lecture": {
            "id": str(lecture["id"]),
            "title": lecture["title"] or "",
            "description": lecture["description"] or "",
            "source_language": lecture["source_language"],
            "course_id": str(lecture["course_id"]) if lecture["course_id"] else None,
        },
        "slides": slides,
    }, int(lecture["content_revision"])


def _translation_prompt(document: dict[str, Any], target: SupportedLocale) -> str:
    language = "German" if target == "de" else "English"
    return f"""Translate this university study-content JSON into {language}.
Return ONLY valid JSON with exactly the same structure and ids. Translate only
human-readable strings: lecture title/description, slide title/content_text/
summary, and every quiz question/options/explanation/concept. Never change an
id, slide_number, correct_answer, cognitive_level, linked_slides, array length,
or JSON key. Keep technical terms accurate and preserve Markdown/LaTex.

{json.dumps(document, ensure_ascii=False)}"""


def _batch_slides(slides: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """Group slides so each translation request stays a small completion.

    Always returns at least one batch: a deck with no slides still needs one
    request for the lecture title/description.
    """
    batches: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    size = 0
    for slide in slides:
        cost = len(json.dumps(slide, ensure_ascii=False))
        if current and (len(current) >= _BATCH_MAX_SLIDES or size + cost > _BATCH_CHAR_BUDGET):
            batches.append(current)
            current, size = [], 0
        current.append(slide)
        size += cost
    if current:
        batches.append(current)
    return batches or [[]]


def _validate_translation(
    source: dict[str, Any], translated: Any, target: SupportedLocale,
) -> None:
    """Structural validation is intentionally strict: bad variants must never
    publish with mismatched quiz indices or a missing slide.

    Applied to every batch response and again to the assembled document, so
    neither a single bad batch nor a dropped/duplicated batch can publish.
    """
    if not isinstance(translated, dict):
        raise ValueError(f"Localization model returned invalid {target} JSON")
    # Batches after the first carry no lecture object to translate.
    if source.get("lecture") is not None:
        if translated.get("lecture", {}).get("id") != source["lecture"]["id"]:
            raise ValueError("Localization changed lecture identity")
    source_slides = source.get("slides", [])
    target_slides = translated.get("slides", [])
    if len(source_slides) != len(target_slides):
        raise ValueError("Localization changed slide count")
    for original, localized in zip(source_slides, target_slides):
        if localized.get("id") != original.get("id") or localized.get("slide_number") != original.get("slide_number"):
            raise ValueError("Localization changed slide identity")
        if len(localized.get("questions", [])) != len(original.get("questions", [])):
            raise ValueError("Localization changed quiz count")
        for oq, lq in zip(original.get("questions", []), localized.get("questions", [])):
            if (
                lq.get("id") != oq.get("id")
                or lq.get("slide_id") != oq.get("slide_id")
                or lq.get("correct_answer") != oq.get("correct_answer")
            ):
                raise ValueError("Localization changed quiz answer identity")
            if len(lq.get("options", [])) != len(oq.get("options", [])):
                raise ValueError("Localization changed quiz option count")


async def _translate_batch(
    payload: dict[str, Any], target: SupportedLocale, ai_model: str,
) -> dict[str, Any]:
    raw = await generate_text_bulk(_translation_prompt(payload, target), ai_model=ai_model)
    translated = parse_json_response(raw)
    _validate_translation(payload, translated, target)
    return translated


async def _translate_document(document: dict[str, Any], target: SupportedLocale, ai_model: str) -> dict[str, Any]:
    source = document["lecture"].get("source_language")
    if source == target:
        return document

    batches = _batch_slides(document.get("slides", []))
    payloads: list[dict[str, Any]] = [
        # The lecture object rides along with the first batch instead of taking
        # a request of its own — it is two short strings.
        {"lecture": document["lecture"], "slides": batch} if index == 0 else {"slides": batch}
        for index, batch in enumerate(batches)
    ]

    semaphore = asyncio.Semaphore(_BATCH_CONCURRENCY)

    async def translate(payload: dict[str, Any], index: int) -> dict[str, Any]:
        async with semaphore:
            last_exc: Exception | None = None
            for attempt in range(1, _BATCH_ATTEMPTS + 1):
                try:
                    return await _translate_batch(payload, target, ai_model)
                except Exception as exc:
                    last_exc = exc
                    logger.warning(
                        "localization batch %d/%d (%s) attempt %d failed: %s",
                        index + 1, len(payloads), target, attempt, exc,
                    )
            raise last_exc or RuntimeError("Localization batch failed")

    results = await asyncio.gather(
        *(translate(payload, index) for index, payload in enumerate(payloads)),
        return_exceptions=True,
    )
    for result in results:
        if isinstance(result, BaseException):
            raise result

    localized_lecture = results[0].get("lecture") or {}
    translated = {
        # Keep the canonical id/source_language and take only the translated
        # display strings, so a chatty model cannot rewrite lecture identity.
        "lecture": {
            **document["lecture"],
            **{
                key: value for key, value in localized_lecture.items()
                if key in ("title", "description") and isinstance(value, str)
            },
        },
        "slides": [slide for result in results for slide in (result.get("slides") or [])],
    }
    _validate_translation(document, translated, target)
    return translated


async def _store_localization(
    lecture_id: UUID, locale: SupportedLocale, revision: int, *, status: str,
    content: dict[str, Any] | None = None, error: str | None = None,
) -> None:
    async with await get_db_connection() as conn:
        await conn.execute(
            """
            INSERT INTO lecture_localizations
                (lecture_id, locale, source_revision, status, content, error, updated_at)
            VALUES ($1, $2, $3, $4, $5::jsonb, $6, now())
            ON CONFLICT (lecture_id, locale) DO UPDATE
            SET source_revision = EXCLUDED.source_revision, status = EXCLUDED.status,
                content = EXCLUDED.content, error = EXCLUDED.error, updated_at = now()
            """,
            lecture_id, locale, revision, status, json.dumps(content or {}), error,
        )


async def localize_lecture(lecture_id: UUID, ai_model: str) -> None:
    """Build both variants in parallel and publish only complete snapshots."""
    document, revision = await _fetch_lecture_document(lecture_id)
    await asyncio.gather(*[
        _store_localization(lecture_id, locale, revision, status="pending")
        for locale in SUPPORTED_LOCALES
    ])
    results = await asyncio.gather(*[
        _translate_document(document, locale, ai_model) for locale in SUPPORTED_LOCALES
    ], return_exceptions=True)
    failures: list[str] = []
    for locale, result in zip(SUPPORTED_LOCALES, results):
        if isinstance(result, Exception):
            message = str(result)
            await _store_localization(lecture_id, locale, revision, status="failed", error=message)
            failures.append(f"{locale}: {message}")
        else:
            await _store_localization(lecture_id, locale, revision, status="ready", content=result)
    if failures:
        raise RuntimeError("Localization failed (" + "; ".join(failures) + ")")


async def localize_lecture_job(ctx: dict, lecture_id: str, ai_model: str | None = None) -> dict[str, Any]:
    """Arq entry point for rebuilding a locale snapshot outside a parse.

    A translation failure no longer discards a parsed deck, so the retry lives
    here. It raises arq's ``Retry`` rather than a plain exception: a plain one
    is recorded as failed and never re-run, which is exactly the outcome this
    job exists to avoid when a provider is briefly down or rate-limited.
    """
    from arq.worker import Retry

    from backend.core.config import settings

    lid = UUID(lecture_id)
    async with await get_db_connection() as conn:
        ready = await conn.fetchval(
            """
            SELECT count(*) FROM lecture_localizations ll
            JOIN lectures l ON l.id = ll.lecture_id
            WHERE ll.lecture_id = $1 AND ll.status = 'ready'
              AND ll.source_revision = l.content_revision
            """,
            lid,
        )
    if int(ready or 0) >= len(SUPPORTED_LOCALES):
        return {"lecture_id": lecture_id, "status": "ready", "skipped": True}

    try:
        await localize_lecture(lid, ai_model or settings.parser_llm_model or "cerebras")
    except Exception as exc:
        job_try = int(ctx.get("job_try", 1) or 1)
        logger.warning("localization retry %d for lecture %s failed: %s", job_try, lecture_id, exc)
        # Backoff gives a rate-limited provider chain time to recover; arq stops
        # re-queuing at WorkerSettings.max_tries.
        raise Retry(defer=min(60 * 2 ** (job_try - 1), 900))
    logger.info("localization rebuilt for lecture %s", lecture_id)
    return {"lecture_id": lecture_id, "status": "ready"}


async def get_localized_lecture(lecture_id: UUID, locale: SupportedLocale) -> dict[str, Any] | None:
    """Return a ready localized snapshot only when it matches source revision."""
    async with await get_db_connection() as conn:
        row = await conn.fetchrow(
            """
            SELECT ll.content, ll.source_revision
            FROM lecture_localizations ll
            JOIN lectures l ON l.id = ll.lecture_id
            WHERE ll.lecture_id = $1 AND ll.locale = $2
              AND ll.status = 'ready' AND ll.source_revision = l.content_revision
            """,
            lecture_id, locale,
        )
    if not row:
        return None
    content = row["content"]
    return json.loads(content) if isinstance(content, str) else content


async def increment_content_revision(lecture_id: UUID) -> int:
    """Invalidate old locale snapshots after a canonical editor/AI write."""
    async with await get_db_connection() as conn:
        return await conn.fetchval(
            "UPDATE lectures SET content_revision = content_revision + 1 WHERE id = $1 "
            "RETURNING content_revision",
            lecture_id,
        )


async def localize_course(course_id: UUID, ai_model: str) -> None:
    """Create EN/DE title and description variants for a course container."""
    async with await get_db_connection() as conn:
        row = await conn.fetchrow(
            "SELECT title, description, content_revision FROM courses WHERE id = $1", course_id,
        )
    if not row:
        return
    source = {"title": row["title"] or "", "description": row["description"] or ""}
    revision = int(row["content_revision"])
    source_language = detect_source_language(" ".join(source.values()))

    async def translate(locale: SupportedLocale) -> tuple[SupportedLocale, dict[str, Any] | Exception]:
        try:
            if locale == source_language:
                return locale, source
            raw = await generate_text_bulk(
                f"Translate this course metadata JSON to {'German' if locale == 'de' else 'English'}. "
                f"Return only JSON with title and description; preserve meaning.\n{json.dumps(source, ensure_ascii=False)}",
                ai_model=ai_model,
            )
            parsed = parse_json_response(raw)
            if not isinstance(parsed, dict) or not isinstance(parsed.get("title"), str) or not isinstance(parsed.get("description"), str):
                raise ValueError("Invalid localized course metadata")
            return locale, parsed
        except Exception as exc:
            return locale, exc

    results = await asyncio.gather(*(translate(locale) for locale in SUPPORTED_LOCALES))
    async with await get_db_connection() as conn:
        for locale, result in results:
            is_error = isinstance(result, Exception)
            await conn.execute(
                """
                INSERT INTO course_localizations (course_id, locale, source_revision, status, title, description, error, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, now())
                ON CONFLICT (course_id, locale) DO UPDATE
                SET source_revision = EXCLUDED.source_revision, status = EXCLUDED.status,
                    title = EXCLUDED.title, description = EXCLUDED.description,
                    error = EXCLUDED.error, updated_at = now()
                """,
                course_id, locale, revision, "failed" if is_error else "ready",
                "" if is_error else result["title"], "" if is_error else result["description"],
                str(result) if is_error else None,
            )
    failed = [locale for locale, result in results if isinstance(result, Exception)]
    if failed:
        raise RuntimeError("Course localization failed for " + ", ".join(failed))


async def get_localized_course(course_id: UUID, locale: SupportedLocale) -> dict[str, Any] | None:
    async with await get_db_connection() as conn:
        row = await conn.fetchrow(
            """
            SELECT cl.title, cl.description
            FROM course_localizations cl JOIN courses c ON c.id = cl.course_id
            WHERE cl.course_id = $1 AND cl.locale = $2 AND cl.status = 'ready'
              AND cl.source_revision = c.content_revision
            """,
            course_id, locale,
        )
    return dict(row) if row else None
