# Evaluation harness

Two harnesses live here. They measure different things and only one of them
can produce numbers for the thesis.

| | `run_eval.py` | `retrieval_grid.py` |
|---|---|---|
| Golden set | synthetic (`golden_sets.py`) | real decks (`data/golden_set.json`) |
| Purpose | prove the scorer detects a seeded regression | **measure the real system** |
| Runs in CI | yes, via `FakePipeline` | no — needs a database |
| Produces thesis numbers | no | **yes** |

`run_eval.py` is a regression detector whose fixtures are deliberately
synthetic — its `deck_id`s ("algorithms_101") match no database row, so it
cannot be pointed at production. `LivePipeline` now says so loudly rather
than returning 0.0, because a zero meaning "misconfigured" is
indistinguishable from a zero meaning "retrieval failed", and reporting the
second when the first is true would be a fabricated result.

`retrieval_grid.py` is the real-corpus evaluation.

---

## Running the real evaluation

Needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a provider key for
query embedding (`GEMINI_API_KEY`). The sweep embeds queries and runs
ANN/FTS search — it calls **no generation model**, so a full grid is cheap.

### 1. Survey the corpus

```bash
python -m backend.eval.make_golden_template --list
```

Lists every non-archived lecture with its real slide count and **embedding
coverage**. Coverage is the column that decides usability: embeddings are
written fire-and-forget during ingestion (`unified_orchestrator.py:795`), so
a lecture can hold slides and no vectors, and retrieval over it returns
nothing however good the retriever is.

Pick 6–9 decks at or near 100% coverage, preferably from **one course** so
the course-scoped hybrid regime has a meaningful search space. Write down
why you picked them — deliberate selection is a threat to validity, and
stating it is worth more than pretending the sample was random.

A `drift` marker means `lectures.total_slides` disagrees with the real row
count. That is a finding, not noise.

### 2. Generate the question template

```bash
python -m backend.eval.make_golden_template \
    --lectures <uuid>,<uuid>,<uuid> \
    --per-lecture 8 \
    --out backend/eval/data/golden_set.json
```

Emits a skeleton with `lecture_id`, `course_id` and `slide_index` filled in,
plus each slide's real title and text preview. Slides are sampled evenly
across the deck so questions do not cluster on title and agenda slides.

### 3. Write the questions — the only part that is actually human work

For each entry fill in:

- **`question`** — what a student would genuinely ask about that slide.
- **`anchor`** — a short verbatim phrase from the slide. Matched case- and
  whitespace-insensitively, because PDF extraction produces inconsistent
  spacing and an exact match would measure extraction noise instead of
  retrieval.
- **`category`** — `text`, or `visual` for diagram-heavy slides. Visual
  cases probe the 25-character vision-routing threshold
  (`unified_orchestrator.py:64`).

Delete any entry you do not want. Target 50–80 questions.

> **`slide_index` is 0-based and already correct.** `slides.slide_number` is
> 1-based; retrieval returns the 0-based form (`retrieval.py:345` looks up
> `slide_number == slide_index + 1`). Do not "fix" `slide_index` to match
> the `_slide_number_1based` field shown next to it — that would put every
> question off by one and score the whole evaluation near zero while looking
> entirely plausible.

Verify every expectation against the real slide yourself. A golden set
graded against the model's own opinion is not a regression detector — the
rule `golden_sets.py` already states.

### 4. Run the grid

```bash
python -m backend.eval.retrieval_grid --golden backend/eval/data/golden_set.json
```

Sweeps `k × threshold × regime` and writes `grid_results.md` (paste-ready),
`grid_results.csv`, and `grid_per_question.json` into a **timestamped
subdirectory** of `thesis/results/`, each stamped with a provenance header
naming the date, commit, corpus and verdict.

Defaults: `k ∈ {3,5,8,10}`, `threshold ∈ {0.0,0.5,0.65,0.75}`, both regimes
— 32 cells. Narrow with `--k`, `--threshold`, `--regimes`.

**Query embeddings are computed once per distinct question**, before the sweep,
and served to all 32 cells. This is not an optimisation, it is the fix for an
incident. The naive loop re-embedded every question in every cell:

```
lecture_dense   16 cells × 50 cases = 800
course_hybrid   16 cells × 27 cases = 432   (23 lack a course_id)
                                      ────
                                      1232 calls, against a 1000/day free tier
```

Fifty distinct questions cost fifty calls, so a full grid is now re-runnable
twenty times a day inside the same quota, and **grid size no longer drives
quota at all**. Add `--rate-limit N` to pace the precompute if a per-minute
ceiling is tight.

Because the embedding is precomputed, the `latency_ms` column measures ANN/FTS
search plus slide enrichment and **excludes** the embedding round trip, which is
reported separately in the header. That is the better number for comparing
configurations — embedding cost is identical in every cell — but say so in the
thesis when you report it.

### Two tables, because one would be a confound

The run emits `grid_results.md` (full corpus) and, when the regimes differ in what they can run,
`grid_paired.md`.

Only 3 of the 6 corpus lectures carry a `course_id`, so `lecture_dense` is scored on 50 questions
across 6 lectures and `course_hybrid` on 27 across 3. Printing both as rows of one table invites
exactly the wrong reading: the difference between them then mixes **regime** with **corpus**, and
the false-refusal rate — the number this evaluation exists to produce — would be computed on a
different population than the number it is compared against.

`grid_paired.md` re-scores every cell over the cases *all* regimes could run, so the comparison is
a comparison. `grid_results.md` keeps the full corpus as the headline `lecture_dense` retrieval
number, where the larger n is a strength rather than a confound. **Cite the paired table for
anything comparing regimes, and the full table for anything about retrieval quality alone.**

One asymmetry survives pairing and has to be stated rather than fixed: even on identical questions
the regimes search different spaces — `lecture_dense` is scoped to one lecture, `course_hybrid` to
a whole course. A lower hybrid score is therefore partly a harder task and not purely a worse
retriever. That belongs in threats to validity and in the table caption.

### Why a run can be refused

A grid that fails still renders as a clean, plausible table. That has now
happened twice, so the harness refuses to write one on two independent grounds.

**Too many failures.** More than `--max-error-rate` (default 20%) of attempted
lookups errored. This caught a run where a missing `fastapi` made every lookup
raise and the harness wrote 32 rows of `0.000`.

**The numbers contradict each other.** The second incident raised *nothing* —
the production retriever catches its own provider failures by design
(`retrieval.py:120-124`, `:206-213`, `cache.py:380-382`), so a run with an
exhausted Gemini quota reported `Err 0` on every row and named a best
configuration of `MRR 0.806`. What exposed it was that the table was internally
impossible. Two properties follow from the retrieval SQL:

- `slide_found` cannot **fall as k rises** — a larger top-k is a superset
  (`LIMIT match_count` over one ordered list).
- In `lecture_dense`, `slide_found` cannot **rise as the threshold tightens** —
  `match_slides_by_lecture` (migration `20260719020001:45-53`) filters on
  similarity, then orders by it, then limits, so a stricter threshold removes
  exactly a suffix of the ranked list.

Checked with a tolerance of `--monotonicity-tolerance` (default 0.02, one case
in fifty) because HNSW is approximate. Against the corrupted run these fire
eight times, the largest at 0.940.

The threshold check is **deliberately not applied to `course_hybrid`**: there the
threshold filters only the vector arm while the keyword arm is unfiltered, so
shrinking the vector list reranks the fusion and can legitimately promote a
keyword-only slide into the top-k.

`--allow-errors` writes the table anyway, stamped `DO NOT CITE`. An existing
`grid_results.md` directly in `--outdir` blocks the run until it is deleted or
`--force` is passed.

---

## What the metrics mean

| Metric | Meaning |
|---|---|
| `slide_found` | the expected slide appeared anywhere in the top-k |
| `anchor_found` | the anchor phrase appeared in the retrieved text — a passage-level signal that survives the slide being retrieved for the wrong reason |
| `mrr` | mean of 1/rank of the expected slide; 0 when absent |
| `p_at_k` | precision@k. **Ceiling is 1/k** with one relevant slide per question, so a perfect retriever scores 0.20 at k=5. Report it against that ceiling or it reads as failure |
| `refusal` | share of judged questions where max similarity fell below threshold — what the course tutor refuses before calling any model |
| `false_refusal` | refusals where the expected slide **had** been retrieved. The gate rejected a question the corpus demonstrably answers |
| `errors` | failed lookups, **including silent ones**. Counted as retrieval **misses** (dropping them would inflate every rate) but excluded from the gate denominators (an errored lookup returned no similarities, so the gate never judged it). A lookup counts as errored when it raises *or* when any `backend.*` logger emits a WARNING during it — which is how a swallowed `429` becomes visible, since production is built never to raise |

`false_refusal` is the most original number this harness produces. Both
tutors retrieve and cite; only the course tutor can refuse before a model
call. Measuring what that safety gate costs — questions it rejects that the
corpus could have answered — is a comparison the system's own asymmetry
makes possible.

## Tests

```bash
pytest backend/tests/unit/test_retrieval_grid.py backend/tests/unit/test_eval_harness.py
```

Every metric is a pure function and is tested without a database, API keys,
or model calls. `test_local_gate_agrees_with_the_production_gate` asserts the
harness's threshold check has not drifted from `tutor.is_grounded`, which is
the real gate; it skips when backend deps are absent.
