# Retrieval re-run at the pin: protocol and expectations

Written 2026-11-10, before any retrieval call for this study. This file, the
question set (`backend/eval/data/offtopic_set.json`) and the script
(`backend/eval/offtopic_gate.py`) are committed before the run. Results go to
`RESULTS.md` in this folder and do not change this file.

## Why

Chapter 6 reports a September measurement of the refusal gate (revision
`a696be1`): none of the 27 in-course questions was refused. Two things are
wrong with it as evidence. It predates the scope fix, so it is not a statement
about the pinned revision `dfc20df6`. And every one of its questions has an
answer in the course, so it shows what the gate costs and not what it stops.

## What is run

1. **The grid, unchanged**: `python -m backend.eval.retrieval_grid --golden
   backend/eval/data/golden_set.json` with its defaults, from a clean checkout
   of `dfc20df6`. 50 questions, six lectures, two regimes.
2. **The gate, with off-topic questions**: `backend/eval/offtopic_gate.py`,
   with the code of `dfc20df6` on the path. Configuration is the one production
   uses for a question about a whole Space
   (`backend/services/search_service.py`, `ask_course`): course-scoped hybrid
   retrieval, k = 6, threshold 0.65, then `tutor.is_grounded`. Scope is the
   test course `3354c0a7` (three lectures, 201 pages).

Both read the production database through read-only calls (two RPCs and
selects). No database URL is given to the process, so the direct pool cannot
open. No generation call is made. Cost: about 50 + 57 embedding calls.

## Questions

- **Answerable (27)**: the golden questions whose lecture belongs to the test
  course. Unchanged since September.
- **Tier A (10)**: far off-topic, not computer science.
- **Tier B (10)**: computer science, not databases.
- **Tier C (10)**: database topics that the three lectures do not cover.
  Chosen from a keyword count over the 201 pages: each named term (ACID,
  atomicity, serialisable, two-phase locking, deadlock, B+-tree, normal form,
  CAP, write-ahead, isolation level, phantom, star schema, data warehouse)
  occurs zero times in title and content.

"Refused" means `is_grounded` returns false, which is the point where
production returns its fixed refusal text without calling a model.

## Expectations, fixed before the run

| # | Group | Expectation | Status |
|---|---|---|---|
| E1 | Answerable | at most 1 of 27 refused (September: 0) | confirmatory |
| E2 | Tier A | at least 9 of 10 refused | confirmatory |
| E3 | Tier B | at least 8 of 10 refused | confirmatory |
| E4 | Tier C | no threshold. Prediction: a noticeable share is answered, because text from the same subject can sit above 0.65 | exploratory |
| E5 | Grid | no credibility warning; course_hybrid finds the expected page at k = 5 and k = 8 (threshold 0.65) at least as often as lecture_dense on the paired questions | exploratory |

A failed expectation is reported as failed. Questions are not replaced,
reworded or dropped after the run. If a call errors, the run is repeated as a
whole and the first attempt is mentioned.

## What this cannot show

- Passing the gate is not a wrong answer. The model still gets an instruction
  to answer from the pages only; what it then writes is not measured here.
- Keyword absence is not proof that no page touches a tier C topic.
- One course, 201 pages, English questions, written by the system's developer
  with AI assistance. 10 questions per tier is a small sample; counts are
  reported, not rates with confidence intervals.
