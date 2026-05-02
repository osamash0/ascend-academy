"""Unit tests for the LLM provider factory."""
import pytest

from backend.domain import llm


def test_unknown_key_raises():
    with pytest.raises(ValueError):
        llm._ProviderFactory().get("does-not-exist")


def test_caches_instances(monkeypatch):
    factory = llm._ProviderFactory()

    class Stub:
        pass

    factory._cache["groq"] = Stub()
    out1 = factory.get("groq")
    out2 = factory.get("groq")
    assert out1 is out2
