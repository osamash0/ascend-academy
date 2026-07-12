"""Shared brand-voice fragment for LLM prompts ("Calm Competence" — see
docs/BRAND_VOICE.md). Composed into a fully-rendered prompt string at each
call site via ``with_voice`` — there is no system-role message in this
codebase's LLM abstraction (see orchestrator.generate_text/generate_text_bulk,
both single user-role calls), so a fragment can't be injected centrally
without leaking style text into JSON classifiers and pure extractors.

Per-site policy (see backend/services/ai/prompts.py and the call sites
below for the actual prompts):

- VOICE_PROSE + LANG_MATCH: tutor.py chat_with_lecture/chat_with_course,
  ask_professor.py professor chat — free text the user reads directly.
- VOICE_PROSE: analytics.py slide recommendation/metric feedback,
  tutor_service.py tagline/lecture description/course description.
- VOICE_STRUCTURED: analytics.py insights, study_guide_service.py concept
  definitions, synthesis.py slide analysis/quiz prompts, orchestrator.py
  enhance/deck-quiz/batch-slide/quiz-regen/single-slide-quiz prompts — all
  JSON envelopes whose string fields are user-visible.
- NONE (do not wire voice into these): classifiers and pure extractors —
  ask_professor.py intent classifier, ask_data.py intent classifier,
  content_filter.py LLM judge, vision.py slide extraction,
  planner_service.py blueprint, mind_map.py node labels, synthesis.py
  lecture-meta (byte-identical prompt is a documented regression guard) and
  syllabus-fact extraction, orchestrator.py legacy process_slide_batch and
  generate_deck_summary (its output feeds quiz-gen as input — don't
  contaminate it with style text).

Both fragments are brace-free by construction (enforced by test_voice.py)
so composing them into a ``.format()``-templated prompt after ``.format()``
has already run is always safe.
"""

VOICE_PROSE = (
    "Write in a calm, plain-spoken, encouraging voice — like a prepared "
    "student a semester ahead sharing their notes, not a hype machine. Be "
    "concise and concrete. Skip corporate buzzwords and sci-fi flourish "
    "(no \"neural\", \"protocol\", \"telemetry\", \"orbital\", \"mission\" as "
    "a metaphor for a task). When you praise progress, name the specific "
    "fact behind it rather than inflating it. Voice never overrides "
    "grounding: if the material doesn't cover something, say so plainly — "
    "a refusal stays a refusal, just delivered kindly."
)

VOICE_STRUCTURED = (
    "Any user-facing text you write inside the JSON (titles, explanations, "
    "questions, feedback) should read plain-spoken and student-friendly — "
    "no sci-fi jargon, no corporate buzzwords, no inflated hype."
)

LANG_MATCH = (
    "Answer in the same language the student's message is written in. Keep "
    "any citation markers such as [Slide N] or [Source N] in English "
    "exactly as given — never translate or reformat them."
)


def with_voice(prompt: str, *, structured: bool = False, lang_match: bool = False) -> str:
    """Prepend the applicable voice fragment(s) to a fully-rendered prompt.

    Call this on the final prompt string immediately before the
    ``generate_text``/``generate_text_bulk`` call — never on a raw
    ``.format()`` template, since a fragment inserted mid-template would be
    re-scanned by a second ``.format()`` call downstream.
    """
    fragment = VOICE_STRUCTURED if structured else VOICE_PROSE
    parts = [fragment]
    if lang_match:
        parts.append(LANG_MATCH)
    parts.append(prompt)
    return "\n\n".join(parts)
