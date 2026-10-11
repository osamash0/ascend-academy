"""
Ask Luna — a hint-first tutor that answers with curated widgets.

The model returns ``{"parts": [...]}``: short text, plus at most one widget
picked by name from a fixed registry (JoinPlayground, ConceptCheck). It never
returns code or HTML, and it never grades — the frontend widget computes the
correct answer from the scenario itself.

Every turn is validated here *and* again in the browser
(src/features/askLuna/protocol.ts). The Pydantic models below mirror that zod
schema; anything that fails is dropped and replaced by a gentle fallback, so a
malformed model reply degrades to text instead of a broken widget.

Learner context is a short plain-text summary, not raw rows: Khan Academy's
Khanmigo A/B tests found a compact summary of recent attempts improved the
next answer, while raw JSON logs did not.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field, ValidationError, model_validator

from .orchestrator import generate_text, parse_json_response
from .prompts import ASK_LUNA_PROMPT
from .tutor import _sanitize_user_input
from .voice import VOICE_STRUCTURED

logger = logging.getLogger(__name__)

PROMPT_NAME = "ASK_LUNA_PROMPT"
FEATURE = "ask_luna"

_MAX_QUESTION_CHARS = 2_000
_MAX_HISTORY_MESSAGES = 6
_MAX_HISTORY_CHARS_PER_MSG = 600
_MAX_TEXT_PART_CHARS = 1_200

_LANGUAGE_NAMES = {"en": "English", "de": "German"}

FALLBACK = {
    "en": "I got a bit tangled there. Could you ask that another way?",
    "de": "Da hab ich mich kurz verheddert. Kannst du es anders formulieren?",
}


# ── Widget schemas (mirror src/features/askLuna/protocol.ts) ───────────────

Cell = Union[str, int, float, None]


class _Table(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    columns: List[str] = Field(min_length=1, max_length=5)
    rows: List[List[Cell]] = Field(min_length=1, max_length=6)

    @model_validator(mode="after")
    def _rectangular(self) -> "_Table":
        if any(not c or len(c) > 30 for c in self.columns):
            raise ValueError("bad column name")
        if any(len(r) != len(self.columns) for r in self.rows):
            raise ValueError("ragged rows")
        return self


class _JoinOn(BaseModel):
    left: str
    right: str


class JoinPlaygroundProps(BaseModel):
    joinType: Literal["INNER", "LEFT", "RIGHT", "FULL"]
    left: _Table
    right: _Table
    on: _JoinOn
    prompt: Optional[str] = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def _columns_exist(self) -> "JoinPlaygroundProps":
        if self.on.left not in self.left.columns or self.on.right not in self.right.columns:
            raise ValueError("join columns must exist")
        return self


class _Option(BaseModel):
    text: str = Field(min_length=1, max_length=160)
    correct: bool
    why: str = Field(max_length=240)


class ConceptCheckProps(BaseModel):
    question: str = Field(min_length=5, max_length=240)
    options: List[_Option] = Field(min_length=2, max_length=5)
    hint: str = Field(max_length=240)

    @model_validator(mode="after")
    def _one_correct(self) -> "ConceptCheckProps":
        if sum(o.correct for o in self.options) != 1:
            raise ValueError("exactly one correct option")
        return self


WIDGETS = {"JoinPlayground": JoinPlaygroundProps, "ConceptCheck": ConceptCheckProps}


def validate_turn(raw: Any, language: str = "en") -> List[Dict[str, Any]]:
    """Keep valid text parts and at most one valid widget; never return empty."""
    fallback = [{"type": "text", "text": FALLBACK.get(language, FALLBACK["en"])}]
    parts = raw.get("parts") if isinstance(raw, dict) else None
    if not isinstance(parts, list):
        return fallback

    out: List[Dict[str, Any]] = []
    widget_seen = False
    for p in parts:
        if not isinstance(p, dict):
            continue
        if p.get("type") == "text" and isinstance(p.get("text"), str) and p["text"].strip():
            out.append({"type": "text", "text": p["text"].strip()[:_MAX_TEXT_PART_CHARS]})
        elif p.get("type") == "widget" and not widget_seen:
            model = WIDGETS.get(p.get("component"))
            if model is None:
                logger.info("ask_luna: dropped unknown widget %r", p.get("component"))
                continue
            try:
                props = model.model_validate(p.get("props"))
            except ValidationError as e:
                logger.info("ask_luna: dropped invalid %s: %s", p.get("component"), e.errors()[:2])
                continue
            out.append({"type": "widget", "component": p["component"], "props": props.model_dump(exclude_none=True)})
            widget_seen = True
    return out or fallback


# ── Learner context ─────────────────────────────────────────────────────────

def build_learner_context(profile: Optional[Dict[str, Any]], progress: List[Dict[str, Any]]) -> str:
    """A few plain sentences about where the student is. No raw rows."""
    lines: List[str] = []
    if profile:
        lvl = profile.get("current_level") or 1
        streak = profile.get("current_streak") or 0
        lines.append(f"Level {lvl}; current study streak {streak} day(s).")

    scored = []
    for row in progress or []:
        answered = row.get("total_questions_answered") or 0
        if answered < 3:
            continue
        title = ((row.get("lectures") or {}) or {}).get("title") or "a lecture"
        scored.append((row.get("correct_answers", 0) / answered, title[:80]))
    if scored:
        scored.sort()
        weakest = [t for pct, t in scored if pct < 0.7][:2]
        strongest = [t for pct, t in reversed(scored) if pct >= 0.85][:2]
        if weakest:
            lines.append("Finding these harder (quiz accuracy under 70%): " + "; ".join(weakest) + ".")
        if strongest:
            lines.append("Doing well in: " + "; ".join(strongest) + ".")
    if not lines:
        lines.append("New student; no quiz history yet.")
    return "\n".join(lines)


def _history_str(history: Optional[List[Dict[str, str]]]) -> str:
    if not history:
        return "(none)\n"
    out = []
    for m in history[-_MAX_HISTORY_MESSAGES:]:
        role = "Student" if m.get("role") == "user" else "Luna"
        out.append(f"{role}: {_sanitize_user_input(m.get('content', ''), _MAX_HISTORY_CHARS_PER_MSG)}")
    return "\n".join(out) + "\n"


def build_prompt(question: str, history: Optional[List[Dict[str, str]]], language: str, learner_context: str) -> str:
    return ASK_LUNA_PROMPT.format(
        language_name=_LANGUAGE_NAMES.get(language, "English"),
        voice_structured=VOICE_STRUCTURED,
        learner_context=learner_context,
        history_str=_history_str(history),
        safe_message=_sanitize_user_input(question, _MAX_QUESTION_CHARS),
    )


async def ask_luna(
    *,
    user_id: str,
    question: str,
    history: Optional[List[Dict[str, str]]],
    language: str,
    learner_context: str,
    ai_model: str = "cerebras",
) -> List[Dict[str, Any]]:
    """One tutor turn. Raises LLMBudgetExceededError if the user is over cap."""
    prompt = build_prompt(question, history, language, learner_context)
    raw = await generate_text(
        prompt,
        ai_model,
        json_mode=True,
        prompt_name=PROMPT_NAME,
        user_id=user_id,
        feature=FEATURE,
    )
    try:
        parsed = parse_json_response(raw)
    except Exception:  # parse_json_response is lenient, but never let it 500 the chat
        logger.warning("ask_luna: unparseable model reply")
        parsed = None
    return validate_turn(parsed, language)
