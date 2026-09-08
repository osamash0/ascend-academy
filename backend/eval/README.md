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
`grid_results.csv`, and `grid_per_question.json` into `thesis/results/`.

Defaults: `k ∈ {3,5,8,10}`, `threshold ∈ {0.0,0.5,0.65,0.75}`, both regimes
— 32 cells. Narrow with `--k`, `--threshold`, `--regimes`.

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
| `errors` | failed lookups. Counted as retrieval **misses** (dropping them would inflate every rate) but excluded from the gate denominators (an errored lookup returned no similarities, so the gate never judged it) |

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
