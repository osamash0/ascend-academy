"""Unit tests for the shared brand-voice fragment (backend/services/ai/voice.py).

These guard the two invariants the composition mechanics rely on: the
fragments must never contain a curly brace (so composing them into a
``.format()``-templated prompt after formatting is always safe), and the
grounding-supremacy line must always be present so no future edit to
VOICE_PROSE can accidentally soften the tutor's refusal behavior.
"""
from backend.services.ai import voice


def test_fragments_contain_no_braces():
    for fragment in (voice.VOICE_PROSE, voice.VOICE_STRUCTURED, voice.LANG_MATCH):
        assert "{" not in fragment
        assert "}" not in fragment


def test_voice_prose_asserts_grounding_supremacy():
    assert "refusal stays a refusal" in voice.VOICE_PROSE


def test_lang_match_pins_citation_tokens():
    assert "Slide N" in voice.LANG_MATCH
    assert "Source N" in voice.LANG_MATCH


def test_with_voice_prepends_prose_by_default():
    out = voice.with_voice("BASE PROMPT")
    assert out.startswith(voice.VOICE_PROSE)
    assert out.endswith("BASE PROMPT")
    assert voice.VOICE_STRUCTURED not in out


def test_with_voice_structured_uses_structured_fragment():
    out = voice.with_voice("BASE PROMPT", structured=True)
    assert out.startswith(voice.VOICE_STRUCTURED)
    assert voice.VOICE_PROSE not in out


def test_with_voice_lang_match_appends_after_prose():
    out = voice.with_voice("BASE PROMPT", lang_match=True)
    assert voice.VOICE_PROSE in out
    assert voice.LANG_MATCH in out
    assert out.index(voice.VOICE_PROSE) < out.index(voice.LANG_MATCH) < out.index("BASE PROMPT")


def test_with_voice_composes_safely_after_format():
    template = "Title: {title}\n\n{{escaped_literal}}"
    rendered = template.format(title="Photosynthesis")
    composed = voice.with_voice(rendered, structured=True)
    assert "Photosynthesis" in composed
    assert "{escaped_literal}" in composed
