# Seed sweep of the study with scripted readers: protocol

*Written and committed before the first run of the sweep (15 November 2026).
Nothing in the engine, the personas, the arms, the expectations, or the
thresholds changes for this sweep. A result that contradicts a prediction is
reported, not tuned away.*

## Question

The study of 9 November ran each arm with one seed (`20261109` plus the arm's
index) and met 18 of the 23 expectations written before that run. With one
seed per arm we cannot tell which results hold for any draw of the personas'
random choices and which depend on the draw. This sweep asks, for each of
the 23 expectations: **in what share of seeds does it hold?**

## Design

- Code: `backend/eval/persona_study.py` at `a342dea9`, unchanged. A
  byte-identical copy is archived next to the results
  (`../persona_study.py`). The engine at `a342dea9` is identical to the
  deployed revision `2e146f51` (no commit between them touches
  `backend/services` or `backend/api`).
- Seeds: 100 bases, `base_j = 20261109 + 100 * j` for `j = 0 … 99`; arm `k`
  runs with seed `base_j + k`, exactly as the script's own `main()` does.
  `j = 0` is the published run and must reproduce it (18 of 23); if it does
  not, the sweep stops and that is the result.
- Arms: all ten. The 23 pre-registered expectations are scored on arms A–H
  only; the three post-hoc expectations (arms I and J) are reported
  separately and do not count.
- Scoring: the script's own `check()`, unchanged. Per seed and arm we also
  record every finding kind with its pages (including kinds that no
  expectation names, such as `overpacked` and `speed_bump`), the reach word,
  whether the weekly numbers have a value, and whether themes were made.
- Isolation: the code runs from a `git archive` of `a342dea9` outside the
  repository, with an empty environment, placeholder service keys that point
  at a closed local port, no `.env` on any parent path, no database, no
  network, and the themes model stood in for as in the original script.

Before this protocol was committed, the driver ran once on `j = 0` only, the
published seed, to check that it reproduces 18 of 23. No other seed was run.

## What we report

1. For each of the 23 expectations: the number of seeds out of 100 in which
   it holds.
2. The distribution of the total met per seed (minimum, median, maximum, and
   counts), next to the constant 16 of 23 of the engine that reports
   nothing (`../mute_engine.py`).
3. For each arm: how often each finding kind appears, and on which pages.
4. Whether `j = 0` reproduced the published run.

## Predictions, fixed before the run

From reading the personas and the detectors, not from any run:

- **G** (four members): all nine expectations hold in 100 of 100 seeds. The
  Space is below the floor whatever the draw.
- **B** (3 struggling, 10 steady): the hotspot on page 10 appears in 100 of
  100 seeds, so both B expectations fail in 100 of 100. The check-ins are
  not random (3 of 13 confused, 23 % against the rule of 20 %).
- **E** (skimmers): the leak after page 10 and the skipped pages appear, and
  no hotspot appears, in 100 of 100.
- **F** (overconfident): the calibration gap on page 10 appears in 100 of 100.
- **C** (five askers): themes appear in 0 of 100 (no hotspot, so no themes).
  **D**: no themes in 100 of 100.
- **A** (6 struggling, 6 steady): page 10 carries a finding in every seed,
  either the hotspot or the more specific `overpacked`, which pre-empts it
  when the page's median dwell reaches 1.5 times the Lesson's. The median
  dwell of page 10 sits near that line, so we expect the hotspot in only
  part of the seeds, somewhere between 20 % and 60 %. Skipped pages and a
  calibration gap stay absent in 100 of 100; the reach word is never `few`.
  The weekly numbers stay empty in at least 90 of 100.
- **H** (27, all five personas): the hotspot and the calibration gap on page
  10 in 100 of 100; no leak in 100 of 100 (5 skimmers of 27 is 19 %, under
  the 20 % rule); the weekly numbers have a value in roughly 10 % to 25 % of
  seeds, because each reader's day is drawn from 55 days and a week needs
  five readers.
- The note of 9 November ("a different seed moves which pages are skipped,
  not which kinds fire") is false for arm A if the hotspot/overpacked
  prediction holds.

## Run

```
git archive a342dea9 backend | tar -x -C <export>
cd <export>
env -i PATH=/usr/bin:/bin HOME=<tmp> PYTHONPATH=<export> PYTHONDONTWRITEBYTECODE=1 \
  SUPABASE_URL=http://127.0.0.1:9 \
  SUPABASE_SERVICE_ROLE_KEY=placeholder.placeholder.placeholder \
  SUPABASE_ANON_KEY=placeholder.placeholder.placeholder \
  <repo>/.venv/bin/python <repo>/docs/thesis/experiments/persona-study/seed-sweep/seed_sweep.py --out <dir>
```
