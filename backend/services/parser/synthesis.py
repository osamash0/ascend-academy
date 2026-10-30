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

from backend.services.ai.call_context import llm_call_scope
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
    SYNTHESIS_QUIZ_VERIFY_PROMPT,
    output_language as _output_language,
)
from backend.services.ai.quiz_validator import _normalize_answer_index
from backend.services.ai.voice import with_voice
from backend.services.parser.deck_plan import (
    DeckSkeleton,
    build_deck_skeleton,
    select_meta_slides,
    select_slides,
)
from backend.services.parser.quiz_grounding import STRUCTURAL_REASONS, GroundingVerdict, assess_grounding

logger = logging.getLogger(__name__)

# The deck-quiz prompt asks for 5-8 questions; the model's list length is
# untrusted, so it bounds how many repair LLM calls a parse can trigger.
MAX_DECK_QUIZ_QUESTIONS = 12
MAX_CONCURRENT_REPAIRS = 3

# Grounding is ADVISORY by default: content verdicts (low_support, ambiguous,
# number_not_on_slide) keep the question and flag it (`grounding_flag`) instead
# of dropping it. The verifier is a lexical-overlap filter; measured by the
# drop-risk probe (commit c50a97f) at SUPPORT_THRESHOLD=0.5 it falsely drops
# 87.5% of genuine paraphrased questions (14/16, all 8 German) while falsely
# keeping 0% of on-topic hallucinations. Do NOT re-enable enforcement without a
# semantic scorer and a re-run of that probe. Structural verdicts are dropped
# in both modes.
ENFORCE_SUPPORT_THRESHOLD = False

# The answer check (LS-115) is the semantic step the lexical verifier lacks: a
# model answers each question from its cited slide WITHOUT seeing the key. A
# different answer, a second defensible option, or no supported option is a
# dispute: one repair against the slide, checked again, else the question is
# dropped — in both modes, since a key that marks a careful reader wrong does
# more harm than a missing question. A failed or unreadable check keeps the
# question as before.
# Measured 2026-10-30 with backend/eval/quiz_answer_check.py (drop-risk probe +
# LS-115): false drops 0/16 (lexical enforcement: 14/16), false keeps 0/16,
# LS-115 disputed 5/5 and its sound twin agreed 5/5.
CHECK_ANSWERS = True
# The checker is not the author: the quality chain led by Groq's reasoning
# model, not the bulk model that wrote the question. Checked by the bulk model
# (gpt-4o-mini) instead, LS-115 was agreed twice — it shared the author's
# misreading. openai_only resolves this to openai.
CHECK_MODEL = "groq"
# Low, so a parse does not trip Groq's rate limit (one check fell back and
# timed out in the measurement run at sequential load).
MAX_CONCURRENT_CHECKS = 2
_OPTION_LETTERS = "ABCDEFGH"
# What a model writes for "no option" instead of a JSON null.
_NO_ANSWER = frozenset({"", "null", "none", "n/a", "keine"})


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
    picked = select_meta_slides(skeleton)
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
    (`source_slide`). `ground_deck_quiz` runs in advisory mode by default:
    structurally failing questions are dropped, while low-overlap questions
    are kept and flagged (`grounding_flag` plus `support_score`). Only when
    ENFORCE_SUPPORT_THRESHOLD is True does it repair each unsupported
    question once and then drop it.

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


def _flagged(q: Dict[str, Any], verdict: GroundingVerdict) -> Dict[str, Any]:
    return {**_grounded(q, verdict), "grounding_flag": verdict.reason}


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
        with llm_call_scope(prompt_name="SYNTHESIS_QUIZ_REPAIR_PROMPT",
                            slide_indices=(slide_number - 1,)):
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


def _option_index(value: Any, options: List[Any]) -> int | None:
    """The option a checker names: "B", "b", "B)", "(B)", or the option's own text."""
    if not isinstance(value, str):
        return None
    text = value.strip()
    letter = text.strip("()[]. ").upper()
    if len(letter) == 1 and letter in _OPTION_LETTERS[: len(options)]:
        return _OPTION_LETTERS.index(letter)
    for i, opt in enumerate(options):
        if isinstance(opt, str) and opt.strip().casefold() == text.casefold():
            return i
    return None


async def _check_answer(
    q: Dict[str, Any],
    slide_number: int,
    skeleton: DeckSkeleton,
    ai_model: str,
) -> str:
    """"agreed", "disputed" or "error". The checker sees the cited slide, the
    stem and the options in order — never the key or the explanation."""
    options = q.get("options")
    key = _normalize_answer_index(q)
    if not isinstance(options, list) or not options or key is None:
        return "error"
    listed = "\n".join(f"{letter}) {opt}" for letter, opt in zip(_OPTION_LETTERS, options))
    prompt = SYNTHESIS_QUIZ_VERIFY_PROMPT.format(
        slide_number=slide_number,
        slide_text=skeleton.slides[slide_number - 1].text[:1500],
        question=str(q.get("question") or "")[:500],
        options=listed,
    )
    try:
        with llm_call_scope(prompt_name="SYNTHESIS_QUIZ_VERIFY_PROMPT",
                            slide_indices=(slide_number - 1,)):
            raw = await generate_text(prompt, ai_model=CHECK_MODEL, json_mode=True)
    except Exception as exc:
        logger.warning("deck quiz answer check failed (non-fatal): %s", exc)
        return "error"
    res = parse_json_response(raw)
    if not isinstance(res, dict) or "answer" not in res or not isinstance(res.get("also_fits", []), list):
        return "error"
    answer = res["answer"]
    if isinstance(answer, str) and answer.strip().casefold() in _NO_ANSWER:
        answer = None
    picked = None if answer is None else _option_index(answer, options)
    if answer is not None and picked is None:
        return "error"
    others = {_option_index(o, options) for o in res.get("also_fits") or []} - {None, picked}
    return "agreed" if picked == key and not others else "disputed"


async def ground_deck_quiz(
    questions: List[Any],
    skeleton: DeckSkeleton,
    lecture_title: str,
    ai_model: str,
    source_language: str = "en",
    stats: Dict[str, Any] | None = None,
) -> List[Dict[str, Any]]:
    """Verify each question against its cited slide.

    A question with no usable slide or answer (missing, garbage, out of
    range, empty slide, no key) is dropped without a repair in every mode:
    there is nothing to repair against. A content verdict (low_support,
    ambiguous, number_not_on_slide) is advisory by default: the question is
    kept and flagged via ``grounding_flag``. With ENFORCE_SUPPORT_THRESHOLD it
    instead gets ONE regeneration against its cited slide, then is dropped.
    Every question that would be kept then goes through the answer check
    (CHECK_ANSWERS): a dispute gets one regeneration, if it has not had one,
    and a question still disputed is dropped. Logs one ``deck_quiz_grounding
    {json}`` line (proposed/kept/repaired/dropped + drop reasons + answer
    check) and, when ``stats`` is given, merges the same summary into it for
    the parse receipt."""
    # (question | None, was_repaired, drop_reason)
    proposed = len(questions)
    over_cap = max(0, proposed - MAX_DECK_QUIZ_QUESTIONS)
    questions = questions[:MAX_DECK_QUIZ_QUESTIONS]
    repair_slots = asyncio.Semaphore(MAX_CONCURRENT_REPAIRS)
    check_slots = asyncio.Semaphore(MAX_CONCURRENT_CHECKS)
    # First check per question only; a repair's re-check shows in repaired/dropped.
    checks = {"agreed": 0, "disputed": 0, "errors": 0}

    async def _checked(q: Any) -> tuple[Dict[str, Any] | None, bool, str]:
        try:
            return await _one(q)
        except Exception:
            logger.warning("deck quiz grounding errored; dropping question", exc_info=True)
            return None, False, "grounding_error"

    async def _repair(q: Dict[str, Any], slide: int) -> Dict[str, Any] | None:
        async with repair_slots:
            return await _repair_question(q, slide, skeleton, lecture_title, ai_model, source_language)

    async def _answer(q: Dict[str, Any], slide: int) -> str:
        async with check_slots:
            return await _check_answer(q, slide, skeleton, ai_model)

    async def _lexical(q: Any) -> tuple[Dict[str, Any] | None, bool, str]:
        if not isinstance(q, dict):
            return None, False, "not_an_object"
        verdict = assess_grounding(q, skeleton)
        if verdict.ok:
            return _grounded(q, verdict), False, ""
        if verdict.reason in STRUCTURAL_REASONS or verdict.source_slide is None:
            return None, False, verdict.reason
        if not ENFORCE_SUPPORT_THRESHOLD:
            return _flagged(q, verdict), False, ""
        repaired = await _repair(q, verdict.source_slide)
        if repaired is None:
            return None, False, "repair_failed"
        second = assess_grounding(repaired, skeleton)
        if second.ok:
            return _grounded(repaired, second), True, ""
        return None, False, f"repair_{second.reason}"

    async def _one(q: Any) -> tuple[Dict[str, Any] | None, bool, str]:
        kept_q, was_repaired, reason = await _lexical(q)
        if kept_q is None or not CHECK_ANSWERS:
            return kept_q, was_repaired, reason
        slide = kept_q["source_slide"]
        status = await _answer(kept_q, slide)
        checks["errors" if status == "error" else status] += 1
        if status != "disputed":
            return kept_q, was_repaired, ""
        if was_repaired:
            return None, False, "disputed"
        repaired = await _repair(kept_q, slide)
        if repaired is None:
            return None, False, "disputed"
        second = assess_grounding(repaired, skeleton)
        if second.reason in STRUCTURAL_REASONS or second.source_slide is None:
            return None, False, "disputed"
        if not second.ok and ENFORCE_SUPPORT_THRESHOLD:
            return None, False, "disputed"
        if await _answer(repaired, second.source_slide) == "disputed":
            return None, False, "disputed"
        return (_grounded if second.ok else _flagged)(repaired, second), True, ""

    results = await asyncio.gather(*(_checked(q) for q in questions))
    kept = [r for r, _, _ in results if r is not None]
    flag_reasons: Dict[str, int] = {}
    for r, _, _ in results:
        if r is not None and r.get("grounding_flag"):
            flag_reasons[r["grounding_flag"]] = flag_reasons.get(r["grounding_flag"], 0) + 1
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
        "flagged": sum(flag_reasons.values()),
        "flag_reasons": flag_reasons,
    }
    if CHECK_ANSWERS:
        summary["answer_check"] = checks
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
        if q.get("grounding_flag"):
            entry["grounding_flag"] = q["grounding_flag"]
        mapped.append(entry)
    if dropped:
        logger.warning(
            "V4 quiz: dropped %d of %d questions with unresolvable answers",
            dropped, len(quiz_questions),
        )
    return mapped
