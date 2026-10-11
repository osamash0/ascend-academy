"""Per-slide + lecture-level LLM synthesis helpers for the unified pipeline.

These are the content-generation primitives the live unified orchestrator
(`unified_orchestrator.py`, PARSER_VERSION=5) calls: one focused LLM call per
slide (`analyze_slide`), a lecture-level title/summary pass
(`analyze_lecture_meta`), and a deck-level quiz (`generate_quiz_questions` +
`_map_deck_quiz`, whose answer index is validated so a wrong key is never
shipped).

Standalone by design: this module imports only the AI orchestrator and the
shared quiz validator, never any legacy parser orchestrator (v3/v4). PDF bytes,
when needed, are fetched via `parser.storage._fetch_pdf_bytes`.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, List

from backend.services.ai.orchestrator import (
    generate_text_bulk,
    generate_text,
    parse_json_response,
)
from backend.services.ai.prompts import (
    CROSS_LECTURE_QUIZ_PROMPT,
    LECTURE_META_ANALYSIS_PROMPT,
    SLIDE_ANALYSIS_PROMPT,
    SYLLABUS_FACTS_EXTRACTION_PROMPT,
    SYNTHESIS_DECK_QUIZ_PROMPT,
    SYNTHESIS_QUIZ_REPAIR_PROMPT,
    output_language as _output_language,
)
from backend.services.ai.quiz_validator import _normalize_answer_index
from backend.services.ai.voice import with_voice
from backend.services.parser.deck_plan import (
    META_ROLES,
    DeckSkeleton,
    build_deck_skeleton,
    select_slides,
)
from backend.services.parser.quiz_grounding import GroundingVerdict, assess_grounding

logger = logging.getLogger(__name__)

# The deck-quiz prompt asks for 5-8 questions; the model's list length is
# untrusted, so it bounds how many repair LLM calls a parse can trigger.
MAX_DECK_QUIZ_QUESTIONS = 12
MAX_CONCURRENT_REPAIRS = 3


# ---------------------------------------------------------------------------
# LLM helpers
# ---------------------------------------------------------------------------

async def analyze_lecture_meta(
    slides: List[str],
    ai_model: str,
    course_context_hint: str = "",
    source_language: str = "en",
    skeleton: DeckSkeleton | None = None,
) -> Dict[str, Any]:
    """One LLM call on up to 15 slides spread across the whole deck (plus the
    title slide) to extract lecture-level metadata.

    ``course_context_hint`` (Roadmap Phase 3.4, "new-upload awareness") is an
    optional short block of prior-lecture titles/concepts from the same
    course, appended to the prompt so title/summary wording stays consistent
    with earlier lectures. Empty by default — the prompt is then BYTE-
    IDENTICAL to before this parameter existed (regression guard).
    """
    skeleton = skeleton or build_deck_skeleton(slides)
    picked = select_slides(skeleton, 15, META_ROLES, min_chars=1)
    if skeleton.slides and 0 not in picked:
        picked = [0] + picked[:14]
    combined_text = "\n\n".join(
        f"[Slide {i + 1}]: {skeleton.slides[i].text[:400]}" for i in picked
    )
    prompt = LECTURE_META_ANALYSIS_PROMPT.format(
        combined_text=combined_text,
        output_language=_output_language(source_language),
    )
    if course_context_hint:
        prompt += f"\n\nFor consistent terminology, this course already covers:\n{course_context_hint}"
    raw = await generate_text(prompt, ai_model=ai_model)
    return parse_json_response(raw)


async def analyze_slide(
    slide_number: int,
    text: str,
    lecture_context: str,
    ai_model: str,
    source_language: str = "en",
) -> Dict[str, Any]:
    """Analyze a single slide; returns the LLM result dict."""
    prompt = SLIDE_ANALYSIS_PROMPT.format(
        lecture_context=lecture_context[:1000],
        slide_number=slide_number,
        text=text[:1500],
        output_language=_output_language(source_language),
    )
    raw = await generate_text_bulk(with_voice(prompt, structured=True), ai_model=ai_model)
    res = parse_json_response(raw)
    if not isinstance(res, dict):
        res = {}
    res["slide_index"] = slide_number - 1
    res["content"] = text if text.strip() else res.get("aiInsight") or res.get("title") or "No extractable text."
    return res


async def generate_quiz_questions(
    slides: List[str],
    lecture_title: str,
    ai_model: str,
    source_language: str = "en",
    skeleton: DeckSkeleton | None = None,
    stats: Dict[str, Any] | None = None,
) -> List[Dict[str, Any]]:
    """Generate 5–8 deck-level MCQs from content-rich slides spread across
    every section of the deck, labelled with their real slide numbers.

    Every question must cite the slide its answer is stated on
    (`source_slide`); `ground_deck_quiz` keeps only questions that slide
    supports, after at most one repair each.

    ``stats`` (Arc 5 parse receipts), when given, receives the grounding
    summary; it stays empty when no quiz was attempted."""
    skeleton = skeleton or build_deck_skeleton(slides)
    picked = select_slides(skeleton, 10)
    if not picked:
        return []

    slide_summary = "\n\n".join(
        f"[Slide {i + 1}]: {skeleton.slides[i].text[:500]}" for i in picked
    )
    prompt = SYNTHESIS_DECK_QUIZ_PROMPT.format(
        lecture_title=lecture_title,
        slide_summary=slide_summary,
        output_language=_output_language(source_language),
    )
    raw = await generate_text_bulk(with_voice(prompt, structured=True), ai_model=ai_model)
    res = parse_json_response(raw)
    if not isinstance(res, list):
        return []
    return await ground_deck_quiz(res, skeleton, lecture_title, ai_model, source_language, stats=stats)


def _grounded(q: Dict[str, Any], verdict: GroundingVerdict) -> Dict[str, Any]:
    return {**q, "source_slide": verdict.source_slide, "support_score": round(verdict.score, 3)}


async def _repair_question(
    q: Dict[str, Any],
    slide_number: int,
    skeleton: DeckSkeleton,
    lecture_title: str,
    ai_model: str,
    source_language: str,
) -> Dict[str, Any] | None:
    """One regeneration against the cited slide only. The returned question
    is pinned to that slide, so a model cannot repair by relocating."""
    prompt = SYNTHESIS_QUIZ_REPAIR_PROMPT.format(
        lecture_title=lecture_title,
        concept=str(q.get("concept") or q.get("question") or "")[:200],
        slide_number=slide_number,
        slide_text=skeleton.slides[slide_number - 1].text[:1500],
        output_language=_output_language(source_language),
    )
    try:
        raw = await generate_text_bulk(with_voice(prompt, structured=True), ai_model=ai_model)
    except Exception as exc:
        logger.warning("deck quiz repair failed (non-fatal): %s", exc)
        return None
    res = parse_json_response(raw)
    if isinstance(res, list) and res and isinstance(res[0], dict):
        res = res[0]
    if not isinstance(res, dict) or not res:
        return None
    return {**res, "source_slide": slide_number}


async def ground_deck_quiz(
    questions: List[Any],
    skeleton: DeckSkeleton,
    lecture_title: str,
    ai_model: str,
    source_language: str = "en",
    stats: Dict[str, Any] | None = None,
) -> List[Dict[str, Any]]:
    """Keep only questions whose cited slide supports the key.

    A question below the support threshold gets ONE regeneration against its
    cited slide, then is dropped. A question with no usable slide (missing,
    garbage, out of range, empty) is dropped without a repair: there is
    nothing to repair against. Logs one ``deck_quiz_grounding {json}`` line
    (proposed/kept/repaired/dropped + drop reasons) and, when ``stats`` is
    given, merges the same summary into it for the parse receipt."""
    # (question | None, was_repaired, drop_reason)
    proposed = len(questions)
    over_cap = max(0, proposed - MAX_DECK_QUIZ_QUESTIONS)
    questions = questions[:MAX_DECK_QUIZ_QUESTIONS]
    repair_slots = asyncio.Semaphore(MAX_CONCURRENT_REPAIRS)

    async def _checked(q: Any) -> tuple[Dict[str, Any] | None, bool, str]:
        try:
            return await _one(q)
        except Exception:
            logger.warning("deck quiz grounding errored; dropping question", exc_info=True)
            return None, False, "grounding_error"

    async def _one(q: Any) -> tuple[Dict[str, Any] | None, bool, str]:
        if not isinstance(q, dict):
            return None, False, "not_an_object"
        verdict = assess_grounding(q, skeleton)
        if verdict.ok:
            return _grounded(q, verdict), False, ""
        if verdict.source_slide is None:
            return None, False, verdict.reason
        async with repair_slots:
            repaired = await _repair_question(
                q, verdict.source_slide, skeleton, lecture_title, ai_model, source_language,
            )
        if repaired is None:
            return None, False, "repair_failed"
        second = assess_grounding(repaired, skeleton)
        if second.ok:
            return _grounded(repaired, second), True, ""
        return None, False, f"repair_{second.reason}"

    results = await asyncio.gather(*(_checked(q) for q in questions))
    kept = [r for r, _, _ in results if r is not None]
    reasons: Dict[str, int] = {}
    for r, _, reason in results:
        if r is None:
            reasons[reason] = reasons.get(reason, 0) + 1
    if over_cap:
        reasons["over_cap"] = over_cap
    summary = {
        "proposed": proposed,
        "kept": len(kept),
        "repaired": sum(1 for _, was_repaired, _ in results if was_repaired),
        "dropped": proposed - len(kept),
        "drop_reasons": reasons,
    }
    logger.info("deck_quiz_grounding %s", json.dumps(summary, sort_keys=True))
    if stats is not None:
        stats.update(summary)
    return kept


async def generate_cross_lecture_questions(
    lecture_title: str,
    prior_lectures: List[Dict[str, Any]],
    ai_model: str,
) -> List[Dict[str, Any]]:
    """Up to 2 "connects to earlier material" MCQs linking this lecture to a
    concept from an earlier lecture in the same course (Roadmap Phase 3.4).

    ``prior_lectures`` items look like {"id", "title", "top_concept"} (see
    course_context_service.get_course_synthesis_context) — only entries with
    a non-empty top_concept are usable. Returns [] (no LLM call) when there's
    nothing to connect to. Each returned dict carries an internal
    ``_source_lecture_id``/``_source_lecture_title`` so the caller can tag the
    question's metadata with which prior lecture it draws on.
    """
    candidates = [p for p in prior_lectures if p.get("top_concept")][:2]
    if not candidates:
        return []

    concept_list = "\n".join(f'- "{p["top_concept"]}" (from lecture: {p["title"]})' for p in candidates)
    prompt = CROSS_LECTURE_QUIZ_PROMPT.format(
        num_candidates=len(candidates),
        lecture_title=lecture_title,
        concept_list=concept_list,
    )
    try:
        raw = await generate_text_bulk(with_voice(prompt, structured=True), ai_model=ai_model)
        res = parse_json_response(raw)
    except Exception as exc:
        logger.warning("cross-lecture quiz generation failed (non-fatal): %s", exc)
        return []
    if not isinstance(res, list):
        return []

    by_concept = {p["top_concept"]: p for p in candidates}
    out: List[Dict[str, Any]] = []
    for q in res[:2]:
        if not isinstance(q, dict):
            continue
        src = by_concept.get(q.get("source_concept"))
        if not src:
            continue
        q["_source_lecture_id"] = src["id"]
        q["_source_lecture_title"] = src["title"]
        out.append(q)
    return out


def _map_cross_lecture_quiz(questions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Like `_map_deck_quiz`, but for the small cross-lecture batch — carries
    the source-lecture tag through so persist.insert_deck_quizzes can record
    it in the question's metadata. Answer resolution follows the same
    drop-not-default rule as every other quiz mapper in this module."""
    mapped: List[Dict[str, Any]] = []
    for q in questions:
        options = q.get("options", ["", "", "", ""])
        ans_idx = _normalize_answer_index(q)
        if ans_idx is None:
            logger.warning(
                "cross-lecture quiz: dropping question with unresolvable answer=%r",
                q.get("correctAnswer"),
            )
            continue
        mapped.append({
            "question": q.get("question", ""),
            "options": options,
            "correctAnswer": ans_idx,
            "explanation": q.get("explanation", ""),
            "concept": q.get("source_concept", ""),
            "linked_slides": [0],
            "source_lecture_id": q.get("_source_lecture_id"),
            "source_lecture_title": q.get("_source_lecture_title"),
        })
    return mapped


async def extract_syllabus_facts(text: str, ai_model: str) -> Dict[str, Any]:
    """Extract structured course facts from an administrative/organizational
    slide's text (Roadmap Phase 3, "course brain"). Best-effort — callers
    treat a failure or empty result as "nothing extracted", never fatal."""
    prompt = SYLLABUS_FACTS_EXTRACTION_PROMPT.format(text=text[:2000])
    try:
        raw = await generate_text(prompt, ai_model=ai_model)
        res = parse_json_response(raw)
        return res if isinstance(res, dict) else {}
    except Exception as exc:
        logger.warning("syllabus fact extraction failed (non-fatal): %s", exc)
        return {}


def _map_deck_quiz(quiz_questions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Map raw LLM quiz dicts to the stored/SSE deck-quiz shape.

    The correct-answer index is resolved with the shared quiz validator
    (handles answer given as option text, letter, or index). A question whose
    answer can't be matched to an option is DROPPED (and logged) rather than
    silently defaulted to option A — shipping a wrong answer key to students
    is worse than shipping fewer questions.
    """
    mapped: List[Dict[str, Any]] = []
    dropped = 0
    for q in quiz_questions:
        options = q.get("options", ["", "", "", ""])
        ans_idx = _normalize_answer_index(q)
        if ans_idx is None:
            dropped += 1
            logger.warning(
                "V4 quiz: dropping question with unresolvable correctAnswer=%r (options=%r)",
                q.get("correctAnswer"), options,
            )
            continue
        # source_slide is the verified 1-based deck number (Arc 4); slideId is
        # the pre-v3 key, kept so stubbed/older output still maps.
        # Frontend/embeddings use the 0-based index.
        src = q.get("source_slide")
        if src is None:
            src = q.get("slideId", 1)
        try:
            slide_id_0 = max(0, int(src) - 1)
        except (TypeError, ValueError):
            slide_id_0 = 0
        entry = {
            "question": q.get("question", ""),
            "options": options,
            "correctAnswer": ans_idx,
            "explanation": q.get("explanation", ""),
            "concept": q.get("concept", ""),
            "difficulty": q.get("difficulty", ""),
            "linked_slides": [slide_id_0],
        }
        if q.get("support_score") is not None:
            entry["support_score"] = q["support_score"]
        mapped.append(entry)
    if dropped:
        logger.warning(
            "V4 quiz: dropped %d of %d questions with unresolvable answers",
            dropped, len(quiz_questions),
        )
    return mapped
