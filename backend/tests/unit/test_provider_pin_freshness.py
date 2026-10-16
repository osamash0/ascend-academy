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
    "EMBEDDING_MODEL": (emb.GEMINI_EMBEDDING_MODEL, emb.EMBEDDING_MODEL_VERIFIED_ON),
    # AI_PROVIDER_MODE=openai_only: the tier and embedding models are called
    # outside the registry's single openai model, so each carries its own pin.
    "OPENAI_BULK_MODEL": (orch.OPENAI_BULK_MODEL, orch.OPENAI_TIER_MODELS_VERIFIED_ON),
    "OPENAI_VISION_MODEL": (orch.OPENAI_VISION_MODEL, orch.OPENAI_TIER_MODELS_VERIFIED_ON),
    "OPENAI_EMBEDDING_MODEL": (emb.OPENAI_EMBEDDING_MODEL, emb.OPENAI_EMBEDDING_MODEL_VERIFIED_ON),
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


def _reachable_provider_ids() -> set[str]:
    # A leg a call can reach: in a failover chain, or promotable to the front
    # by a user's ai_model (_chain_with_preferred inserts mapped providers even
    # when they are not in the chain). Anything else is inert config.
    return (
        set(orch.BULK_CHAIN)
        | set(orch.QUALITY_CHAIN)
        | set(orch._USER_MODEL_TO_PROVIDER.values())
    )


def test_registry_pins_are_fresh():
    reachable = _reachable_provider_ids()
    pins = {
        pid: (cfg.model, cfg.verified_on)
        for pid, cfg in orch.PROVIDER_REGISTRY.items()
        if pid in reachable and cfg.unverifiable_reason is None
    }
    stale = _stale(pins)
    assert not stale, (
        f"{len(stale)} provider pin(s) older than {orch.PIN_MAX_AGE_DAYS} days:\n"
        + "\n".join(stale)
        + "\n"
        + HOW_TO_REVERIFY
    )


def test_unverifiable_exemptions_are_complete_and_current():
    today = _today()
    problems = []
    for pid, cfg in sorted(orch.PROVIDER_REGISTRY.items()):
        reason, noted = cfg.unverifiable_reason, cfg.unverifiable_noted_on
        if (reason is None) != (noted is None):
            problems.append(f"  {pid}: set both unverifiable_reason and unverifiable_noted_on, or neither")
        elif noted is not None:
            if not reason.strip():
                problems.append(f"  {pid}: unverifiable_reason is blank")
            age = (today - noted).days
            if age > orch.PIN_MAX_AGE_DAYS:
                problems.append(
                    f"  {pid}: marked unverifiable on {noted} ({age} days ago): {reason}"
                )
    assert not problems, (
        "Unverifiable-leg exemptions need attention. Re-check whether each leg "
        "can now be verified (key added? account fixed?). If yes, probe it and "
        "clear both fields; if it is still unverifiable, confirm that and bump "
        "unverifiable_noted_on.\n" + "\n".join(problems)
    )


def test_cerebras_stays_out_of_reach():
    # Dropped 2026-10-10 (402 payment_required). "cerebras" is the app-wide
    # default ai_model, so re-adding it to _USER_MODEL_TO_PROVIDER alone would
    # put it back at the head of every call. Re-enable deliberately: probe it,
    # set verified_on, then update this test.
    assert "cerebras" not in _reachable_provider_ids()
    assert orch._resolve_preferred("cerebras") is None


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
    dates += [
        cfg.unverifiable_noted_on
        for cfg in orch.PROVIDER_REGISTRY.values()
        if cfg.unverifiable_noted_on is not None
    ]
    dates += [d for _, d in DIRECT_MODEL_PINS.values()]
    assert all(d <= today for d in dates), "verified_on is in the future — typo?"
