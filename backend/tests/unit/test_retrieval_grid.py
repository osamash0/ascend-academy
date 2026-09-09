"""Unit tests for the real-corpus retrieval grid (thesis Section 6).

Everything here runs against pure functions — no database, no API keys, no
model calls — so the metrics the thesis reports are verifiable in CI. The
grid runner itself needs live retrieval and is exercised by running it, not
by these tests.

The tests that matter most are the two about *denominators*: a metric that
quietly drops failed cases inflates every rate above it, and the
false-refusal number is the one the thesis leans on hardest.
"""
from __future__ import annotations

import asyncio
import json
import logging

import pytest

from backend.eval.retrieval_grid import (
    EmbeddingPrecompute,
    GoldenQuestion,
    REGIME_COURSE_HYBRID,
    REGIME_LECTURE_DENSE,
    _is_transient,
    _retry_delay_seconds,
    anchor_found,
    capture_backend_failures,
    credibility_report,
    is_grounded_by_threshold,
    latency_anomalies,
    load_golden_set,
    monotonicity_violations,
    precision_at_k,
    reciprocal_rank,
    score_config,
    serve_embeddings_from,
    slide_found,
    to_csv,
    to_markdown_table,
)

LEC = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"
RANKED = [(LEC, 4), (LEC, 2), (LEC, 9)]


def _case(idx: int, anchor: str = "anch", cid: str = "c1") -> GoldenQuestion:
    return GoldenQuestion(
        id=str(idx), question="q", lecture_id=LEC, slide_index=idx,
        anchor=anchor, course_id=cid,
    )


# ── slide_found / MRR / precision ────────────────────────────────────────

def test_slide_found_matches_on_lecture_and_index():
    assert slide_found(RANKED, (LEC, 2))
    assert not slide_found(RANKED, (LEC, 7))
    # Same slide index in a DIFFERENT lecture is not a hit — this is what
    # makes the course-scoped regime scoreable through the same code.
    assert not slide_found(RANKED, (OTHER, 2))


@pytest.mark.parametrize("expected,rr", [((LEC, 4), 1.0), ((LEC, 2), 0.5), ((LEC, 9), 1 / 3)])
def test_reciprocal_rank_is_one_over_rank(expected, rr):
    assert reciprocal_rank(RANKED, expected) == pytest.approx(rr)


def test_reciprocal_rank_is_zero_when_absent():
    assert reciprocal_rank(RANKED, (LEC, 7)) == 0.0
    assert reciprocal_rank([], (LEC, 4)) == 0.0


def test_precision_at_k_respects_the_k_cutoff():
    # The expected slide sits at rank 3, so it counts at k=5 but not k=2.
    assert precision_at_k(RANKED, (LEC, 9), 5) == pytest.approx(0.2)
    assert precision_at_k(RANKED, (LEC, 9), 2) == 0.0
    assert precision_at_k(RANKED, (LEC, 4), 0) == 0.0


def test_precision_at_k_ceiling_is_one_over_k():
    """With one relevant slide per question a PERFECT retriever scores 1/k.
    Documented as a test so the number is never read as a failure."""
    assert precision_at_k([(LEC, 1)], (LEC, 1), 5) == pytest.approx(0.2)
    assert precision_at_k([(LEC, 1)], (LEC, 1), 10) == pytest.approx(0.1)


# ── anchor matching ──────────────────────────────────────────────────────

def test_anchor_found_normalises_case_and_whitespace():
    """Slide text comes out of PDF extraction with inconsistent spacing, so
    an exact match would measure extraction noise, not retrieval."""
    assert anchor_found(["Correlation  does\nnot   imply causation"],
                        "correlation does not imply causation")
    assert anchor_found(["A", "B", "the QUEUE frontier"], "the queue frontier")


def test_anchor_found_is_false_without_a_match_or_an_anchor():
    assert not anchor_found(["unrelated text"], "binary search")
    assert not anchor_found(["anything at all"], "")
    assert not anchor_found([], "binary search")


# ── groundedness gate ────────────────────────────────────────────────────

def test_is_grounded_by_threshold_is_a_max_comparison():
    assert is_grounded_by_threshold([0.30, 0.71], 0.65)
    assert not is_grounded_by_threshold([0.30, 0.50], 0.65)
    assert is_grounded_by_threshold([0.65], 0.65)  # boundary is inclusive
    assert not is_grounded_by_threshold([], 0.65)


def test_local_gate_agrees_with_the_production_gate():
    """`is_grounded_by_threshold` is reimplemented so the metrics stay
    importable without the backend installed. This asserts it has not
    drifted from `tutor.is_grounded`, which is the real gate."""
    tutor = pytest.importorskip(
        "backend.services.ai.tutor",
        reason="backend deps not installed; gate-agreement check skipped",
    )
    for sims in ([], [0.1], [0.65], [0.64], [0.2, 0.9]):
        retrieved = [{"similarity": s} for s in sims]
        assert tutor.is_grounded(retrieved, 0.65) == is_grounded_by_threshold(sims, 0.65)


# ── aggregation, and the denominators that decide the headline numbers ───

def test_errors_count_as_retrieval_misses_not_exclusions():
    """A failed lookup is a miss the system really produced. Dropping it
    would silently raise slide_found and MRR for every run with an error."""
    cases = [_case(1), _case(2)]
    outcomes = [
        {"keys": [(LEC, 1)], "texts": ["anch"], "similarities": [0.9], "latency_ms": 10.0},
        {"error": "boom"},
    ]
    r = score_config(cases, outcomes, "lecture_dense", 5, 0.65)
    assert r.n == 2 and r.errors == 1
    assert r.slide_found_rate == pytest.approx(0.5)
    assert r.mrr == pytest.approx(0.5)


def test_gate_metrics_exclude_errored_cases_from_their_denominator():
    """An errored lookup returned no similarities, so the gate never judged
    it. Counting it as a refusal would conflate an infrastructure failure
    with a threshold decision."""
    cases = [_case(1), _case(2), _case(3)]
    outcomes = [
        {"keys": [(LEC, 1)], "texts": ["anch"], "similarities": [0.90], "latency_ms": 10.0},
        {"keys": [(LEC, 8)], "texts": ["nope"], "similarities": [0.10], "latency_ms": 20.0},
        {"error": "boom"},
    ]
    r = score_config(cases, outcomes, "lecture_dense", 5, 0.65)
    # One refusal out of TWO judged cases, not out of three total.
    assert r.refusal_rate == pytest.approx(0.5)
    assert r.slide_found_rate == pytest.approx(1 / 3)  # still over all three


def test_skipped_cases_are_excluded_from_every_denominator():
    """A regime that cannot run a case must not be scored as if it missed it.

    `lectures.course_id` is nullable, so the course-scoped regime is structurally
    unable to run some questions. Counting those as misses would make that regime
    look worse for a reason unrelated to retrieval — and the comparison between
    the two regimes is the whole point of running both."""
    cases = [_case(1), _case(2), _case(3)]
    outcomes = [
        {"keys": [(LEC, 1)], "texts": ["anch"], "similarities": [0.9], "latency_ms": 5.0},
        {"skipped": "lecture has no course_id"},
        {"skipped": "lecture has no course_id"},
    ]
    r = score_config(cases, outcomes, "course_hybrid", 5, 0.65)
    assert r.skipped == 2
    # Scored over the ONE case actually attempted, not over all three.
    assert r.slide_found_rate == pytest.approx(1.0)
    assert r.mrr == pytest.approx(1.0)
    assert r.errors == 0


def test_all_cases_skipped_scores_zero_without_dividing_by_zero():
    cases = [_case(1)]
    r = score_config(cases, [{"skipped": "no course_id"}], "course_hybrid", 5, 0.65)
    assert r.skipped == 1
    assert r.slide_found_rate == 0.0 and r.mrr == 0.0


def test_skipped_and_errored_are_counted_separately():
    """An error is a lookup that failed; a skip is one never attempted."""
    cases = [_case(1), _case(2)]
    outcomes = [{"error": "boom"}, {"skipped": "no course_id"}]
    r = score_config(cases, outcomes, "course_hybrid", 5, 0.65)
    assert r.errors == 1 and r.skipped == 1
    assert r.slide_found_rate == 0.0  # the one attempted case missed


def test_false_refusal_is_a_refusal_that_had_the_answer():
    """The number the thesis leans on: the gate rejected a question whose
    expected slide had in fact been retrieved."""
    cases = [_case(1), _case(2)]
    outcomes = [
        # Expected slide retrieved, but every similarity is below threshold.
        {"keys": [(LEC, 1)], "texts": ["anch"], "similarities": [0.40], "latency_ms": 5.0},
        # Refused and genuinely did not have it — a correct refusal.
        {"keys": [(LEC, 8)], "texts": ["nope"], "similarities": [0.10], "latency_ms": 5.0},
    ]
    r = score_config(cases, outcomes, "course_hybrid", 5, 0.65)
    assert r.refusal_rate == pytest.approx(1.0)
    assert r.false_refusal_rate == pytest.approx(0.5)
    # Of the two refusals, half were wrong.
    assert r.false_refusal_share == pytest.approx(0.5)


def test_no_refusals_leaves_false_refusal_share_at_zero_not_divided_by_zero():
    cases = [_case(1)]
    outcomes = [{"keys": [(LEC, 1)], "texts": ["anch"], "similarities": [0.99], "latency_ms": 1.0}]
    r = score_config(cases, outcomes, "lecture_dense", 5, 0.65)
    assert r.refusal_rate == 0.0
    assert r.false_refusal_share == 0.0


def test_empty_case_list_scores_zero_without_raising():
    r = score_config([], [], "lecture_dense", 5, 0.65)
    assert r.n == 0 and r.mrr == 0.0 and r.false_refusal_share == 0.0


# ── golden-set loading ───────────────────────────────────────────────────

def test_load_golden_set_accepts_both_wrapped_and_bare_json(tmp_path):
    payload = [{"id": "q1", "question": "Q?", "lecture_id": LEC, "slide_index": 3,
                "anchor": "a", "course_id": "c1"}]
    bare = tmp_path / "bare.json"
    bare.write_text(json.dumps(payload), encoding="utf-8")
    wrapped = tmp_path / "wrapped.json"
    wrapped.write_text(json.dumps({"questions": payload}), encoding="utf-8")

    for path in (bare, wrapped):
        cases = load_golden_set(path)
        assert len(cases) == 1
        assert cases[0].key == (LEC, 3)


def test_load_golden_set_rejects_a_malformed_case_loudly(tmp_path):
    """A silently skipped case inflates every score after it."""
    path = tmp_path / "bad.json"
    path.write_text(json.dumps([{"question": "Q?", "lecture_id": LEC}]), encoding="utf-8")
    with pytest.raises(ValueError, match="slide_index"):
        load_golden_set(path)


def test_load_golden_set_rejects_an_empty_set(tmp_path):
    path = tmp_path / "empty.json"
    path.write_text("[]", encoding="utf-8")
    with pytest.raises(ValueError, match="no questions"):
        load_golden_set(path)


# ── rendering ────────────────────────────────────────────────────────────

def test_tables_render_without_raising():
    r = score_config(
        [_case(1)],
        [{"keys": [(LEC, 1)], "texts": ["anch"], "similarities": [0.9], "latency_ms": 12.0}],
        "lecture_dense", 5, 0.65,
    )
    md = to_markdown_table([r])
    assert "lecture_dense" in md and md.startswith("| Regime |")
    csv = to_csv([r])
    assert csv.splitlines()[0].startswith("regime,k,threshold")


# ── the guard against reporting a broken run ─────────────────────────────

def _result(n, errors=0, skipped=0, msgs=()):
    r = score_config([], [], "lecture_dense", 5, 0.65)
    r.n, r.errors, r.skipped = n, errors, skipped
    r.error_messages = list(msgs)
    return r


def test_a_run_that_errored_everywhere_is_rejected():
    """The failure that motivated this guard: every lookup raised
    ModuleNotFoundError, and the harness wrote a clean table of zeros into the
    results directory — indistinguishable at a glance from a real result showing
    catastrophic retrieval, and citable by accident."""
    ok, why = credibility_report([_result(50, errors=50, msgs=["No module named 'fastapi'"])], 0.20)
    assert not ok
    assert "50 of 50" in why
    assert "No module named 'fastapi'" in why
    # It must name the remedy, not just the symptom.
    assert "requirements-docker.txt" in why


def test_a_healthy_run_is_accepted():
    ok, why = credibility_report([_result(50, errors=2)], 0.20)
    assert ok and why == ""


def test_threshold_boundary_is_inclusive():
    """Exactly at the limit passes; one more failure does not."""
    assert credibility_report([_result(50, errors=10)], 0.20)[0]
    assert not credibility_report([_result(50, errors=11)], 0.20)[0]


def test_errors_are_measured_against_attempted_not_total():
    """Skipped cases were never attempted, so they must not dilute the error
    rate — otherwise skipping enough questions would launder a broken run."""
    # 10 attempted (40 skipped), 9 of them failed: 90%, not 18%.
    ok, why = credibility_report([_result(50, errors=9, skipped=40)], 0.20)
    assert not ok
    assert "9 of 10" in why


def test_an_all_skipped_run_is_rejected_with_its_own_message():
    ok, why = credibility_report([_result(27, errors=0, skipped=27)], 0.20)
    assert not ok
    assert "skipped" in why.lower() and "course_id" in why


# ── the guard against a run that failed WITHOUT raising ──────────────────
#
# The 2026-09-08 failure raised on every lookup, so counting errors caught it.
# The 2026-09-09 failure raised nothing: the production retriever catches its
# own provider failures by design (retrieval.py:120-124, :206-213,
# cache.py:380-382), so the grid reported `Err 0` on all 32 rows and named a
# best configuration of `MRR 0.806, slide_found 0.940` while Gemini had been
# returning 429 for most of the sweep. These tests pin the two mechanisms that
# close that hole: reading the warnings production emits, and rejecting a table
# whose own numbers are mutually impossible.


def _cell(regime, k, thr, slide_found_rate, n=50, skipped=0, latency=500.0):
    r = score_config([], [], regime, k, thr)
    r.n, r.skipped = n, skipped
    r.slide_found_rate = slide_found_rate
    r.median_latency_ms = latency
    return r


def test_capture_turns_a_swallowed_warning_into_a_visible_record():
    """`retrieval.py` logs and returns [] rather than raising. The harness has
    to read the log, because there is no exception to catch."""
    with capture_backend_failures() as captured:
        logging.getLogger("backend.services.ai.retrieval").warning(
            "Scoped query embedding/search failed: 429 RESOURCE_EXHAUSTED"
        )
    assert len(captured.records) == 1
    assert "429 RESOURCE_EXHAUSTED" in captured.records[0]


def test_capture_ignores_loggers_outside_backend_and_detaches_cleanly():
    with capture_backend_failures() as captured:
        logging.getLogger("httpx").warning("noisy third-party warning")
    assert captured.records == []
    # Nothing captured after the block, so a later query is not blamed for an
    # earlier one's failure.
    logging.getLogger("backend.services.cache").error("after the block")
    assert captured.records == []


def test_capture_survives_a_root_logger_set_to_error():
    """A record is filtered at its originating logger's *effective* level, so a
    caller who quietened the root logger would otherwise suppress exactly the
    warnings this exists to read."""
    root = logging.getLogger()
    previous = root.level
    root.setLevel(logging.ERROR)
    try:
        with capture_backend_failures() as captured:
            logging.getLogger("backend.services.ai.retrieval").warning("429 quota")
        assert len(captured.records) == 1
    finally:
        root.setLevel(previous)


def test_a_silently_degraded_lookup_is_scored_as_an_error_not_a_miss():
    """The distinction the whole fix rests on. A quota failure returns an empty
    list, which is shaped exactly like an honest 'nothing matched' — but one is
    a fact about the retriever and the other is a fact about the provider."""
    cases = [_case(1), _case(2)]
    outcomes = [
        {"error": "silent degradation: 429 RESOURCE_EXHAUSTED", "latency_ms": 55.0},
        {"keys": [(LEC, 2)], "texts": ["anch"], "similarities": [0.9], "latency_ms": 500.0},
    ]
    r = score_config(cases, outcomes, REGIME_LECTURE_DENSE, 5, 0.65)
    assert r.errors == 1
    assert any("429" in m for m in r.error_messages)
    # Scored as a miss for retrieval quality (it really returned nothing) but
    # excluded from the gate denominator, so a dead provider is never counted
    # as the threshold making a decision.
    assert r.slide_found_rate == 0.5
    assert r.refusal_rate == 0.0


# ── the invariants ───────────────────────────────────────────────────────

def test_slide_found_falling_as_k_rises_is_impossible_and_rejected():
    """A larger top-k returns a superset of a smaller one."""
    results = [_cell(REGIME_LECTURE_DENSE, 3, 0.0, 0.860),
               _cell(REGIME_LECTURE_DENSE, 5, 0.0, 0.000)]
    violations = monotonicity_violations(results, 0.02)
    assert len(violations) == 1
    assert "FELL" in violations[0] and "k=3" in violations[0] and "k=5" in violations[0]
    ok, why = credibility_report(results, 0.20)
    assert not ok and "superset" in why


def test_slide_found_rising_with_a_stricter_threshold_is_impossible_and_rejected():
    """In lecture_dense the threshold is a hard SQL filter on one candidate
    list, so raising it is strictly subtractive."""
    results = [_cell(REGIME_LECTURE_DENSE, 8, 0.00, 0.400),
               _cell(REGIME_LECTURE_DENSE, 8, 0.50, 0.940)]
    violations = monotonicity_violations(results, 0.02)
    assert len(violations) == 1 and "ROSE" in violations[0]
    assert not credibility_report(results, 0.20)[0]


def test_the_same_threshold_pattern_is_ACCEPTED_for_course_hybrid():
    """The regression guard for this check. In the hybrid regime the threshold
    filters only the vector arm while the keyword arm is unfiltered, so
    shrinking the vector list reranks the fusion and can promote a keyword-only
    slide into the top-k. Asserting monotonicity there would reject healthy
    runs — the check must be regime-aware, not universal."""
    results = [_cell(REGIME_COURSE_HYBRID, 8, 0.00, 0.400),
               _cell(REGIME_COURSE_HYBRID, 8, 0.50, 0.940)]
    assert monotonicity_violations(results, 0.02) == []
    assert credibility_report(results, 0.20)[0]


def test_k_monotonicity_still_applies_to_course_hybrid():
    """Only the threshold check is exempt; rrf_fuse takes ordered_keys[:k] from
    a pool sized max(k*2, 8), so k is a superset there too."""
    results = [_cell(REGIME_COURSE_HYBRID, 3, 0.5, 0.500),
               _cell(REGIME_COURSE_HYBRID, 5, 0.5, 0.100)]
    assert len(monotonicity_violations(results, 0.02)) == 1


def test_a_movement_within_tolerance_is_accepted():
    """HNSW is approximate and _fetch_slide can drop an enriched hit, so one
    case in fifty may legitimately move. The default tolerance covers that and
    nothing larger."""
    results = [_cell(REGIME_LECTURE_DENSE, 3, 0.0, 0.860),
               _cell(REGIME_LECTURE_DENSE, 5, 0.0, 0.840)]   # one case in 50
    assert monotonicity_violations(results, 0.02) == []
    assert credibility_report(results, 0.20)[0]


def test_a_fully_skipped_cell_never_manufactures_a_violation():
    """It scores 0.0 by definition; comparing that against a scored cell would
    turn the golden set's course_id gap into a false rejection."""
    results = [_cell(REGIME_COURSE_HYBRID, 3, 0.5, 0.500, n=27, skipped=0),
               _cell(REGIME_COURSE_HYBRID, 5, 0.5, 0.000, n=27, skipped=27)]
    assert monotonicity_violations(results, 0.02) == []


def test_the_real_2026_09_09_table_is_rejected():
    """Regression test built from the numbers the author actually got. Every
    row reported Err 0, so the error-rate check passed it; eight independent
    invariant violations reject it."""
    observed = {  # (k, threshold) -> (slide_found, median latency ms)
        (3, 0.00): (0.860, 476), (3, 0.50): (0.860, 477),
        (3, 0.65): (0.840, 463), (3, 0.75): (0.160, 58),
        (5, 0.00): (0.000, 56), (5, 0.50): (0.000, 55),
        (5, 0.65): (0.000, 55), (5, 0.75): (0.000, 55),
        (8, 0.00): (0.400, 59), (8, 0.50): (0.940, 817),
        (8, 0.65): (0.680, 647), (8, 0.75): (0.000, 55),
        (10, 0.00): (0.000, 53), (10, 0.50): (0.000, 55),
        (10, 0.65): (0.000, 55), (10, 0.75): (0.000, 55),
    }
    results = [_cell(REGIME_LECTURE_DENSE, k, t, found, latency=lat)
               for (k, t), (found, lat) in observed.items()]

    # This is what let it through before: no lookup ever raised.
    assert sum(r.errors for r in results) == 0
    assert len(monotonicity_violations(results, 0.02)) == 8

    ok, why = credibility_report(results, 0.20)
    assert not ok
    assert "0.940" in why          # names the impossible cell
    assert "No results were written" in why

    # And the heuristic that made it legible by eye still fires, as a warning.
    notes = latency_anomalies(results)
    assert len(notes) == 1 and "15.4x" in notes[0]


def test_a_healthy_grid_passes_every_check():
    """The shape a good run has: non-decreasing in k, non-increasing in
    threshold, latency in one band."""
    results = [
        _cell(REGIME_LECTURE_DENSE, 3, 0.00, 0.86, latency=470),
        _cell(REGIME_LECTURE_DENSE, 5, 0.00, 0.90, latency=490),
        _cell(REGIME_LECTURE_DENSE, 8, 0.00, 0.94, latency=520),
        _cell(REGIME_LECTURE_DENSE, 3, 0.65, 0.80, latency=465),
        _cell(REGIME_LECTURE_DENSE, 5, 0.65, 0.84, latency=480),
        _cell(REGIME_LECTURE_DENSE, 8, 0.65, 0.88, latency=505),
    ]
    assert monotonicity_violations(results, 0.02) == []
    assert latency_anomalies(results) == []
    assert credibility_report(results, 0.20) == (True, "")


# ── the embedding precompute ─────────────────────────────────────────────

def test_a_daily_quota_failure_is_not_retried_but_a_per_minute_one_is():
    """Retrying only helps for what a wait can fix. Sleeping through a spent
    daily allowance costs the author minutes to deliver the same failure."""
    per_day = ("429 RESOURCE_EXHAUSTED ... 'quotaId': "
               "'EmbedContentRequestsPerDayPerUserPerProjectPerModel-FreeTier'")
    assert not _is_transient(per_day)
    assert _is_transient("429 rate limit exceeded, please retry")
    assert not _is_transient("ModuleNotFoundError: No module named 'fastapi'")
    assert not _is_transient("EmbeddingUnavailableError: GEMINI_API_KEY is not configured")


def test_the_providers_own_retry_delay_is_honoured():
    """Google returns `'retryDelay': '7s'` next to the 429; obeying it beats
    guessing, and it is already in the message the exception carried."""
    assert _retry_delay_seconds("... 'retryDelay': '7s' ...", attempt=1) == 8.0
    assert _retry_delay_seconds("no delay named", attempt=3) == 8.0


def test_precomputed_embeddings_are_served_to_the_retriever_and_then_restored():
    """The swap is what lets one embedding serve all 32 cells without touching
    the deployed retriever. It must be complete for the run and undone after."""
    retrieval = pytest.importorskip(
        "backend.services.ai.retrieval",
        reason="backend deps not installed; embedding-swap check skipped",
    )
    original = retrieval._embed_query_cached
    with serve_embeddings_from({"q": [0.1, 0.2]}):
        assert retrieval._embed_query_cached is not original
        assert asyncio.run(retrieval._embed_query_cached("q")) == [0.1, 0.2]
        # A question the precompute never saw must raise, not return [] —
        # returning [] is precisely the silent degradation being fixed.
        with pytest.raises(RuntimeError, match="no precomputed embedding"):
            asyncio.run(retrieval._embed_query_cached("unseen"))
    assert retrieval._embed_query_cached is original


def test_a_precompute_with_any_failure_is_not_ok():
    """The run aborts before scoring a single cell, so no partial table exists
    to quarantine later."""
    assert EmbeddingPrecompute(embeddings={"a": [0.1]}).ok
    assert not EmbeddingPrecompute(embeddings={"a": [0.1]},
                                   failures={"b": "429 RESOURCE_EXHAUSTED"}).ok


def test_the_quota_rejection_names_the_precompute_arithmetic():
    """The message has to tell the author the thing they cannot see: that the
    grid no longer costs 1232 calls, so waiting for the reset is enough."""
    r = _cell(REGIME_LECTURE_DENSE, 5, 0.65, 0.0)
    r.errors, r.error_messages = 50, ["silent degradation: 429 RESOURCE_EXHAUSTED"]
    ok, why = credibility_report([r], 0.20)
    assert not ok
    assert "50, not 1232" in why


# ── end to end: what actually reaches the results directory ──────────────
#
# The 2026-09-09 damage was not a wrong number in memory, it was a file. These
# tests drive `main_async` with a fake retriever and assert on what is left on
# disk, because that is the artefact a thesis can accidentally cite.

import sys                                                    # noqa: E402
import types                                                  # noqa: E402
from argparse import Namespace                                # noqa: E402

from backend.eval.retrieval_grid import main_async            # noqa: E402


def _install_fake_backend(monkeypatch, *, embed, retrieve):
    """Stand in for the backend package so the harness's own control flow can be
    tested without a database, API keys, or the 30-minute dependency install."""
    embeddings_mod = types.ModuleType("backend.services.ai.embeddings")
    embeddings_mod.generate_embeddings = embed

    retrieval_mod = types.ModuleType("backend.services.ai.retrieval")
    retrieval_mod._embed_query_cached = embed
    retrieval_mod.retrieve_relevant_slides = retrieve
    retrieval_mod.retrieve_relevant_slides_course_scoped = retrieve

    for name, mod in (("backend.services.ai.embeddings", embeddings_mod),
                      ("backend.services.ai.retrieval", retrieval_mod)):
        monkeypatch.setitem(sys.modules, name, mod)
    monkeypatch.setattr(sys.modules["backend.services.ai"], "retrieval",
                        retrieval_mod, raising=False)
    return retrieval_mod


def _golden_file(tmp_path, n=4):
    path = tmp_path / "golden.json"
    path.write_text(json.dumps([
        {"id": f"q{i}", "question": f"question {i}", "lecture_id": LEC,
         "slide_index": i, "anchor": f"anchor {i}", "course_id": "c1"}
        for i in range(n)
    ]), encoding="utf-8")
    return path


def _args(tmp_path, **over):
    base = dict(golden=str(_golden_file(tmp_path)), k="3,5", threshold="0.0,0.65",
                regimes=REGIME_LECTURE_DENSE, outdir=str(tmp_path / "results"),
                max_error_rate=0.20, monotonicity_tolerance=0.02, rate_limit=0.0,
                force=False, allow_errors=False, verbose=False)
    base.update(over)
    return Namespace(**base)


def test_a_quota_failure_aborts_before_the_sweep_and_writes_nothing(monkeypatch, tmp_path):
    """The decisive property of the precompute: there is no partially-corrupted
    table to notice later, because none is ever produced."""
    calls = []

    async def embed(text):
        calls.append(text)
        raise RuntimeError(
            "429 RESOURCE_EXHAUSTED. Quota exceeded for metric: "
            "embed_content_free_tier_requests, limit: 1000 "
            "'quotaId': 'EmbedContentRequestsPerDayPerUserPerProjectPerModel-FreeTier'"
        )

    async def retrieve(*a, **kw):
        raise AssertionError("the sweep must not start when embeddings failed")

    _install_fake_backend(monkeypatch, embed=embed, retrieve=retrieve)
    rc = asyncio.run(main_async(_args(tmp_path)))

    assert rc == 2
    assert not (tmp_path / "results").exists(), "a failed run must leave no artefact"
    # A spent daily allowance is not retried: one attempt per question, no more.
    assert len(calls) == 4


def test_a_healthy_run_writes_a_stamped_directory_with_provenance(monkeypatch, tmp_path):
    async def embed(text):
        return [0.1, 0.2, 0.3]

    async def retrieve(question, **kw):
        idx = int(question.split()[-1])
        return [{"slide_index": idx, "lecture_id": LEC, "title": "t",
                 "content": f"anchor {idx}", "similarity": 0.9}]

    _install_fake_backend(monkeypatch, embed=embed, retrieve=retrieve)
    rc = asyncio.run(main_async(_args(tmp_path)))
    assert rc == 0

    runs = list((tmp_path / "results").iterdir())
    assert len(runs) == 1 and runs[0].is_dir(), "output goes in a timestamped subdir"
    body = (runs[0] / "grid_results.md").read_text(encoding="utf-8")
    assert body.startswith("<!--")
    assert "verdict   : ACCEPTED" in body
    # The header must state what the latency column does and does not include,
    # because the precompute changed its meaning.
    assert "EXCLUDES the" in body and "query-embedding round trip" in body
    assert "4 questions, 4 distinct" in body
    assert (runs[0] / "grid_results.csv").exists()
    assert (runs[0] / "grid_per_question.json").exists()


def test_one_embedding_per_distinct_question_not_one_per_grid_cell(monkeypatch, tmp_path):
    """The arithmetic that caused the incident: the old sweep re-embedded every
    question in every cell, paying 1232 calls against a 1000/day ceiling."""
    calls = []

    async def embed(text):
        calls.append(text)
        return [0.1, 0.2, 0.3]

    async def retrieve(question, **kw):
        return [{"slide_index": 0, "lecture_id": LEC, "title": "t",
                 "content": "anchor 0", "similarity": 0.9}]

    _install_fake_backend(monkeypatch, embed=embed, retrieve=retrieve)
    # 2 k values x 2 thresholds = 4 cells over 4 questions = 16 lookups...
    asyncio.run(main_async(_args(tmp_path)))
    # ...and exactly 4 embedding calls.
    assert len(calls) == 4
    assert sorted(calls) == [f"question {i}" for i in range(4)]


def test_an_incoherent_run_writes_nothing(monkeypatch, tmp_path):
    """The 2026-09-09 shape, driven end to end: retrieval succeeds at k=3 and
    silently returns nothing at k=5, exactly as an exhausted quota does."""
    async def embed(text):
        return [0.1, 0.2, 0.3]

    async def retrieve(question, **kw):
        if kw.get("k", 0) >= 5:
            return []          # what a swallowed 429 looks like from here
        idx = int(question.split()[-1])
        return [{"slide_index": idx, "lecture_id": LEC, "title": "t",
                 "content": f"anchor {idx}", "similarity": 0.9}]

    _install_fake_backend(monkeypatch, embed=embed, retrieve=retrieve)
    rc = asyncio.run(main_async(_args(tmp_path)))

    assert rc == 2
    assert not (tmp_path / "results").exists()


def test_allow_errors_writes_the_table_but_stamps_it_do_not_cite(monkeypatch, tmp_path):
    """The escape hatch must not produce something that reads like a result."""
    async def embed(text):
        return [0.1, 0.2, 0.3]

    async def retrieve(question, **kw):
        if kw.get("k", 0) >= 5:
            return []
        idx = int(question.split()[-1])
        return [{"slide_index": idx, "lecture_id": LEC, "title": "t",
                 "content": f"anchor {idx}", "similarity": 0.9}]

    _install_fake_backend(monkeypatch, embed=embed, retrieve=retrieve)
    rc = asyncio.run(main_async(_args(tmp_path, allow_errors=True)))
    assert rc == 0

    runs = list((tmp_path / "results").iterdir())
    body = (runs[0] / "grid_results.md").read_text(encoding="utf-8")
    assert "DO NOT CITE" in body


def test_output_from_an_earlier_run_blocks_the_next_one(monkeypatch, tmp_path):
    """Directly aimed at the corrupted file still sitting in thesis/results:
    the harness names it and refuses to run alongside it."""
    results = tmp_path / "results"
    results.mkdir()
    (results / "grid_results.md").write_text("stale corrupted table", encoding="utf-8")

    async def embed(text):
        raise AssertionError("must refuse before doing any work")

    _install_fake_backend(monkeypatch, embed=embed, retrieve=embed)
    assert asyncio.run(main_async(_args(tmp_path))) == 3
    # Untouched, so the author decides what happens to it.
    assert (results / "grid_results.md").read_text(encoding="utf-8") == "stale corrupted table"
