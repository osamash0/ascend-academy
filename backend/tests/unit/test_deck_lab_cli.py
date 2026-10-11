"""CLI smoke test on tiny synthetic PDFs written with PyMuPDF. No network,
no LLM. Expected rows follow the hand-checked answers in
tests/support/deck_lab_decks.py."""
import pytest

from backend.eval.data.grounding_probe import ProbePair
from backend.eval.deck_lab import main, render_markdown, run_grounding_probe, score_deck
from backend.services.parser.deck_plan import build_deck_skeleton
from backend.tests.support.deck_lab_decks import LONG_DECK, SHORT_DECK, write_pdf

LONG = "00 DBS Syn.pdf"
SHORT = " 01__SR_Syn_v01_01.01.2026.pdf"  # leading space, like the real SR files


@pytest.fixture
def deck_dir(tmp_path):
    d = tmp_path / "decks"
    d.mkdir()
    write_pdf(d / LONG, LONG_DECK)
    write_pdf(d / SHORT, SHORT_DECK)
    write_pdf(d / "00 DBS Syn-2.pdf", LONG_DECK)  # OS re-download copy: must be skipped
    return d


def test_cli_writes_scorecard_for_discovered_decks(deck_dir, tmp_path):
    out = tmp_path / "lab.md"
    assert main(["--dir", str(deck_dir), "--out", str(out)]) == 0
    md = out.read_text(encoding="utf-8")
    assert "Syn-2" not in md
    # quiz input
    assert "| `00 DBS Syn.pdf` | 18 | 3 | 2 | 1 | 2 | 0.50 | 0.83 |" in md
    assert f"| `{SHORT}` | 4 | 1 | 1 | 1 | 1 | 0.50 | 0.50 |" in md
    assert "| **Total (2 decks)** | 22 | 4 | 3 | 2 | 3 | 0.50 | 0.67 |" in md
    # meta pass
    assert "| `00 DBS Syn.pdf` | 83% | 83% | 15 | 18 |" in md
    assert "| **Total (2 decks)** | 86% | 86% | 1/2 decks to the end | 2/2 decks to the end |" in md
    # boilerplate
    assert "| `00 DBS Syn.pdf` | 1 | 54 | 45 | 2.5 |" in md
    assert "| **Total (2 decks)** | 2 | 66 | 54 | 2.5 |" in md
    assert "implied" not in md.lower()
    # roles
    assert "| `00 DBS Syn.pdf` | 3 | 1 | 2 | 0 | 15 | 0 | 0 | 0 | 0 |" in md
    # probe decks are not in the synthetic dir
    assert "Probe skipped" in md and "07 DBS Transactions.pdf" in md
    assert "LLM calls : 0" in md


def test_cli_scores_only_the_named_decks(deck_dir, tmp_path):
    out = tmp_path / "lab.md"
    assert main(["--dir", str(deck_dir), "--decks", LONG, "--out", str(out)]) == 0
    md = out.read_text(encoding="utf-8")
    assert "01__SR_Syn" not in md and "**Total (1 deck)**" in md


def test_cli_prints_to_stdout_without_out(deck_dir, capsys):
    assert main(["--dir", str(deck_dir), "--decks", LONG]) == 0
    assert capsys.readouterr().out.startswith("# Deck Lab")


def test_cli_fails_loudly_on_a_missing_deck(deck_dir, capsys):
    assert main(["--dir", str(deck_dir), "--decks", "09 DBS Nope.pdf"]) == 1
    assert "09 DBS Nope.pdf" in capsys.readouterr().err


def test_cli_fails_when_no_decks_are_found(tmp_path, capsys):
    assert main(["--dir", str(tmp_path)]) == 1
    assert "no lecture decks" in capsys.readouterr().err


def test_probe_section_reports_rates_and_rows():
    pairs = [
        ProbePair("syn", 3, "What does the alpha slide explain?",
                  "The alpha concept", "Quantum entanglement of photons", "en"),
        ProbePair("syn", 4, "What does the bravo slide explain?",
                  "Quantum tunnelling", "The bravo concept, in enough words", "en"),
    ]
    probe = run_grounding_probe(pairs, {"syn": build_deck_skeleton(LONG_DECK)})
    md = render_markdown([score_deck("syn", LONG_DECK)], probe, ["<!-- test -->"])
    assert "- False drop (paraphrased grounded answer rejected): 1/2 (50%)" in md
    assert "- False keep (on-topic hallucination accepted): 1/2 (50%)" in md
    assert "| `syn` | 4 | hallucinated | The bravo concept, in enough words | 1.000 | ok | yes |" in md
    assert "| `syn` | 4 | paraphrased | Quantum tunnelling | 0.000 | low_support | no |" in md


def test_probe_section_states_interpretation_and_advisory_consequence():
    pairs = [ProbePair("syn", 3, "What does the alpha slide explain?",
                       "The alpha concept", "Quantum entanglement of photons", "en")]
    probe = run_grounding_probe(pairs, {"syn": build_deck_skeleton(LONG_DECK)})
    md = render_markdown([score_deck("syn", LONG_DECK)], probe, ["<!-- test -->"])
    assert "lower bound on paraphrase fidelity" in md
    assert "not that the verifier cannot be fooled" in md
    assert "ENFORCE_SUPPORT_THRESHOLD=False" in md and "flagged, not dropped" in md
    assert "Realized per synthesized slide" in md


def _probe_md(pairs):
    probe = run_grounding_probe(pairs, {"syn": build_deck_skeleton(LONG_DECK)})
    return render_markdown([score_deck("syn", LONG_DECK)], probe, ["<!-- test -->"])


def test_interpretation_follows_a_nonzero_false_keep():
    md = _probe_md([ProbePair("syn", 4, "What does the bravo slide explain?",
                              "Quantum tunnelling", "The bravo concept, in enough words", "en")])
    assert "1 hallucinated answer passed the verifier" in md
    assert "false-keep rate of zero" not in md


def test_interpretation_follows_the_live_enforce_flag(monkeypatch):
    from backend.services.parser import synthesis

    monkeypatch.setattr(synthesis, "ENFORCE_SUPPORT_THRESHOLD", True)
    md = _probe_md([ProbePair("syn", 3, "What does the alpha slide explain?",
                              "The alpha concept", "Quantum entanglement of photons", "en")])
    assert "repaired once, then dropped" in md
    assert "flagged, not dropped" not in md and "advisory mode" not in md
