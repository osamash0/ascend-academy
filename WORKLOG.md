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
(none yet)

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

