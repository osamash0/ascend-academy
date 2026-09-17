"""
Every pinned model slug must have been confirmed live within PIN_MAX_AGE_DAYS.

Providers retire slugs without notice (Groq's llama-3.3-70b-versatile, Gemini
2.0 Flash, OpenRouter `:free` variants...). The rotator treats the resulting
404 as "fail over to the next leg", so a dead pin costs nothing visible — the
2026-09-18 probe found 8 of 9 legs dead and prod quietly running on the last
one. This test makes the staleness visible on a calendar instead.

It does NOT call any provider. It only checks the date a human last did.
"""
from __future__ import annotations

import datetime

from backend.services.ai import embeddings as emb
from backend.services.ai import orchestrator as orch

# Model ids called outside PROVIDER_REGISTRY. GEMINI_MODEL / GROQ_MODEL / ...
# are derived from the registry, and GROQ_VISION_MODEL is env-only (None by
# default), so the embedding model is the one hard-coded pin left.
DIRECT_MODEL_PINS = {
    "EMBEDDING_MODEL": (emb.EMBEDDING_MODEL, emb.EMBEDDING_MODEL_VERIFIED_ON),
}

HOW_TO_REVERIFY = """
How to re-verify a pin (backend/services/ai/orchestrator.py):
  1. Make one real call to the pinned slug with that provider's API key, e.g.
       curl -s <base_url>/chat/completions -H "Authorization: Bearer $KEY" \\
         -H 'Content-Type: application/json' \\
         -d '{"model":"<slug>","messages":[{"role":"user","content":"ping"}],"max_tokens":1}'
     (Gemini legs: client.models.generate_content(model="<slug>", contents="ping")
      via google-genai; Cloudflare: base_url + /<account_id>/ai/v1).
  2. 200 -> set verified_on to today's date.
     404 / "decommissioned" / "unavailable for free" -> pick the provider's
     current slug, re-run the call, then update model= AND verified_on.
     402 / no API key -> the slug is NOT verified; leave the date alone.
  3. Do not bump a date without making the call — the date is the only thing
     this test can see, so a guessed date turns it back into a silent failure.
"""


def _today() -> datetime.date:
    return datetime.date.today()


def _stale(pins: dict[str, tuple[str, datetime.date]]) -> list[str]:
    today = _today()
    out = []
    for name, (model, verified_on) in sorted(pins.items()):
        age = (today - verified_on).days
        if age > orch.PIN_MAX_AGE_DAYS:
            out.append(f"  {name:<18} {model:<45} verified {verified_on} ({age} days ago)")
    return out


def test_registry_pins_are_fresh():
    pins = {pid: (cfg.model, cfg.verified_on) for pid, cfg in orch.PROVIDER_REGISTRY.items()}
    stale = _stale(pins)
    assert not stale, (
        f"{len(stale)} provider pin(s) older than {orch.PIN_MAX_AGE_DAYS} days:\n"
        + "\n".join(stale)
        + "\n"
        + HOW_TO_REVERIFY
    )


def test_direct_model_pins_are_fresh():
    stale = _stale(DIRECT_MODEL_PINS)
    assert not stale, (
        f"{len(stale)} direct model pin(s) older than {orch.PIN_MAX_AGE_DAYS} days:\n"
        + "\n".join(stale)
        + "\n"
        + HOW_TO_REVERIFY
    )


def test_chain_aliases_come_from_the_registry():
    # The aliases must not drift into separate, undated pins again.
    assert orch.GEMINI_MODEL == orch.PROVIDER_REGISTRY["gemini"].model
    assert orch.GROQ_MODEL == orch.PROVIDER_REGISTRY["groq"].model
    assert orch.GROQ_FAST_MODEL == orch.PROVIDER_REGISTRY["groq_fast"].model
    assert orch.CEREBRAS_MODEL == orch.PROVIDER_REGISTRY["cerebras"].model


def test_no_pin_is_dated_in_the_future():
    today = _today()
    dates = [cfg.verified_on for cfg in orch.PROVIDER_REGISTRY.values()]
    dates += [d for _, d in DIRECT_MODEL_PINS.values()]
    assert all(d <= today for d in dates), "verified_on is in the future — typo?"
