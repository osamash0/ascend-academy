"""Failed AI calls must fail, not masquerade as results (audit Q-B-F7).

Three services answered a provider failure with a canned payload that the
caller then persisted or streamed as if it were generated: the mind map
fallback was upserted as a real map, the analytics "insights" were fixed
sentences, and text-to-speech returned zero bytes with a 200.
"""
from __future__ import annotations

import pytest

from backend.services.ai import analytics as ai_analytics
from backend.services.ai import audio as ai_audio
from backend.services.ai import mind_map as ai_mind_map


async def _boom(*args, **kwargs):
    raise RuntimeError("provider down")


async def test_mind_map_failure_raises_instead_of_returning_a_fallback_tree(monkeypatch):
    monkeypatch.setattr(ai_mind_map, "generate_text", _boom)
    with pytest.raises(RuntimeError):
        await ai_mind_map.generate_mind_map("Lecture", [{"id": "s1", "title": "T", "content_text": "x"}], "auto")


async def test_insights_failure_raises_instead_of_canned_sentences(monkeypatch):
    monkeypatch.setattr(ai_analytics, "generate_text", _boom)
    with pytest.raises(RuntimeError):
        await ai_analytics.generate_analytics_insights({"completion_rate": 0.5}, "auto")


async def test_speech_failure_raises_instead_of_empty_bytes(monkeypatch):
    class _Communicate:
        def __init__(self, text, voice):
            pass

        async def stream(self):
            raise RuntimeError("tts down")
            yield  # pragma: no cover

    monkeypatch.setattr(ai_audio.edge_tts, "Communicate", _Communicate)
    with pytest.raises(RuntimeError):
        await ai_audio.generate_speech("hello", "en-US-AriaNeural")


async def test_speech_rejects_empty_text():
    with pytest.raises(ValueError):
        await ai_audio.generate_speech("   ", "en-US-AriaNeural")
