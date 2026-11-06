# Re-pin to dfc20df6: re-check list

*Written 2026-11-06. The thesis pin moved from `2b8b1f7b` (2026-11-02) to `dfc20df6` (2026-11-06, the #178 merge). Use it as the work list for re-verifying the thesis at the new pin.*

## Code freeze

`dfc20df6` is the **final pin**. The thesis describes the code at this commit. Code merged after it is not described, and no further re-pin is planned before submission (2026-11-20). A later fix that matters can be mentioned as future work. Do not move the pin again.

Macros (`thesis/metadata.tex`):
- `\thesisCommit`: `dfc20df6`, the code the thesis describes.
- `\thesisPreviousCommit`: `2b8b1f7b`, the pin before. Use it where text states something a fix from #173 to #179 changed.
- `\thesisEarlierCommit`: `0be0081`, the August audit, for older found-then-fixed history.

## What changed between the pins, and where it lands

| PR | Change | Thesis impact |
|---|---|---|
| #172 | Owner's door in the landing lab (DEV only), Plans 3 and 4 | none (dev lab) |
| #173 | An owner can ask in their own Space without joining it | ch5 tutor scope: already written as found-then-fixed |
| #174 | PyMuPDF table search runs under a lock | ch5 tech stack: already written as found-then-fixed |
| #175 | Analytics floor: patterns across at least five people, never by name; people views removed | ch5 analytics/privacy; F4 cites `v4_landing.py` |
| #176 | Per-lecture analytics answer professors only | ch5 trust boundaries: the open finding at `\thesisPreviousCommit` is now found-then-fixed |
| #177 | A rejected key (401) disables a provider; Oracle and staging compose files deleted; prod compose names Hetzner; comments match code | ch4: "unclassified auth errors" becomes found-then-fixed (403 deliberately not), the reproducibility paragraph (four compose files are now two), the arq comment; F6, F7, F11, F17 notes; appendix |
| #179 | Uploaded and learner text can no longer forge prompt markers (`untrusted.py`) | ch5 injection defences; F3, F12, F14; ledger 5.7/5.8 |
| #178 | One routing rule, `page_blocks.route_page`: no text / figure / text | ch4 routing subsection rewrite (the 25-character rule becomes found-then-fixed); F8; appendix row for the threshold; the routing study as evaluation material |

## Status (2026-11-06)

Done and committed on the thesis branch:
- Chapter 4: routing (#178), 401 handling (#177), compose files, honest comments, pin macros, F11 caption.
- Appendix A: all 53 rows re-read (the routing row became three rows; eight rows moved lines); CONSTANTS.md has a dfc20df6 section.
- Chapter 5 briefs: the analytics finding found-then-fixed (#175, #176), the injection defences (#179), the tutor docstring and retrieval cite (#177), about 25 line moves.
- Chapter 6: the F17 caption has twelve flags.
- Figures: F1, F8 (routing), F11 (401), F17 (12 flags, 8 with a UI side), F16 (printed tutor range); F3 and F12 labels (#179); every header and MANIFEST row moved to dfc20df6.

Still open:
- [ ] The retrieval grid re-run (below).
- [ ] The ledger "@main" column (below).
- [ ] The chapter 6 briefs, written against 0be0081 and never re-verified (separate pass).

## Also re-run at the new pin

- [ ] `python -m backend.eval.retrieval_grid` (F19; its course column predates `b66a97c6`)
- [ ] Appendix A: every row (`config.py`, `arq_worker.py`, `orchestrator.py`, `retrieval.py`, `tutor.py`, `unified_orchestrator.py` changed)
- [ ] `docs/thesis/evidence/CLAIMS_LEDGER.md`: refresh its "@main" column once, at `dfc20df6`

## Cited files that changed, by thesis file

Generated from every `file.ext` reference in the chapters, figure sources, MANIFEST, CONSTANTS and the ledger that names a file changed between the pins. A file listed here does not mean the claim is wrong; it means the claim and its line number must be re-read.

28 cited files changed between 2b8b1f7b and dfc20df6, cited from 20 thesis files.

### `thesis/chapters/04-design.tex`

- [ ] `backend/services/ai/orchestrator.py`: cited on line 42
- [ ] `backend/services/parser/unified_orchestrator.py`: cited on line 152
- [ ] `docker-compose.prod.yml`: cited on line 106

### `thesis/chapters/05-implementation.tex`

- [ ] `backend/api/v1/analytics.py`: cited on line 299
- [ ] `backend/api/v1/upload.py`: cited on line 144
- [ ] `backend/services/ai/prompts.py`: cited on lines 153, 173, 179
- [ ] `backend/services/ai/retrieval.py`: cited on lines 75, 89, 93, 96
- [ ] `backend/services/ai/tutor.py`: cited on lines 97, 98, 117, 119, 123, 128, 155
- [ ] `backend/services/ai/tutor_service.py`: cited on line 253
- [ ] `backend/services/analytics_service.py`: cited on line 301
- [ ] `backend/services/luna/prompts.py`: cited on lines 157, 208
- [ ] `backend/services/parser/synthesis.py`: cited on lines 180, 183, 187, 192, 198
- [ ] `backend/services/parser/unified_orchestrator.py`: cited on lines 50, 174, 224
- [ ] `backend/services/v4_reader_service.py`: cited on lines 134, 160
- [ ] `backend/services/v4_rehearsal_service.py`: cited on lines 215, 219
- [ ] `backend/services/v4_spaces_service.py`: cited on lines 109, 145, 259
- [ ] `backend/services/v4_teachback_service.py`: cited on line 217
- [ ] `backend/tests/unit/test_v4_ask.py`: cited on line 113
- [ ] `docker-compose.prod.yml`: cited on line 25

### `thesis/chapters/06-evaluation.tex`

- [ ] `backend/services/ai/retrieval.py`: cited on line 41

### `thesis/chapters/appendix-a-constants.tex`

- [ ] `backend/api/v1/ai_content.py`: cited on line 82
- [ ] `backend/core/config.py`: cited on lines 9, 40, 43, 44, 45, 46, 60, 70, 71
- [ ] `backend/services/ai/orchestrator.py`: cited on lines 10, 61, 62, 66
- [ ] `backend/services/ai/prompts.py`: cited on line 63
- [ ] `backend/services/ai/retrieval.py`: cited on lines 10, 75, 76, 77, 78, 79
- [ ] `backend/services/ai/tutor.py`: cited on lines 11, 80, 81
- [ ] `backend/services/parser/synthesis.py`: cited on line 63
- [ ] `backend/services/parser/unified_orchestrator.py`: cited on lines 11, 56, 59
- [ ] `backend/workers/arq_worker.py`: cited on lines 10, 48, 49, 50, 53, 54, 55

### `thesis/figures/MANIFEST.md`

- [ ] `backend/api/v1/upload.py`: cited on lines 46, 49
- [ ] `backend/api/v1/v4_landing.py`: cited on line 42
- [ ] `backend/core/config.py`: cited on line 56
- [ ] `backend/main.py`: cited on lines 44, 56
- [ ] `backend/services/ai/orchestrator.py`: cited on lines 39, 44, 50
- [ ] `backend/services/ai/prompts.py`: cited on line 51
- [ ] `backend/services/ai/retrieval.py`: cited on lines 41, 51, 58
- [ ] `backend/services/ai/tutor.py`: cited on lines 41, 51, 55
- [ ] `backend/services/ai/vision.py`: cited on line 50
- [ ] `backend/services/analytics_service.py`: cited on line 53
- [ ] `backend/services/luna/prompts.py`: cited on line 51
- [ ] `backend/services/parser/synthesis.py`: cited on lines 39, 46
- [ ] `backend/services/parser/unified_orchestrator.py`: cited on lines 39, 46, 49
- [ ] `backend/services/v4_landing_service.py`: cited on line 42
- [ ] `backend/services/v4_reader_service.py`: cited on lines 41, 43, 55
- [ ] `backend/services/v4_spaces_service.py`: cited on lines 39, 41, 43, 46, 47, 51, 55, 56
- [ ] `backend/workers/arq_worker.py`: cited on lines 44, 49
- [ ] `docker-compose.prod.yml`: cited on lines 44, 45, 56

### `thesis/figures/src/f1-transformation.puml`

- [ ] `backend/services/ai/orchestrator.py`: cited on line 9
- [ ] `backend/services/parser/synthesis.py`: cited on line 9
- [ ] `backend/services/parser/unified_orchestrator.py`: cited on lines 7, 10
- [ ] `backend/services/v4_rehearsal_service.py`: cited on line 13
- [ ] `backend/services/v4_spaces_service.py`: cited on line 14

### `thesis/figures/src/f10-idempotency.puml`

- [ ] `backend/api/v1/upload.py`: cited on lines 12, 14
- [ ] `backend/services/parser/unified_orchestrator.py`: cited on lines 15, 16
- [ ] `backend/workers/arq_worker.py`: cited on line 19

### `thesis/figures/src/f11-provider-chain.puml`

- [ ] `backend/services/ai/orchestrator.py`: cited on line 6
- [ ] `backend/services/ai/vision.py`: cited on line 8

### `thesis/figures/src/f12-tutor-sequence.puml`

- [ ] `backend/services/ai/prompts.py`: cited on line 14
- [ ] `backend/services/ai/retrieval.py`: cited on line 10
- [ ] `backend/services/ai/tutor.py`: cited on line 12
- [ ] `backend/services/v4_spaces_service.py`: cited on line 8

### `thesis/figures/src/f16-citation-gap.puml`

- [ ] `backend/services/ai/tutor.py`: cited on lines 7, 25
- [ ] `backend/services/v4_reader_service.py`: cited on line 10
- [ ] `backend/services/v4_spaces_service.py`: cited on line 8

### `thesis/figures/src/f17-flag-reality.puml`

- [ ] `backend/core/config.py`: cited on line 7
- [ ] `backend/main.py`: cited on line 9
- [ ] `backend/services/v4_spaces_service.py`: cited on line 10
- [ ] `docker-compose.prod.yml`: cited on line 8

### `thesis/figures/src/f18-evaluation-setup.puml`

- [ ] `backend/eval/deck_lab.py`: cited on line 13

### `thesis/figures/src/f19-results.puml`

- [ ] `backend/services/ai/retrieval.py`: cited on line 11

### `thesis/figures/src/f3-grounded-vs-ungrounded.puml`

- [ ] `backend/services/ai/retrieval.py`: cited on lines 14, 16
- [ ] `backend/services/ai/tutor.py`: cited on lines 13, 16
- [ ] `backend/services/luna/prompts.py`: cited on line 11
- [ ] `backend/services/v4_reader_service.py`: cited on line 8
- [ ] `backend/services/v4_spaces_service.py`: cited on line 13

### `thesis/figures/src/f4-use-case.puml`

- [ ] `backend/api/v1/v4_landing.py`: cited on line 12

### `thesis/figures/src/f6-components.puml`

- [ ] `backend/main.py`: cited on line 7
- [ ] `backend/services/ai/orchestrator.py`: cited on line 9
- [ ] `backend/workers/arq_worker.py`: cited on line 8
- [ ] `docker-compose.prod.yml`: cited on line 6

### `thesis/figures/src/f7-deployment.puml`

- [ ] `docker-compose.prod.yml`: cited on line 6

### `thesis/figures/src/f8-pipeline.puml`

- [ ] `backend/api/v1/upload.py`: cited on line 7
- [ ] `backend/services/parser/unified_orchestrator.py`: cited on line 9
- [ ] `backend/services/v4_spaces_service.py`: cited on line 9

### `docs/thesis/evidence/CONSTANTS.md`

- [ ] `backend/api/v1/ai_content.py`: cited on lines 52, 148, 227
- [ ] `backend/core/config.py`: cited on lines 28, 30, 31, 32, 40, 53, 58, 66, 79, 80, 106, 109, 110, 111, 112, 126, 136, 137, 172, 189, 192, 193, 194, 195, 207, 216, 217, 249
- [ ] `backend/services/ai/orchestrator.py`: cited on lines 34, 75, 78, 127, 128, 132, 207, 208, 209, 212
- [ ] `backend/services/ai/prompts.py`: cited on lines 83, 84, 129, 210, 211, 255, 259
- [ ] `backend/services/ai/retrieval.py`: cited on lines 37, 38, 48, 49, 82, 141, 142, 143, 144, 145, 220, 221, 222, 223, 224
- [ ] `backend/services/ai/tutor.py`: cited on lines 39, 50, 51, 52, 146, 147, 225, 226, 227, 250
- [ ] `backend/services/ai/vision.py`: cited on line 207
- [ ] `backend/services/luna/prompts.py`: cited on lines 84, 129, 210
- [ ] `backend/services/parser/synthesis.py`: cited on line 259
- [ ] `backend/services/parser/unified_orchestrator.py`: cited on lines 20, 35, 47, 122, 125, 204, 206, 257, 258
- [ ] `backend/workers/arq_worker.py`: cited on lines 31, 33, 69, 70, 71, 72, 73, 114, 115, 116, 119, 120, 121, 194, 196, 197, 198, 201, 202, 203
- [ ] `docker-compose.prod.yml`: cited on lines 8, 182

### `docs/thesis/evidence/CLAIMS_LEDGER.md`

- [ ] `backend/api/v1/ai_content.py`: cited on line 180
- [ ] `backend/api/v1/analytics.py`: cited on line 290
- [ ] `backend/api/v1/upload.py`: cited on lines 93, 106, 112, 131, 135, 181
- [ ] `backend/core/config.py`: cited on lines 108, 112, 204, 223
- [ ] `backend/main.py`: cited on lines 121, 202, 204, 233, 235
- [ ] `backend/services/ai/orchestrator.py`: cited on lines 111, 120, 156, 159, 173, 224
- [ ] `backend/services/ai/prompts.py`: cited on lines 169, 172, 173, 174, 270, 271, 272
- [ ] `backend/services/ai/retrieval.py`: cited on lines 165, 166, 167, 168, 195, 264, 265, 266, 267
- [ ] `backend/services/ai/tutor.py`: cited on lines 107, 168, 169, 170, 172, 206, 221, 266, 267, 268, 270
- [ ] `backend/services/ai/tutor_service.py`: cited on lines 180, 278
- [ ] `backend/services/analytics_rollup.py`: cited on line 220
- [ ] `backend/services/analytics_service.py`: cited on line 290
- [ ] `backend/services/luna/prompts.py`: cited on lines 169, 172, 173, 174, 270
- [ ] `backend/services/parser/synthesis.py`: cited on lines 271, 287
- [ ] `backend/services/parser/unified_orchestrator.py`: cited on lines 132, 133, 135, 137, 138, 204, 216, 217, 244, 271, 273, 292
- [ ] `backend/services/v4_reader_service.py`: cited on line 270
- [ ] `backend/services/v4_rehearsal_service.py`: cited on line 288
- [ ] `backend/services/v4_spaces_service.py`: cited on lines 267, 269, 289, 291
- [ ] `backend/services/v4_teachback_service.py`: cited on line 288
- [ ] `backend/tests/unit/test_v4_ask.py`: cited on line 289
- [ ] `backend/workers/arq_worker.py`: cited on lines 132, 138, 139, 140, 220
- [ ] `docker-compose.oracle.yml`: cited on line 122
- [ ] `docker-compose.prod.yml`: cited on lines 111, 120, 122, 124, 125, 203, 222
- [ ] `docker-compose.staging.yml`: cited on lines 122, 123

