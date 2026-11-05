<!--
  generated : 2026-09-17 21:45:28Z
  commit    : a696be1-dirty
  golden set: backend/eval/data/golden_set.json (50 questions, 50 distinct)
  grid      : regimes=lecture_dense,course_hybrid k=3,5,6,8,10 threshold=0.65
  embeddings: 50 call(s) for 50 distinct question(s), median 257 ms
  verdict   : ACCEPTED

  Latency below is ANN/FTS search plus slide enrichment. It EXCLUDES the
  query-embedding round trip, which is precomputed once per distinct
  question and served from memory for every cell — embedding cost is
  constant across configurations, so including it would only add noise
  to the comparison. The embedding latency is reported on the line above.
-->
| Regime | k | Thr | n | Slide found | Anchor found | MRR | P@k | Latency (ms) | Refusal | False refusal | Err | Skip |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| course_hybrid | 10 | 0.65 | 27 | 1.000 | 1.000 | 0.862 | 0.100 | 778 | 0.000 | 0.000 | 0 | 23 |
| course_hybrid | 6 | 0.65 | 27 | 0.963 | 1.000 | 0.858 | 0.160 | 542 | 0.000 | 0.000 | 0 | 23 |
| course_hybrid | 8 | 0.65 | 27 | 0.963 | 1.000 | 0.858 | 0.120 | 653 | 0.000 | 0.000 | 0 | 23 |
| course_hybrid | 5 | 0.65 | 27 | 0.926 | 1.000 | 0.852 | 0.185 | 475 | 0.000 | 0.000 | 0 | 23 |
| course_hybrid | 3 | 0.65 | 27 | 0.852 | 0.963 | 0.833 | 0.284 | 378 | 0.000 | 0.000 | 0 | 23 |
| lecture_dense | 10 | 0.65 | 50 | 0.940 | 0.940 | 0.788 | 0.094 | 678 | 0.020 | 0.000 | 0 | 0 |
| lecture_dense | 5 | 0.65 | 50 | 0.920 | 0.940 | 0.786 | 0.184 | 332 | 0.020 | 0.000 | 0 | 0 |
| lecture_dense | 6 | 0.65 | 50 | 0.920 | 0.940 | 0.786 | 0.153 | 386 | 0.020 | 0.000 | 0 | 0 |
| lecture_dense | 8 | 0.65 | 50 | 0.920 | 0.940 | 0.786 | 0.115 | 511 | 0.020 | 0.000 | 0 | 0 |
| lecture_dense | 3 | 0.65 | 50 | 0.840 | 0.900 | 0.767 | 0.280 | 229 | 0.020 | 0.000 | 0 | 0 |
