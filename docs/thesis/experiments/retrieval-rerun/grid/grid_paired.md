<!--
  generated : 2026-11-10 14:36:18Z
  commit    : dfc20df6
  golden set: backend/eval/data/golden_set.json (50 questions, 50 distinct)
  grid      : regimes=lecture_dense,course_hybrid k=3,5,8,10 threshold=0.0,0.5,0.65,0.75
  embeddings: 50 call(s) for 50 distinct question(s), median 271 ms
  verdict   : ACCEPTED

  Latency below is ANN/FTS search plus slide enrichment. It EXCLUDES the
  query-embedding round trip, which is precomputed once per distinct
  question and served from memory for every cell — embedding cost is
  constant across configurations, so including it would only add noise
  to the comparison. The embedding latency is reported on the line above.
-->
<!-- Regime comparison. Both regimes scored on the SAME 27 of 50 questions — the ones every regime could run. The regimes still search different spaces (one lecture vs a whole course), so a lower hybrid score is partly a harder task. -->

| Regime | k | Thr | n | Slide found | Anchor found | MRR | P@k | Latency (ms) | Refusal | False refusal | Err | Skip |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| course_hybrid | 10 | 0.00 | 27 | 1.000 | 1.000 | 0.865 | 0.100 | 832 | 0.000 | 0.000 | 0 | 0 |
| course_hybrid | 10 | 0.50 | 27 | 1.000 | 1.000 | 0.865 | 0.100 | 829 | 0.000 | 0.000 | 0 | 0 |
| course_hybrid | 10 | 0.65 | 27 | 1.000 | 1.000 | 0.865 | 0.100 | 835 | 0.000 | 0.000 | 0 | 0 |
| course_hybrid | 8 | 0.00 | 27 | 0.963 | 1.000 | 0.861 | 0.120 | 702 | 0.000 | 0.000 | 0 | 0 |
| course_hybrid | 8 | 0.50 | 27 | 0.963 | 1.000 | 0.861 | 0.120 | 694 | 0.000 | 0.000 | 0 | 0 |
| course_hybrid | 8 | 0.65 | 27 | 0.963 | 1.000 | 0.861 | 0.120 | 689 | 0.000 | 0.000 | 0 | 0 |
| course_hybrid | 5 | 0.00 | 27 | 0.926 | 1.000 | 0.855 | 0.185 | 509 | 0.000 | 0.000 | 0 | 0 |
| course_hybrid | 5 | 0.50 | 27 | 0.926 | 1.000 | 0.855 | 0.185 | 500 | 0.000 | 0.000 | 0 | 0 |
| course_hybrid | 5 | 0.65 | 27 | 0.926 | 1.000 | 0.855 | 0.185 | 491 | 0.000 | 0.000 | 0 | 0 |
| course_hybrid | 3 | 0.00 | 27 | 0.889 | 0.963 | 0.846 | 0.296 | 401 | 0.000 | 0.000 | 0 | 0 |
| course_hybrid | 3 | 0.50 | 27 | 0.889 | 0.963 | 0.846 | 0.296 | 377 | 0.000 | 0.000 | 0 | 0 |
| course_hybrid | 3 | 0.65 | 27 | 0.889 | 0.963 | 0.846 | 0.296 | 356 | 0.000 | 0.000 | 0 | 0 |
| lecture_dense | 10 | 0.00 | 27 | 0.667 | 0.667 | 0.557 | 0.067 | 651 | 0.333 | 0.000 | 0 | 0 |
| lecture_dense | 10 | 0.50 | 27 | 0.667 | 0.667 | 0.557 | 0.067 | 652 | 0.333 | 0.000 | 0 | 0 |
| lecture_dense | 10 | 0.65 | 27 | 0.667 | 0.667 | 0.557 | 0.067 | 422 | 0.333 | 0.000 | 0 | 0 |
| lecture_dense | 5 | 0.00 | 27 | 0.630 | 0.667 | 0.554 | 0.126 | 348 | 0.333 | 0.000 | 0 | 0 |
| lecture_dense | 5 | 0.50 | 27 | 0.630 | 0.667 | 0.554 | 0.126 | 345 | 0.333 | 0.000 | 0 | 0 |
| lecture_dense | 5 | 0.65 | 27 | 0.630 | 0.667 | 0.554 | 0.126 | 388 | 0.333 | 0.000 | 0 | 0 |
| lecture_dense | 8 | 0.00 | 27 | 0.630 | 0.667 | 0.554 | 0.079 | 641 | 0.333 | 0.000 | 0 | 0 |
| lecture_dense | 8 | 0.50 | 27 | 0.630 | 0.667 | 0.554 | 0.079 | 620 | 0.333 | 0.000 | 0 | 0 |
| lecture_dense | 8 | 0.65 | 27 | 0.630 | 0.667 | 0.554 | 0.079 | 491 | 0.333 | 0.000 | 0 | 0 |
| lecture_dense | 3 | 0.00 | 27 | 0.556 | 0.630 | 0.537 | 0.185 | 241 | 0.333 | 0.000 | 0 | 0 |
| lecture_dense | 3 | 0.50 | 27 | 0.556 | 0.630 | 0.537 | 0.185 | 231 | 0.333 | 0.000 | 0 | 0 |
| lecture_dense | 3 | 0.65 | 27 | 0.556 | 0.630 | 0.537 | 0.185 | 231 | 0.333 | 0.000 | 0 | 0 |
| course_hybrid | 3 | 0.75 | 27 | 0.481 | 0.481 | 0.438 | 0.160 | 225 | 0.481 | 0.000 | 0 | 0 |
| course_hybrid | 5 | 0.75 | 27 | 0.481 | 0.481 | 0.438 | 0.096 | 237 | 0.481 | 0.000 | 0 | 0 |
| course_hybrid | 8 | 0.75 | 27 | 0.481 | 0.481 | 0.438 | 0.060 | 245 | 0.481 | 0.000 | 0 | 0 |
| course_hybrid | 10 | 0.75 | 27 | 0.481 | 0.481 | 0.438 | 0.048 | 235 | 0.481 | 0.000 | 0 | 0 |
| lecture_dense | 3 | 0.75 | 27 | 0.296 | 0.296 | 0.278 | 0.099 | 64 | 0.704 | 0.000 | 0 | 0 |
| lecture_dense | 5 | 0.75 | 27 | 0.296 | 0.296 | 0.278 | 0.059 | 76 | 0.704 | 0.000 | 0 | 0 |
| lecture_dense | 8 | 0.75 | 27 | 0.296 | 0.296 | 0.278 | 0.037 | 63 | 0.704 | 0.000 | 0 | 0 |
| lecture_dense | 10 | 0.75 | 27 | 0.296 | 0.296 | 0.278 | 0.030 | 66 | 0.704 | 0.000 | 0 | 0 |
