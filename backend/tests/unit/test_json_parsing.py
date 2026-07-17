"""Unit tests for backend.services.ai.orchestrator.parse_json_response
and _sanitize_json_string.

This is the single choke-point every LLM JSON response flows through before it
reaches quiz mapping, slide synthesis, or classification. The goal's mandate is
to pin down how the code HANDLES model output — well-formed, fenced, embedded in
prose, truncated mid-array, riddled with control chars / lone backslashes, or
total garbage — never the model's content.
"""
from __future__ import annotations

import json

from backend.services.ai.orchestrator import (
    parse_json_response,
    _sanitize_json_string,
)


# ── passthrough / type coercion ──────────────────────────────────────────────

def test_dict_passthrough_returns_same_object():
    d = {"a": 1}
    assert parse_json_response(d) is d


def test_list_passthrough_returns_same_object():
    lst = [{"a": 1}]
    assert parse_json_response(lst) is lst


def test_non_string_scalar_is_stringified_then_parsed():
    # int 5 → str "5" → json.loads → 5
    assert parse_json_response(5) == 5


# ── well-formed variants ─────────────────────────────────────────────────────

def test_plain_object():
    assert parse_json_response('{"title": "Graphs", "n": 3}') == {"title": "Graphs", "n": 3}


def test_plain_array():
    assert parse_json_response('[{"q": 1}, {"q": 2}]') == [{"q": 1}, {"q": 2}]


def test_fenced_json_block():
    raw = '```json\n{"answer": "A"}\n```'
    assert parse_json_response(raw) == {"answer": "A"}


def test_fenced_block_without_language_tag():
    raw = '```\n{"answer": "B"}\n```'
    assert parse_json_response(raw) == {"answer": "B"}


def test_json_embedded_in_prose():
    raw = 'Sure! Here is your result: {"title": "X", "ok": true} — hope that helps.'
    assert parse_json_response(raw) == {"title": "X", "ok": True}


def test_array_embedded_in_prose():
    raw = 'Here you go:\n[{"id": 1}, {"id": 2}]\nLet me know if you need more.'
    assert parse_json_response(raw) == [{"id": 1}, {"id": 2}]


# ── truncation recovery ──────────────────────────────────────────────────────

def test_malformed_array_with_closing_bracket_salvages_complete_objects():
    # When a closing ']' IS present, the array branch matches and the salvage
    # path recovers every complete {...} object, skipping the malformed one.
    raw = '[{"q": "one"}, {"q": "two"}, {bad}]'
    out = parse_json_response(raw)
    assert out == [{"q": "one"}, {"q": "two"}]


def test_truncated_array_without_closing_bracket_salvages_complete_objects():
    # Regression guard for BUG B1 (fixed): a genuinely token-limit-truncated
    # array has no closing ']', so the extraction regex falls back to the inner
    # '{...}' span. Salvage now runs off the original array text, recovering
    # every complete object before the truncation point.
    raw = '[{"q": "one"}, {"q": "two"}, {"q": "thr'
    assert parse_json_response(raw) == [{"q": "one"}, {"q": "two"}]


def test_truncated_array_salvage_ignores_incomplete_trailing_object():
    # Only complete {...} blocks are recovered; the partial trailing object is
    # dropped rather than corrupting the result.
    raw = '[{"id": 1, "ok": true}, {"id": 2, "ok": false}, {"id": 3, "ok'
    assert parse_json_response(raw) == [
        {"id": 1, "ok": True},
        {"id": 2, "ok": False},
    ]


def test_truncated_array_with_no_complete_object_returns_empty_dict():
    raw = '[{"q": "incompl'
    assert parse_json_response(raw) == {}


def test_truncated_object_is_not_salvaged_returns_empty_dict():
    # Salvage only applies to arrays; a truncated object yields {}.
    raw = '{"title": "Graphs", "summary": "this got cut o'
    assert parse_json_response(raw) == {}


def test_total_garbage_returns_empty_dict():
    assert parse_json_response("the model refused and wrote a paragraph") == {}


def test_empty_string_returns_empty_dict():
    assert parse_json_response("") == {}


# ── LLM JSON defects (via _sanitize_json_string) ─────────────────────────────

def test_literal_newline_inside_string_is_escaped_and_parses():
    # Raw control newline inside a JSON string value — invalid JSON until sanitized.
    raw = '{"explanation": "line one\nline two"}'
    out = parse_json_response(raw)
    assert out["explanation"] == "line one\nline two"


def test_lone_backslash_is_doubled_and_preserved():
    # LaTeX-style "\gamma" — \g is not a valid JSON escape; sanitizer doubles it.
    raw = '{"formula": "\\gamma + 1"}'
    out = parse_json_response(raw)
    assert out["formula"] == "\\gamma + 1"


def test_valid_backslash_escape_preserved():
    raw = '{"path": "a\\\\b", "quote": "he said \\"hi\\""}'
    out = parse_json_response(raw)
    assert out["path"] == "a\\b"
    assert out["quote"] == 'he said "hi"'


def test_control_char_outside_string_is_stripped():
    # Bell (0x07) between the brace and key is stripped by the sanitizer.
    raw = '{\x07"a": 1}'
    assert parse_json_response(raw) == {"a": 1}


def test_nul_byte_outside_string_is_not_stripped():
    # Quirk: the outside-string strip guard is `0x00 < ord(ch)` (strict), so a
    # NUL byte is NOT removed and breaks the parse → {}. Bell/other C0 controls
    # (0x01–0x1F) are stripped. Pins current behavior.
    raw = '{\x00"a": 1}'
    assert parse_json_response(raw) == {}


# ── Unicode / encoding normalization ─────────────────────────────────────────

def test_unicode_content_is_preserved():
    raw = json.dumps({"title": "Über Fräulein π ∑ 数学"}, ensure_ascii=False)
    out = parse_json_response(raw)
    assert out["title"] == "Über Fräulein π ∑ 数学"


def test_unicode_escaped_sequences_decode():
    raw = '{"greek": "\\u03b1\\u03b2"}'  # αβ
    out = parse_json_response(raw)
    assert out["greek"] == "αβ"


def test_sanitize_preserves_plain_text():
    s = '{"clean": "no defects here"}'
    assert _sanitize_json_string(s) == s
