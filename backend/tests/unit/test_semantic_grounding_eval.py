
"""Arc 8 measurement mechanics on the synthetic LONG_DECK. Exact cosines via
ScriptedEmbedder; offline (no network, no API)."""
from __future__ import annotations

import json

import pytest

from backend.eval import semantic_grounding_eval as sge
from backend.eval.data.grounding_probe import EN_OFF_TOPIC, ProbePair
from backend.eval.deck_lab import HALLUCINATED, PARAPHRASED, run_grounding_probe
from backend.eval.embedding_cache import EmbeddingCache, EmbeddingCacheMiss, text_key
from backend.services.parser.semantic_grounding import EmbeddingShapeError
from backend.services.parser.deck_plan import build_deck_skeleton
from backend.services.parser.semantic_grounding import claim_text, slide_text
from backend.tests.support.deck_lab_decks import LONG_DECK, write_pdf
from backend.tests.support.fake_embedder import HashingEmbedder, ScriptedEmbedder

SK = build_deck_skeleton(LONG_DECK)
SKELETONS = {"cal.pdf": SK, "probe.pdf": SK}
CAL_SETS = (("cal.pdf", [
    (3, "What does the alpha slide explain?", "The alpha concept", "The bravo concept"),
    (4, "What does the bravo slide explain?", "The bravo concept", "The charlie concept"),
    (5, "What does the charlie slide explain?", "The charlie concept", "Exactly 7 charlie concepts"),
], EN_OFF_TOPIC),)
PROBE = [
    ProbePair("probe.pdf", 6, "What does the delta slide explain?", "Fourth letter idea", "Quantum tunnelling", "en"),
    ProbePair("probe.pdf", 7, "What does the echo slide explain?", "Reverberation notion", "Sound bouncing idea", "en"),
]
COSINES = {
    claim_text("What does the alpha slide explain?", "The alpha concept"): 0.9,
    claim_text("What does the alpha slide explain?", "The bravo concept"): 0.3,
    claim_text("What does the bravo slide explain?", "The bravo concept"): 0.8,
    claim_text("What does the bravo slide explain?", "The charlie concept"): 0.2,
    claim_text("What does the charlie slide explain?", "The charlie concept"): 0.85,
    claim_text("What does the delta slide explain?", "Fourth letter idea"): 0.7,
    claim_text("What does the delta slide explain?", "Quantum tunnelling"): 0.2,
    claim_text("What does the echo slide explain?", "Reverberation notion"): 0.4,
    claim_text("What does the echo slide explain?", "Sound bouncing idea"): 0.6,
}


def _embedder():
    return ScriptedEmbedder([slide_text(SK, n) for n in range(1, len(SK.slides) + 1)], COSINES)


async def test_calibration_scores_calibration_answers_and_skips_gated_ones():
    cal = await sge.calibrate(sge.calibration_items(SKELETONS, CAL_SETS), _embedder())
    assert cal.grounded == pytest.approx((0.9, 0.8, 0.85))
    assert cal.ungrounded == pytest.approx((0.3, 0.2))
    assert cal.gated == 1  # "Exactly 7 charlie concepts": number_not_on_slide
    assert cal.threshold == pytest.approx(0.55) and cal.errors == 0


async def test_probe_reports_lexical_semantic_and_combined_columns():
    probe = await sge.run_semantic_probe(sge.probe_items(PROBE, SKELETONS), _embedder(), threshold=0.55)
    assert [(o.answer, o.lexical_ok, o.semantic_ok, o.combined_ok) for o in probe.outcomes] == [
        ("Fourth letter idea", False, True, True),
        ("Quantum tunnelling", False, False, False),
        ("Reverberation notion", False, False, False),
        ("Sound bouncing idea", False, True, True),
    ]
    assert probe.rates("lexical") == sge.ColumnRates(2, 2, 0, 2)
    assert probe.rates("semantic") == sge.ColumnRates(1, 2, 1, 2)
    assert probe.rates("combined") == sge.ColumnRates(1, 2, 1, 2)


async def test_lexical_column_reproduces_the_arc6_lexical_probe():
    probe = await sge.run_semantic_probe(sge.probe_items(PROBE, SKELETONS), _embedder(), threshold=0.55)
    arc6 = run_grounding_probe(PROBE, SKELETONS)
    assert [o.lexical_ok for o in probe.outcomes] == [o.accepted for o in arc6.outcomes]


async def test_combined_keeps_a_lexically_supported_answer_the_cosine_misses():
    pair = ProbePair("probe.pdf", 8, "What does the foxtrot slide explain?", "The foxtrot concept",
                     "Quantum tunnelling", "en")
    probe = await sge.run_semantic_probe(sge.probe_items([pair], SKELETONS), _embedder(), threshold=0.55)
    para = probe.outcomes[0]
    assert para.lexical_ok and not para.semantic_ok and para.combined_ok


def _probe_with(fd, fk, n=16):
    outcomes = []
    for i in range(n):
        pair = ProbePair("p.pdf", i + 1, "s", "p", "h", "en")
        outcomes.append(sge.SemanticOutcome(pair, PARAPHRASED, "p", 0.0, 0.0, "x", False, i >= fd, i >= fd))
        outcomes.append(sge.SemanticOutcome(pair, HALLUCINATED, "h", 0.0, 0.0, "x", False, i < fk, i < fk))
    return sge.SemanticProbeResult(0.5, tuple(outcomes), ())


@pytest.mark.parametrize("fd, fk, eligible", [(2, 1, True), (3, 0, False), (0, 2, False)])
def test_pre_registered_gate(fd, fk, eligible):
    assert sge.decide(sge.calibrate_threshold([0.8, 0.9], [0.2, 0.3]), _probe_with(fd, fk)).eligible is eligible


def test_gate_names_every_failure():
    bad_cal = sge.Calibration(threshold=0.5, grounded=(0.1, 0.2, 0.3, 0.9), ungrounded=(0.1,))
    d = sge.decide(bad_cal, _probe_with(3, 2, n=10))
    assert not d.eligible
    assert d.failures == (
        "probe incomplete: 20/32 answers scored",
        "calibration errors 3/5 > 2",
        "combined false drop 3/10 > 2",
        "combined false keep 2/10 > 1",
    )


def test_decision_constants_are_the_pre_registered_ones():
    assert (sge.DECISION_COLUMN, sge.MAX_FALSE_DROPS, sge.MAX_FALSE_KEEPS,
            sge.MAX_CALIBRATION_ERRORS, sge.EXPECTED_PROBE_ANSWERS) == ("combined", 2, 1, 2, 32)


async def test_cache_fetches_misses_once_then_serves_offline(tmp_path):
    path = tmp_path / "emb.json"
    fetched = []

    async def fetch(texts):
        fetched.append(list(texts))
        return [[float(len(t)), 1.0] for t in texts]

    cache = EmbeddingCache.load(path, "m", 2)
    out = await cache.embedder(fetch)(["zz one", "zz three", "zz one"])
    assert fetched == [["zz one", "zz three"]] and out == [[6.0, 1.0], [8.0, 1.0], [6.0, 1.0]]
    assert cache.fetched == 2
    cache.save()
    raw = path.read_text(encoding="utf-8")
    data = json.loads(raw)
    assert (data["model"], data["dims"]) == ("m", 2) and set(data["vectors"]) == {text_key("zz one", "m"), text_key("zz three", "m")}
    assert "zz" not in raw  # keys are hashes: no slide text in the file
    offline = EmbeddingCache.load(path, "m", 2)
    assert await offline.embedder()(["zz three"]) == [[8.0, 1.0]]
    with pytest.raises(EmbeddingCacheMiss, match="DECK_LAB_ALLOW_EMBEDDING_API"):
        await offline.embedder()(["never seen"])


def test_cache_refuses_vectors_from_another_model(tmp_path):
    path = tmp_path / "emb.json"
    EmbeddingCache(path, "m", 2, {text_key("x", "m"): [1.0, 0.0]}).save()
    with pytest.raises(ValueError, match="m/2"):
        EmbeddingCache.load(path, "other", 2)


@pytest.fixture
def lab(tmp_path, monkeypatch):
    deck_dir = tmp_path / "decks"
    deck_dir.mkdir()
    write_pdf(deck_dir / "cal.pdf", LONG_DECK)
    write_pdf(deck_dir / "probe.pdf", LONG_DECK)
    monkeypatch.setattr(sge, "CALIBRATION_SETS", CAL_SETS)
    monkeypatch.setattr(sge, "PROBE_PAIRS", PROBE)
    live = HashingEmbedder()
    monkeypatch.setattr(sge, "_live_fetch", live)
    monkeypatch.setattr(sge, "EMBEDDING_MODEL_ID", "fake@2")
    return deck_dir, tmp_path / "emb.json", live


async def test_run_fetches_once_then_reruns_offline_identically(lab):
    deck_dir, cache, live = lab
    first = await sge.run_semantic_grounding(deck_dir, cache, allow_api=True)
    assert len(live.calls) == 1 and first.fetched > 0 and cache.exists()
    second = await sge.run_semantic_grounding(deck_dir, cache, allow_api=False)
    assert len(live.calls) == 1 and second.fetched == 0 and second.cached == first.fetched
    assert second.calibration == first.calibration and second.probe == first.probe
    assert first.decision.failures[0] == "probe incomplete: 4/32 answers scored"


async def test_offline_run_without_a_cache_raises_before_any_fetch(lab):
    deck_dir, cache, live = lab
    with pytest.raises(EmbeddingCacheMiss):
        await sge.run_semantic_grounding(deck_dir, cache, allow_api=False)
    assert live.calls == [] and not cache.exists()


async def test_missing_calibration_decks_score_nothing(tmp_path, monkeypatch):
    monkeypatch.setattr(sge, "CALIBRATION_SETS", CAL_SETS)
    monkeypatch.setattr(sge, "PROBE_PAIRS", PROBE)
    run = await sge.run_semantic_grounding(tmp_path, tmp_path / "emb.json", allow_api=False)
    assert run.missing_calibration_decks == ("cal.pdf",) and run.calibration is None and run.probe is None


async def test_calibration_and_probe_decks_must_be_disjoint(tmp_path, monkeypatch):
    monkeypatch.setattr(sge, "CALIBRATION_SETS", CAL_SETS)
    monkeypatch.setattr(sge, "PROBE_PAIRS", [ProbePair("cal.pdf", 6, "s", "p", "h", "en")])
    with pytest.raises(ValueError, match="overlap"):
        await sge.run_semantic_grounding(tmp_path, tmp_path / "emb.json", allow_api=False)


def test_cache_key_includes_the_model_id():
    assert text_key("x", "a@1") != text_key("x", "b@1") and text_key("x", "a@1") == text_key("x", "a@1")


def test_cache_never_serves_vectors_stored_under_another_model_id(tmp_path):
    path = tmp_path / "emb.json"
    EmbeddingCache(path, "a@2", 2, {text_key("x", "a@2"): [1.0, 0.0]}).save()
    data = json.loads(path.read_text(encoding="utf-8"))
    data["model"] = "b@2"  # same file relabelled: the keys still belong to a@2
    path.write_text(json.dumps(data), encoding="utf-8")
    other = EmbeddingCache.load(path, "b@2", 2)
    assert other.missing(["x"]) == ["x"]


async def test_run_records_the_model_id_next_to_the_threshold(lab):
    deck_dir, cache, _ = lab
    run = await sge.run_semantic_grounding(deck_dir, cache, allow_api=True)
    assert run.model == run.calibration.model == run.decision.model == "fake@2"
    assert json.loads(cache.read_text(encoding="utf-8"))["model"] == "fake@2"


async def test_run_refuses_a_cache_fitted_for_another_model(lab):
    deck_dir, cache, live = lab
    await sge.run_semantic_grounding(deck_dir, cache, allow_api=True)
    sge.EMBEDDING_MODEL_ID = "other@2"
    try:
        with pytest.raises(ValueError, match="fake@2"):
            await sge.run_semantic_grounding(deck_dir, cache, allow_api=False)
    finally:
        sge.EMBEDDING_MODEL_ID = "fake@2"


def _probe_with_lexical(drops, keeps, n=16):
    para = [sge.SemanticOutcome(PROBE[0], PARAPHRASED, "p", 0.0, 0.5, "ok", i >= drops, True, True) for i in range(n)]
    hall = [sge.SemanticOutcome(PROBE[0], HALLUCINATED, "h", 0.0, 0.1, "ok", i < keeps, False, False) for i in range(n)]
    return sge.SemanticProbeResult(0.5, tuple(para + hall), ())


def test_lexical_baseline_constants_are_arc6s():
    assert (sge.ARC6_LEXICAL_FALSE_DROPS, sge.ARC6_LEXICAL_FALSE_KEEPS) == (14, 0)


def test_lexical_baseline_passes_when_it_reproduces_arc6():
    sge.check_lexical_baseline(_probe_with_lexical(14, 0))


@pytest.mark.parametrize("drops,keeps", [(13, 0), (15, 0), (14, 1)])
def test_lexical_baseline_mismatch_raises_naming_observed_and_expected(drops, keeps):
    with pytest.raises(sge.LexicalBaselineMismatch, match=rf"false-drop {drops}/16.*false-keep {keeps}/16.*14/16.*0/16"):
        sge.check_lexical_baseline(_probe_with_lexical(drops, keeps))


def test_lexical_baseline_skips_a_partial_probe():
    sge.check_lexical_baseline(_probe_with_lexical(1, 1, n=2))  # decide() already fails it as incomplete


async def test_run_refuses_a_decision_when_the_lexical_column_drifts(lab, monkeypatch):
    deck_dir, cache, _ = lab
    monkeypatch.setattr(sge, "EXPECTED_PROBE_ANSWERS", 4)  # the 2-pair fixture counts as a full probe
    with pytest.raises(sge.LexicalBaselineMismatch):
        await sge.run_semantic_grounding(deck_dir, cache, allow_api=True)
    assert cache.exists()  # paid vectors survive the refusal


async def test_cache_is_saved_before_calibration_so_a_later_failure_loses_nothing(lab, monkeypatch):
    deck_dir, cache, live = lab

    async def boom(*a, **k):
        raise RuntimeError("calibrate failed")

    monkeypatch.setattr(sge, "calibrate", boom)
    with pytest.raises(RuntimeError, match="calibrate failed"):
        await sge.run_semantic_grounding(deck_dir, cache, allow_api=True)
    assert len(live.calls) == 1 and cache.exists()
    assert EmbeddingCache.load(cache, "fake@2", sge.EMBEDDING_DIMS).vectors


async def test_each_completed_batch_is_on_disk_before_the_next_is_requested(tmp_path):
    path = tmp_path / "emb.json"
    cache = EmbeddingCache(path, "m@2", 2)
    calls = []

    async def fetch(texts):
        calls.append(list(texts))
        if len(calls) == 2:
            raise RuntimeError("batch 2 failed")
        return [[1.0, 0.0] for _ in texts]

    with pytest.raises(RuntimeError, match="batch 2"):
        await cache.embedder(fetch, batch_size=2)(["a", "b", "c", "d"])
    assert EmbeddingCache.load(path, "m@2", 2).missing(["a", "b", "c", "d"]) == ["c", "d"]


def test_decide_default_count_resolves_at_call_time(monkeypatch):
    monkeypatch.setattr(sge, "EXPECTED_PROBE_ANSWERS", 4)
    cal = sge.Calibration(0.5, (0.9,), (0.1,))
    probe = sge.SemanticProbeResult(0.5, _probe_with_lexical(0, 0, n=2).outcomes, ())
    assert not any("incomplete" in f for f in sge.decide(cal, probe).failures)


def test_save_is_atomic_a_crash_mid_write_keeps_the_previous_cache(tmp_path, monkeypatch):
    path = tmp_path / "emb.json"
    EmbeddingCache(path, "m@2", 2, {text_key("x", "m@2"): [1.0, 0.0]}).save()
    from pathlib import Path

    real = Path.write_text

    def crash(self, data, *a, **k):
        real(self, data[: len(data) // 2], *a, **k)  # truncated write, then the process dies
        raise OSError("disk died")

    monkeypatch.setattr(Path, "write_text", crash)
    with pytest.raises(OSError):
        EmbeddingCache(path, "m@2", 2, {text_key("y", "m@2"): [0.0, 1.0]}).save()
    monkeypatch.undo()
    assert EmbeddingCache.load(path, "m@2", 2).missing(["x"]) == []
