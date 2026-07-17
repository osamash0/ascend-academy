# Backend Test-Coverage WORKLOG

Goal: raise meaningful backend test coverage, focused on (1) upload material
pipeline, (2) course creation, (3) lecture quiz generation, (4) student
course create/edit/delete + quiz suggestion.

Verify command:
```
.venv/bin/python -m pytest backend/tests/unit backend/tests/integration backend/tests/contract -q
```

## Baseline (2026-07-17, branch feature/building-scene)

Full non-db suite: **880 passed, 8 failed** (pre-existing, outside target area):
- test_api_v1_structure::test_v1_docs_redirect (docs disabled in test env → 404)
- test_concept_map_endpoint::test_enrolled_student_can_see_concept_map (403)
- test_course_context_endpoints::test_enrolled_student_can_see_context (403)
- test_courses_admin_endpoints::test_create_course_student_forbidden
- test_courses_endpoints::test_student_course_detail_hides_unenrolled_lectures
- test_courses_prod::test_security_headers
- test_courses_prod::test_domain_error_handling
- test_study_guide_endpoint::test_enrolled_student_can_see_guide

These 8 fail on a clean tree (git status clean at session start); they are NOT
caused by this work and are treated as the baseline. They appear to be RLS /
enrollment-seeding gaps in the fake-Supabase test env.

Baseline coverage on target modules:
| Module | Cover |
|---|---|
| upload_service.py | 42% |
| file_parse_service.py | 63% |
| api/v1/upload.py | 73% |
| api/v1/courses.py | 67% |
| parser/synthesis.py | 59% |
| parser/persist.py | 53% |
| parser/repos.py | 21% |
| slide_synth_service.py | 21% |
| slide_classifier.py | 99% |
| quiz_validator.py | 94% |
| **TOTAL (target set)** | **66%** |

## Bugs found

### B1 — parse_json_response truncation-recovery is dead for real truncation
`backend/services/ai/orchestrator.py::parse_json_response` (~line 700-740).
The docstring promises that a truncated JSON **array** (LLM hit its output
token limit mid-object) is salvaged object-by-object. In practice it is NOT,
for the exact case it was written for:
- A genuinely truncated array like `[{"q":"one"},{"q":"two"},{"q":"thr` has no
  closing `]`.
- The extraction regex `(\{[\s\S]*\}|\[[\s\S]*\])` therefore can't match the
  `[...]` branch (needs a closing `]`); it falls back to the `{...}` branch and
  captures the inner `{"q":"one"},{"q":"two"}` span.
- The salvage loop is gated on `candidate.lstrip().startswith("[")`, so it
  never runs → returns `{}` and the whole batch of already-complete objects is
  lost.
Salvage only works when a `]` happens to be present (e.g. a malformed-but-
closed array `[{ok},{bad}]`). Impact: on a real token-limit truncation the
deck-quiz / slide batch returns empty instead of the completed slides — the
opposite of the intended graceful degradation.
NOT fixed (per goal guardrails). Pinned by
`test_json_parsing.py::test_truncated_array_without_closing_bracket_returns_empty_dict`.

Minor quirk (not filed as a bug, pinned by test): a NUL (0x00) byte outside a
JSON string is not stripped by `_sanitize_json_string` (guard is strict
`0x00 < ord(ch)`), so it breaks the parse; other C0 controls (0x01–0x1F) are
stripped.

---

## Modules covered

### 1. upload_service.py — 42% → 94% (2026-07-17)
New file `backend/tests/unit/test_upload_service.py` (37 tests). Covered:
- `read_upload_capped`: under-limit, over-limit raise, empty file.
- `validate_upload` (PDF): real 3-page PDF page count, non-PDF/PPTX rejection,
  corrupted PDF (-1 → "corrupted or password-protected"), zero-page branch,
  too-many-pages (MAX_PAGES monkeypatched), traversal-filename sanitization.
- `_validate_pptx`: real 2-slide count, bad magic bytes, too-short, corrupted
  zip (-1), zero slides, too-many-slides, size-limit exceeded.
- `queue_depth`: zcard read, error → 0.
- `upload_pdf_to_storage`: happy path, missing-bucket auto-create+retry,
  unexpected error swallowed (worker retries).
- `process_pdf_stream`: markitdown/llamaparse/mineru/opendataloader routing
  labels + odl_pages threading; course_id/visibility threading; production
  queue-outage refusal (no in-process parse, streams error); Arq enqueue +
  Redis pub/sub streaming (heartbeat ping, progress+complete, redis closed),
  early stop on error event.
- `extract_raw_pages`: pymupdf real extraction (char/word counts), alternate
  parsers with page sort, auto→ODL, auto ODL-fail→pymupdf fallback.
- `process_pdf_lazy`: streaming updates + error path.

Remaining uncovered (external/hard): real Arq pool creation (38-42), inner
bucket-create failure log (90-91), pubsub json-decode continue (297-298),
sync-fallback task-timeout branch (333-339). No source changes. No bugs found.

### 2. deterministic_extractor.py — 24% → 100% (2026-07-17)
New file `backend/tests/unit/test_deterministic_extractor.py` (20 tests).
Covered `_split_first_nonempty_line` (empty, peel, leading blanks, all-
whitespace), `_looks_like_title` (length/word/sentence rules incl. the
short-line-ending-in-period accept), `build_slide_from_layout` (title vs
placeholder, content truncation+ellipsis, metadata→SKIP route, manifest reason,
`_meta` block fields), and `build_slides_from_layouts` (sort, metadata flags,
empty input). Pure logic; no bugs found.

### 3. parser/synthesis.py — 59% → 80% (2026-07-17)
New file `backend/tests/unit/test_synthesis.py` (23 tests). LLM mocked at
`generate_text`/`generate_text_bulk`; `parse_json_response`/`with_voice` real.
Covered prompt assembly (first-15-slide cap, course-hint append only when
present, ≤10 quiz slides, ≤2 cross-lecture candidates), response handling
(parsed dict/list, non-dict→{}, non-list→[], garbage→{}/[]), `analyze_slide`
content-fallback chain, cross-lecture source tagging + drop-unknown-concept +
LLM-exception→[], and `_map_cross_lecture_quiz` answer resolution/drop. Rest
(`_map_deck_quiz`, 250-281) already covered by test_synthesis_quiz_mapping.py.
No bugs found. (Note: `_normalize_answer_index` treats any single-char answer
as a column letter A–Z, never as literal option text — expected, documented.)

### 4. ai/orchestrator.parse_json_response — dedicated coverage (2026-07-17)
New file `backend/tests/unit/test_json_parsing.py` (22 tests). The LLM-output
choke point. Covered dict/list passthrough, scalar coercion, plain object/array,
fenced (```json and bare ```), JSON embedded in prose (object + array),
truncation behavior (see BUG B1 — real truncation → {}, closed-but-malformed
array → salvage), total garbage/empty → {}, and `_sanitize_json_string`
defects (literal newline in string, lone backslash doubling, valid escapes,
bell strip, NUL quirk) plus Unicode preservation and `\uXXXX` decode.
Found BUG B1 (logged above).

