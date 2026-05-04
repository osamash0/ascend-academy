"""Lightweight quality validator for LLM-produced multiple-choice questions.

Why this exists
---------------
Even with carefully tuned prompts, LLMs occasionally emit MCQs that are
trivially broken: duplicate distractors, "all of the above" / "none of the
above" cop-outs, options that are substrings of the correct answer (so the
right one is obvious by length or by reading the others), or a missing
answer index. We catch those before they get cached or shown to a student.

We deliberately keep this *cheap* and *deterministic* — no LLM call needed
to decide whether the question is well-formed. ``validate_and_regenerate``
does the one extra LLM round-trip when needed, but bails after a single
retry: an LLM that produces a degenerate MCQ twice in a row is unlikely
to do better on attempt three, and looping would burn rate-limit budget
that should be spent on the rest of the deck.
"""
from __future__ import annotations

import logging
from typing import Any, Awaitable, Callable, Dict, Optional, Tuple

logger = logging.getLogger(__name__)

# Phrases we never want to see — they indicate the model gave up.
_BAD_PHRASES = ("all of the above", "none of the above", "both a and b",
                "both b and c", "both c and d", "all of these", "none of these")


def _normalize_answer_index(q: Dict[str, Any]) -> Optional[int]:
    """Return the 0-based correct index.

    Accepts the answer in any of the formats LLMs commonly produce:
      - integer index (0-based or 1-based; 1-based is folded down)
      - letter "A".."Z"
      - digit string "0", "1", ...
      - the literal option text

    Returns ``None`` when the answer can't be matched to one of the options.
    """
    options = q.get("options")
    if not isinstance(options, list) or not options:
        return None
    n = len(options)

    ans = q.get("correctAnswer")
    if ans is None:
        ans = q.get("answer")
    if ans is None:
        return None

    if isinstance(ans, bool):
        return None

    if isinstance(ans, int):
        if 0 <= ans < n:
            return ans
        return None

    if isinstance(ans, str):
        s = ans.strip()
        if not s:
            return None
        # Letter A/B/C/D
        if len(s) == 1 and s.upper().isalpha():
            idx = ord(s.upper()) - ord("A")
            if 0 <= idx < n:
                return idx
            return None
        # Digit (0- or 1-based)
        try:
            v = int(s)
            if 0 <= v < n:
                return v
            return None
        except ValueError:
            pass
        # Match by literal option text
        sl = s.lower()
        for i, opt in enumerate(options):
            if isinstance(opt, str) and opt.strip().lower() == sl:
                return i

    return None


def validate_mcq(q: Dict[str, Any]) -> Tuple[bool, str]:
    """Return ``(ok, reason)``. When ``ok`` is True, ``reason`` is empty."""
    if not isinstance(q, dict):
        return False, "not a dict"

    question = q.get("question")
    if not isinstance(question, str) or not question.strip():
        return False, "empty question"

    options = q.get("options")
    if not isinstance(options, list) or len(options) != 4:
        return False, "must have exactly 4 options"

    cleaned = []
    for o in options:
        if not isinstance(o, str):
            return False, "non-string option"
        s = o.strip()
        if not s:
            return False, "empty option"
        cleaned.append(s)

    lowered = [o.lower() for o in cleaned]

    if len(set(lowered)) != 4:
        return False, "duplicate options"

    for o in lowered:
        if any(b in o for b in _BAD_PHRASES):
            return False, "degenerate option (all/none of the above)"

    idx = _normalize_answer_index(q)
    if idx is None:
        return False, "missing/invalid answer"

    # No option should be a strict substring of another. This catches the
    # common failure mode where the model pads the correct answer with
    # extra qualifiers, making it the only "complete-looking" choice.
    for i, a in enumerate(lowered):
        for j, b in enumerate(lowered):
            if i != j and a != b and a in b:
                return False, "option is substring of another"

    return True, ""


def coerce_linked_slides(raw: Any) -> list:
    """Coerce a model-supplied ``linked_slides`` field into a sorted unique
    list of non-negative ints. Strings, duplicates and negatives are dropped.

    Returned separately from ``validate_cross_slide_question`` so callers
    that need to *write* the cleaned value (e.g. before persisting) can do
    so without re-validating.
    """
    if not isinstance(raw, list):
        return []
    coerced: list = []
    for v in raw:
        if isinstance(v, bool):
            continue
        if isinstance(v, int):
            coerced.append(v)
        elif isinstance(v, str) and v.lstrip("-").isdigit():
            coerced.append(int(v))
    return sorted({i for i in coerced if i >= 0})


def validate_cross_slide_question(
    q: Dict[str, Any],
    valid_slide_indices: Optional[set] = None,
) -> Tuple[bool, str]:
    """Validate a cross-slide deck question.

    On top of the regular MCQ rules, the cross-slide contract requires:
      * a ``linked_slides`` array,
      * with at least two **distinct** entries,
      * whose values are valid 0-based slide indices (when ``valid_slide_indices``
        is supplied — we don't enforce a range when the caller doesn't know
        the deck size).

    Without this check the LLM occasionally returns a single-slide
    ``linked_slides`` (e.g. ``[2]``), which collapses the cross-slide quiz
    back into a per-slide quiz — exactly the failure mode the cross-slide
    feature exists to prevent.
    """
    ok, reason = validate_mcq(q)
    if not ok:
        return ok, reason

    if not isinstance(q.get("linked_slides"), list):
        return False, "linked_slides missing or not a list"

    distinct = coerce_linked_slides(q.get("linked_slides"))
    if len(distinct) < 2:
        return False, "linked_slides must reference at least 2 distinct slides"

    if valid_slide_indices is not None:
        for i in distinct:
            if i not in valid_slide_indices:
                return False, f"linked_slides index {i} not in slide map"

    return True, ""


async def validate_and_regenerate(
    q: Dict[str, Any],
    regenerate_fn: Callable[[], Awaitable[Dict[str, Any]]],
    validator: Optional[Callable[[Dict[str, Any]], Tuple[bool, str]]] = None,
) -> Dict[str, Any]:
    """Validate ``q`` and, if it fails, run ``regenerate_fn`` exactly once.

    The default validator is :func:`validate_mcq`. Pass a different one (e.g.
    :func:`validate_cross_slide_question` bound to a slide-index set) when
    the caller has additional structural requirements.

    Returns the original question when it's valid, the regenerated one when
    the retry succeeds, and (as a last resort) the original even if invalid
    — callers prefer flagged content over a missing quiz, and downstream
    UI can still render it.
    """
    check = validator or validate_mcq
    ok, reason = check(q)
    if ok:
        return q

    logger.info("MCQ failed validation (%s); attempting one regeneration.", reason)
    try:
        regen = await regenerate_fn()
    except Exception as exc:
        logger.warning("Quiz regeneration raised (%s); keeping original.", exc)
        return q

    if isinstance(regen, dict) and regen:
        # Accept the second attempt as-is — we promised one regeneration,
        # not infinite quality.
        return regen
    return q
