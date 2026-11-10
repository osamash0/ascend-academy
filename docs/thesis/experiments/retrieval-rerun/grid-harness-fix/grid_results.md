<!--
  generated : 2026-11-10 14:59:18Z
  commit    : 07943e6a-dirty
  golden set: backend/eval/data/golden_set.json (50 questions, 50 distinct)
  grid      : regimes=lecture_dense k=3,5,8,10 threshold=0.0,0.5,0.65,0.75
  file hash  : 6 of 6 lecture(s) searched by id and file hash (lecture_dense only)
  embeddings: 50 call(s) for 50 distinct question(s), median 408 ms
  verdict   : ACCEPTED

  Latency below is ANN/FTS search plus slide enrichment. It EXCLUDES the
  query-embedding round trip, which is precomputed once per distinct
  question and served from memory for every cell — embedding cost is
  constant across configurations, so including it would only add noise
  to the comparison. The embedding latency is reported on the line above.
-->
| Regime | k | Thr | n | Slide found | Anchor found | MRR | P@k | Latency (ms) | Refusal | False refusal | Err | Skip |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| lecture_dense | 10 | 0.00 | 50 | 0.960 | 0.960 | 0.809 | 0.096 | 747 | 0.000 | 0.000 | 0 | 0 |
| lecture_dense | 10 | 0.50 | 50 | 0.960 | 0.960 | 0.809 | 0.096 | 750 | 0.000 | 0.000 | 0 | 0 |
| lecture_dense | 5 | 0.00 | 50 | 0.940 | 0.960 | 0.807 | 0.188 | 405 | 0.000 | 0.000 | 0 | 0 |
| lecture_dense | 5 | 0.50 | 50 | 0.940 | 0.960 | 0.807 | 0.188 | 437 | 0.000 | 0.000 | 0 | 0 |
| lecture_dense | 8 | 0.00 | 50 | 0.940 | 0.960 | 0.807 | 0.117 | 601 | 0.000 | 0.000 | 0 | 0 |
| lecture_dense | 8 | 0.50 | 50 | 0.940 | 0.960 | 0.807 | 0.117 | 597 | 0.000 | 0.000 | 0 | 0 |
| lecture_dense | 3 | 0.00 | 50 | 0.880 | 0.920 | 0.793 | 0.293 | 283 | 0.000 | 0.000 | 0 | 0 |
| lecture_dense | 3 | 0.50 | 50 | 0.880 | 0.920 | 0.793 | 0.293 | 259 | 0.000 | 0.000 | 0 | 0 |
| lecture_dense | 10 | 0.65 | 50 | 0.940 | 0.940 | 0.789 | 0.094 | 683 | 0.020 | 0.000 | 0 | 0 |
| lecture_dense | 5 | 0.65 | 50 | 0.920 | 0.940 | 0.787 | 0.184 | 378 | 0.020 | 0.000 | 0 | 0 |
| lecture_dense | 8 | 0.65 | 50 | 0.920 | 0.940 | 0.787 | 0.115 | 560 | 0.020 | 0.000 | 0 | 0 |
| lecture_dense | 3 | 0.65 | 50 | 0.860 | 0.900 | 0.773 | 0.287 | 255 | 0.020 | 0.000 | 0 | 0 |
| lecture_dense | 3 | 0.75 | 50 | 0.420 | 0.420 | 0.377 | 0.140 | 85 | 0.540 | 0.000 | 0 | 0 |
| lecture_dense | 5 | 0.75 | 50 | 0.420 | 0.420 | 0.377 | 0.084 | 78 | 0.540 | 0.000 | 0 | 0 |
| lecture_dense | 8 | 0.75 | 50 | 0.420 | 0.420 | 0.377 | 0.052 | 86 | 0.540 | 0.000 | 0 | 0 |
| lecture_dense | 10 | 0.75 | 50 | 0.420 | 0.420 | 0.377 | 0.042 | 90 | 0.540 | 0.000 | 0 | 0 |
