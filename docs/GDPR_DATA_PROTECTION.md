# GDPR / EU data-protection posture (S-2)

Status doc for `docs/ROADMAP_10X_FOUNDATION.md` §14, item **S-2**. Covers the
two hard findings from that section: (1) cross-border transfer to US LLM
sub-processors, and (2) right-to-erasure / portability. Read alongside
`docs/threat_model.md`.

Hosting is EU (Hetzner, Germany) — that is a real point in our favor and is
preserved by everything below.

## 1. Sub-processor list & lawful transfer basis

Every third party that receives student-uploaded PDF *content*, tutor
*questions*, or account PII, with the lawful basis for the resulting
non-EU transfer. "Content reaches provider" means raw slide text, OCR'd
images, or free-text tutor questions are sent in the request payload — not
just metadata.

| Sub-processor | Data received | Region | Transfer basis | Notes |
|---|---|---|---|---|
| **Groq** (`GROQ_API_KEY`) | Slide text/content, tutor questions | US | SCCs (2021/914, Groq's standard DPA terms) | Default vision/content model provider (`VISION_MODEL`, parser fallback). |
| **Google (Gemini/`GOOGLE_API_KEY`/`GEMINI_API_KEY`)** | Slide text/content, tutor questions, vision (image slides) | US (Google Cloud, no EU-only guarantee on the consumer Gemini API tier used here) | SCCs, Google Cloud DPA | `VISION_MODEL` default; also `fast_upload_model` (legacy, archived). |
| **Cerebras** (`CEREBRAS_API_KEY`, via LiteLLM gateway) | Slide text/content | US | SCCs (Cerebras standard DPA) | Default `PARSER_LLM_MODEL=cerebras` — the primary bulk-parse path for every uploaded lecture. |
| **OpenAI** (`OPENAI_API_KEY` / `OPENAI_BASE_URL`) | Slide text/content, tutor questions | US, *unless* `OPENAI_BASE_URL` is pointed at a self-hosted / university-hosted OpenAI-compatible endpoint | SCCs when using api.openai.com; **no transfer** when self-hosted | Deployment note below — this is the intended mitigation path. |
| **LlamaParse / LlamaCloud** (`LLAMA_CLOUD_API_KEY`) | Raw PDF content (parsing) | US | SCCs (LlamaIndex DPA) | Optional parser path (`llamaparse_service.py`); not the default pipeline. |
| **Resend** (`RESEND_API_KEY`) | Email address + feedback-form free text | US (Resend is US-based; EU sending region available but not currently pinned) | SCCs | Transactional/feedback email only — no lecture content. |
| **Sentry** (`SENTRY_DSN`) | Error stack traces, request metadata; **not** lecture content by design (no payload bodies logged into Sentry breadcrumbs) | Configurable (EU or US Sentry org region) | SCCs if US-hosted org | Verify the Sentry org region is set to EU (`SENTRY_ORG`/project settings) — operational action, not code. |

**Deployment mitigation already available, not yet defaulted:** the
`parser_llm_model` / `OPENAI_BASE_URL` seam (`backend/core/config.py`) exists
specifically so a university deployment can point bulk parsing at a
self-hosted or EU-region OpenAI-compatible endpoint instead of Cerebras/
Google/Groq, eliminating the transfer for that path entirely. **This is the
recommended production posture for sensitive/exam content** and should be
the default before onboarding a university whose DPA prohibits US transfer.
Tracked as follow-up (not done in this slice — genuinely a deployment/infra
decision, not a code change): flip the default `PARSER_LLM_MODEL` and
`VISION_MODEL` to an EU/self-hosted endpoint per-deployment, and formalize
signed DPAs with Groq/Google/Cerebras/OpenAI/LlamaIndex/Resend (a legal/
business step, out of scope for an engineering PR).

## 2. Data inventory (what PII lives where)

Enumerated in `backend/services/account_service.py::EXPORT_TABLES` /
`LECTURE_OWNER_COLUMNS` — that list is the single source of truth (both
export and this doc read from it, so they cannot drift silently). As of this
writing: `profiles`, `achievements`, `student_progress`, `learning_events`,
`xp_events`, `notifications`, `user_feedback`, `course_enrollments`,
`course_visits`, `lecture_visits`, `nudge_dismissals`,
`schedule_item_completions`, `upload_quotas`, `review_schedule`,
`review_log`, `exam_attempts`, `practice_attempts`,
`student_catalog_courses`, `friend_requests`, `user_roles`, plus
`lectures` (professor- or student-owned) and derived `slides`/
`quiz_questions`/`slide_embeddings`/`worksheets` reachable through them.

## 3. Right to erasure (Art. 17)

`POST /api/auth/delete-account` (`backend/api/v1/auth.py`):

1. Invalidates the caller's cached bearer token immediately (no replay
   within the 45s token-cache TTL).
2. Calls `account_service.erase_user_storage_and_derived_data(uid)` —
   deletes Storage-bucket objects (`pdf-uploads`, `worksheets`) and any
   `slide_embeddings` rows for lectures the user owns. This step is
   idempotent and safe to retry; it does not touch `auth.users`.
3. Deletes the `auth.users` row via the service-role admin API. Every table
   in §2 references `auth.users(id) ON DELETE CASCADE` (directly, or
   transitively via `lectures.professor_id`/`lectures.student_owner_id`), so
   Postgres removes the remaining rows as a single guaranteed operation —
   this is the part that is NOT reimplemented in application code, by
   design (a DB-level guarantee is stronger than an app-level sweep that can
   miss a table).

Two known exceptions, both intentional (see the module docstring in
`account_service.py` for full rationale):
- `worksheets` rows where the user is only `uploaded_by` (not the owning
  professor) use `ON DELETE SET NULL`, not CASCADE — a TA/co-uploader
  deleting their account must not delete a professor's live course
  material out from under enrolled students.
- Content-addressed `pdf-uploads` blobs are only removed when no other
  user's lecture still references the same `pdf_hash` (dedup safety).

Regression coverage: `backend/tests/db/test_account_erasure_cascade.py`
(real local Postgres, not mocked) proves the FK-cascade path end-to-end —
profile, achievements, learning_events, exam_attempts, review_schedule,
lectures, slides, quiz_questions, and (post-migration-parity)
`slide_embeddings` are all gone after the `auth.users` delete. Storage/
service-layer behavior (dedup retention, non-owner worksheet exception) is
covered by `backend/tests/unit/test_account_service.py`.

**This session does not invoke erasure against real/production data** —
per the operating constraint for this task, the endpoint and its tests only
ever run against synthetic rows in a throwaway local Postgres database.

## 4. Right to portability (Art. 20)

`GET /api/auth/export-data` (`backend/api/v1/auth.py`) returns a single JSON
document covering every table in §2, plus `exported_at`. This replaces the
previous client-side-only export in `src/pages/Settings.tsx`, which read a
handful of tables directly via the browser Supabase client (incomplete, and
reliant on RLS `SELECT` policies existing on every table it wanted to read —
this endpoint instead uses the service-role client server-side so it is
complete regardless of per-table RLS posture, then returns only the
calling-user's own rows, filtered server-side by `uid`).

## 5. Retention policy

- **`learning_events`** (fastest-growing table, §13 of the roadmap):
  documented target is a 24-month rolling retention window for raw
  per-event rows, after which rows are downsampled into the existing
  analytics rollup tables and the raw row is eligible for deletion.
  **Enforcement (time-partitioning + automated drop, P5-4) is a separate,
  larger roadmap item and is explicitly deferred here** — this doc commits
  to the policy number so P5-4's partitioning work has a target to
  implement against, per the roadmap's own note that P5-4's retention
  window must "align with the GDPR posture (S-2)." No raw `learning_events`
  row is currently deleted automatically; the only deletion path today is
  the full-account erasure in §3.
- **Uploads (`pdf-uploads` storage + `lectures` rows):** retained for the
  lifetime of the owning account (professor course material / student
  private upload) or until the specific take-down flow (S-4) removes a
  single item. No blanket time-based deletion — university course content
  is expected to be retrieved across a full semester/degree, so a fixed
  short TTL would break the product. Full removal happens at account
  erasure (§3) or per-item takedown (S-4), not on a timer.
- **Auth/session cache (`backend_cache` token rows):** already time-limited
  (45s TTL) and swept by `cleanup_backend_cache()` / the admin
  `/auth/cleanup-token-cache` endpoint — no PII beyond a token hash, not a
  GDPR-relevant retention concern.

## 6. Data minimization

No new PII fields were added by this change. The `EXPORT_TABLES` inventory
in §2 was produced by grepping `supabase/migrations/` for every
`user_id`/`student_id`/`requester_id`-scoped table — if a future migration
adds a new PII-bearing table it must be added to that list (export
correctness) and reviewed for whether it needs a non-CASCADE exception like
`worksheets` (erasure correctness); there is no automated check for this yet
(a CI check tying new migrations to this list is future work, not in this
slice).

## Deferred out of this slice

- Signed DPAs with each sub-processor in §1 (legal/business action, not
  code).
- Defaulting `PARSER_LLM_MODEL`/`VISION_MODEL` to an EU/self-hosted endpoint
  in production config (deployment decision — the code seam already
  exists).
- `learning_events` time-partitioning + automated archival (P5-4) — the
  retention *number* is documented here so P5-4 has a target; the
  *enforcement* is a separate, larger item.
- A CI check that fails a new PII-bearing migration lacking an
  export/erasure decision (S-1's "CI fails any new DEFINER function or
  table lacking an explicit grant/RLS decision" is the closest existing
  analog; extending it to this list is future work).
- Wiring `src/pages/Settings.tsx`'s "Export my data" button to the new
  `GET /api/auth/export-data` endpoint. It currently builds its export
  client-side from a handful of tables read directly via the browser
  Supabase client — incomplete relative to the new server-side endpoint,
  but still functional, and this roadmap explicitly scopes frontend/UX work
  out unless an API-contract change requires it (§15). The new endpoint is
  additive (no existing contract changed), so the frontend swap is a
  follow-up, not a blocker for this slice.
