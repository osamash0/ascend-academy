"""Arc 8 Deck Lab section: rendered only from the run's numbers; the CLI
step is opt-in and never reaches the API without DECK_LAB_ALLOW_EMBEDDING_API=1."""
from __future__ import annotations

from pathlib import Path

import pytest

from backend.eval import semantic_grounding_eval as sge
from backend.eval.data.grounding_probe import EN_OFF_TOPIC, ProbePair
from backend.eval.deck_lab import HALLUCINATED, PARAPHRASED, main, render_semantic_section
from backend.tests.support.deck_lab_decks import LONG_DECK, write_pdf
from backend.tests.support.fake_embedder import HashingEmbedder

PAIR = ProbePair("07 DBS Transactions.pdf", 7, "Q?", "para answer", "hallu answer", "en")
OUTCOMES = (
    sge.SemanticOutcome(PAIR, PARAPHRASED, "para answer", 0.208, 0.71, "ok", False, True, True),
    sge.SemanticOutcome(PAIR, HALLUCINATED, "hallu answer", 0.0, 0.42, "low_support", False, False, False),
)
CAL = sge.Calibration(threshold=0.55, grounded=(0.9, 0.8), ungrounded=(0.3, 0.2), gated=1)


def _md(decision):
    run = sge.SemanticRun(CAL, sge.SemanticProbeResult(0.55, OUTCOMES, ()), decision, (), 5, 3,
                          Path("backend/eval/data/grounding_embeddings.json"), "gemini-embedding-001")
    return "\n".join(render_semantic_section(run))


FAILED = sge.Decision(False, ("probe incomplete: 2/32 answers scored",))


def test_section_reports_threshold_calibration_and_three_columns():
    md = _md(FAILED)
    assert "## Semantic grounding" in md
    assert "`gemini-embedding-001`, 5 text(s) fetched live, 3 from `grounding_embeddings.json`" in md
    assert "- Threshold: 0.550 (cosine of stem + key vs. cited slide)" in md
    assert ("- Calibration: 0/4 misclassified; grounded min 0.800, ungrounded max 0.300; "
            "1 answer(s) decided by deterministic gates, not scored") in md
    assert "| lexical | 1/1 (100%) | 0/1 (0%) |" in md
    assert "| semantic | 0/1 (0%) | 0/1 (0%) |" in md
    assert "| combined | 0/1 (0%) | 0/1 (0%) |" in md
    assert "| `07 DBS Transactions.pdf` | 7 | paraphrased | para answer | 0.208 | 0.710 | ok | no | yes | yes |" in md


def test_interpretation_follows_a_failed_gate():
    md = _md(FAILED)
    assert "FAILED (probe incomplete: 2/32 answers scored)" in md and "stays advisory" in md
    assert "PASSED" not in md
    assert "false drops 1 -> 0, false keeps 0 -> 0" in md


def test_interpretation_follows_a_passed_gate_and_the_live_flags(monkeypatch):
    from backend.core.config import settings
    from backend.services.parser import synthesis

    monkeypatch.setattr(synthesis, "ENFORCE_SUPPORT_THRESHOLD", True)
    monkeypatch.setattr(settings, "grounding_scorer", "semantic", raising=False)
    md = _md(sge.Decision(True, ()))
    assert "PASSED" in md and "FAILED" not in md
    assert "ENFORCE_SUPPORT_THRESHOLD=True, GROUNDING_SCORER=semantic" in md


def test_section_says_not_run_without_the_flag():
    md = "\n".join(render_semantic_section(None))
    assert "Not run." in md and "--grounding-semantic" in md


def test_section_skips_without_calibration_decks():
    run = sge.SemanticRun(None, None, None, ("00 DBS Introduction.pdf",), 0, 0, Path("x.json"), "m")
    assert "Skipped: calibration decks not found" in "\n".join(render_semantic_section(run))


CAL_DECK, PROBE_DECK = "00 DBS Syn.pdf", "07 DBS SynProbe.pdf"


@pytest.fixture
def lab(tmp_path, monkeypatch):
    d = tmp_path / "decks"
    d.mkdir()
    write_pdf(d / CAL_DECK, LONG_DECK)
    write_pdf(d / PROBE_DECK, LONG_DECK)
    monkeypatch.setattr(sge, "CALIBRATION_SETS", ((CAL_DECK, [
        (3, "What does the alpha slide explain?", "The alpha concept", "The bravo concept"),
        (4, "What does the bravo slide explain?", "The bravo concept", "The charlie concept"),
    ], EN_OFF_TOPIC),))
    monkeypatch.setattr(sge, "PROBE_PAIRS", [
        ProbePair(PROBE_DECK, 6, "What does the delta slide explain?", "Fourth letter idea", "Quantum tunnelling", "en"),
    ])
    live = HashingEmbedder()
    monkeypatch.setattr(sge, "_live_fetch", live)
    monkeypatch.delenv("DECK_LAB_ALLOW_EMBEDDING_API", raising=False)
    return d, tmp_path / "emb.json", live


def _args(d, cache, out):
    return ["--dir", str(d), "--grounding-semantic", "--embedding-cache", str(cache), "--out", str(out)]


def test_cli_without_cache_or_permission_exits_2_and_sends_nothing(lab, tmp_path, capsys):
    d, cache, live = lab
    assert main(_args(d, cache, tmp_path / "lab.md")) == 2
    assert "DECK_LAB_ALLOW_EMBEDDING_API" in capsys.readouterr().err
    assert live.calls == [] and not cache.exists() and not (tmp_path / "lab.md").exists()


def _section(path: Path) -> list[str]:
    body = path.read_text(encoding="utf-8").split("## Semantic grounding", 1)[1]
    return [line for line in body.splitlines() if not line.startswith("Embeddings:")]


def test_cli_live_run_writes_the_cache_and_an_offline_rerun_matches(lab, tmp_path, monkeypatch):
    d, cache, live = lab
    monkeypatch.setenv("DECK_LAB_ALLOW_EMBEDDING_API", "1")
    first = tmp_path / "a.md"
    assert main(_args(d, cache, first)) == 0
    assert len(live.calls) == 1 and cache.exists()
    assert "- Threshold:" in first.read_text(encoding="utf-8")
    assert "  embeddings:" in first.read_text(encoding="utf-8")
    monkeypatch.delenv("DECK_LAB_ALLOW_EMBEDDING_API")
    second = tmp_path / "b.md"
    assert main(_args(d, cache, second)) == 0
    assert len(live.calls) == 1
    assert _section(first) == _section(second)


def test_default_cli_run_renders_not_run_and_never_embeds(lab, tmp_path):
    d, _, live = lab
    out = tmp_path / "plain.md"
    assert main(["--dir", str(d), "--out", str(out)]) == 0
    assert "## Semantic grounding" in out.read_text(encoding="utf-8") and live.calls == []
