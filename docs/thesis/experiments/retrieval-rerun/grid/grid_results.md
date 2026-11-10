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
| Regime | k | Thr | n | Slide found | Anchor found | MRR | P@k | Latency (ms) | Refusal | False refusal | Err | Skip |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| course_hybrid | 10 | 0.00 | 27 | 1.000 | 1.000 | 0.865 | 0.100 | 832 | 0.000 | 0.000 | 0 | 23 |
| course_hybrid | 10 | 0.50 | 27 | 1.000 | 1.000 | 0.865 | 0.100 | 829 | 0.000 | 0.000 | 0 | 23 |
| course_hybrid | 10 | 0.65 | 27 | 1.000 | 1.000 | 0.865 | 0.100 | 835 | 0.000 | 0.000 | 0 | 23 |
| course_hybrid | 8 | 0.00 | 27 | 0.963 | 1.000 | 0.861 | 0.120 | 702 | 0.000 | 0.000 | 0 | 23 |
| course_hybrid | 8 | 0.50 | 27 | 0.963 | 1.000 | 0.861 | 0.120 | 694 | 0.000 | 0.000 | 0 | 23 |
| course_hybrid | 8 | 0.65 | 27 | 0.963 | 1.000 | 0.861 | 0.120 | 689 | 0.000 | 0.000 | 0 | 23 |
| course_hybrid | 5 | 0.00 | 27 | 0.926 | 1.000 | 0.855 | 0.185 | 509 | 0.000 | 0.000 | 0 | 23 |
| course_hybrid | 5 | 0.50 | 27 | 0.926 | 1.000 | 0.855 | 0.185 | 500 | 0.000 | 0.000 | 0 | 23 |
| course_hybrid | 5 | 0.65 | 27 | 0.926 | 1.000 | 0.855 | 0.185 | 491 | 0.000 | 0.000 | 0 | 23 |
| course_hybrid | 3 | 0.00 | 27 | 0.889 | 0.963 | 0.846 | 0.296 | 401 | 0.000 | 0.000 | 0 | 23 |
| course_hybrid | 3 | 0.50 | 27 | 0.889 | 0.963 | 0.846 | 0.296 | 377 | 0.000 | 0.000 | 0 | 23 |
| course_hybrid | 3 | 0.65 | 27 | 0.889 | 0.963 | 0.846 | 0.296 | 356 | 0.000 | 0.000 | 0 | 23 |
| lecture_dense | 10 | 0.00 | 50 | 0.780 | 0.780 | 0.643 | 0.078 | 656 | 0.180 | 0.000 | 0 | 0 |
| lecture_dense | 10 | 0.50 | 50 | 0.780 | 0.780 | 0.643 | 0.078 | 665 | 0.180 | 0.000 | 0 | 0 |
| lecture_dense | 5 | 0.00 | 50 | 0.760 | 0.780 | 0.641 | 0.152 | 358 | 0.180 | 0.000 | 0 | 0 |
| lecture_dense | 5 | 0.50 | 50 | 0.760 | 0.780 | 0.641 | 0.152 | 363 | 0.180 | 0.000 | 0 | 0 |
| lecture_dense | 8 | 0.00 | 50 | 0.760 | 0.780 | 0.641 | 0.095 | 642 | 0.180 | 0.000 | 0 | 0 |
| lecture_dense | 8 | 0.50 | 50 | 0.760 | 0.780 | 0.641 | 0.095 | 619 | 0.180 | 0.000 | 0 | 0 |
| lecture_dense | 3 | 0.00 | 50 | 0.700 | 0.740 | 0.627 | 0.233 | 248 | 0.180 | 0.000 | 0 | 0 |
| lecture_dense | 3 | 0.50 | 50 | 0.700 | 0.740 | 0.627 | 0.233 | 233 | 0.180 | 0.000 | 0 | 0 |
| lecture_dense | 10 | 0.65 | 50 | 0.760 | 0.760 | 0.623 | 0.076 | 403 | 0.200 | 0.000 | 0 | 0 |
| lecture_dense | 5 | 0.65 | 50 | 0.740 | 0.760 | 0.621 | 0.148 | 388 | 0.200 | 0.000 | 0 | 0 |
| lecture_dense | 8 | 0.65 | 50 | 0.740 | 0.760 | 0.621 | 0.092 | 450 | 0.200 | 0.000 | 0 | 0 |
| lecture_dense | 3 | 0.65 | 50 | 0.680 | 0.720 | 0.607 | 0.227 | 231 | 0.200 | 0.000 | 0 | 0 |
| course_hybrid | 3 | 0.75 | 27 | 0.481 | 0.481 | 0.438 | 0.160 | 225 | 0.481 | 0.000 | 0 | 23 |
| course_hybrid | 5 | 0.75 | 27 | 0.481 | 0.481 | 0.438 | 0.096 | 237 | 0.481 | 0.000 | 0 | 23 |
| course_hybrid | 8 | 0.75 | 27 | 0.481 | 0.481 | 0.438 | 0.060 | 245 | 0.481 | 0.000 | 0 | 23 |
| course_hybrid | 10 | 0.75 | 27 | 0.481 | 0.481 | 0.438 | 0.048 | 235 | 0.481 | 0.000 | 0 | 23 |
| lecture_dense | 3 | 0.75 | 50 | 0.320 | 0.320 | 0.290 | 0.107 | 71 | 0.640 | 0.000 | 0 | 0 |
| lecture_dense | 5 | 0.75 | 50 | 0.320 | 0.320 | 0.290 | 0.064 | 78 | 0.640 | 0.000 | 0 | 0 |
| lecture_dense | 8 | 0.75 | 50 | 0.320 | 0.320 | 0.290 | 0.040 | 69 | 0.640 | 0.000 | 0 | 0 |
| lecture_dense | 10 | 0.75 | 50 | 0.320 | 0.320 | 0.290 | 0.032 | 70 | 0.640 | 0.000 | 0 | 0 |
