# Storage & Upload Security Audit (S-4) + General Security/Bug Review

> Deliverable for `docs/ROADMAP_10X_FOUNDATION.md` §14, **S-4 · Storage & upload
> security** — the one tracked security initiative (S-1 through S-6) that had no
> companion audit doc before this pass. Also covers a general bug/injection/
> error-handling sweep across the codebase that isn't specific to any single
> lettered initiative.
>
> Method: baseline was `e0ad357` (branch `terminal`, working tree clean). Three
> parallel research passes (app structure/tests/CI; upload/parsing/AI-call
> surfaces; auth/database/secrets) mapped the codebase, cross-referenced
> against the existing `RPC_EXPOSURE_AUDIT.md` / `GDPR_DATA_PROTECTION.md` /
> `SECRETS_AUDIT.md` / `SECURITY_CI.md` to avoid re-auditing already-covered
> ground, then a design pass sequenced fixes and verified specific claims
> (installed package API shapes, existing test coverage) before code changed.
> Every fix below landed as its own commit with its own test-suite run; see
> `git log e0ad357..HEAD` for the fix-by-fix history and each commit message's
> "Verified:" line for exactly what was run.

## Summary

- **S-1, S-2, S-6 were already done** (see their own docs) — verified their
  claims still hold (migration files, regression tests, and CI jobs they cite
  are present on disk) rather than re-auditing from scratch.
- **S-3 (rate-limit & proxy-trust hardening) was already fixed in code** —
  `backend/main.py`'s `_trusted_proxy_hosts()` is pinned to
  `127.0.0.1`/`::1`/`172.16.0.0/12` (not `["*"]`), and
  `backend/core/rate_limit.py`'s `rate_limit_key()` keys on the trust-bounded
  client IP or a hashed bearer token, not raw client-supplied
  `X-Forwarded-For`. Only the roadmap's checkboxes were stale (fixed below).
- **S-5 (secrets & supply chain) remains mostly done**, per its own doc; the
  one open item (a fully-pinned `requirements.txt` lockfile) is explicitly
  deferred to a separate initiative (P4-4) and out of scope here.
- **S-4 (storage & upload security) had no prior audit.** This pass found and
  fixed three real gaps (below) and confirms the three roadmap acceptance
  criteria.
- **A general review beyond the lettered initiatives** found a real
  prompt-injection trust-boundary gap (the highest-severity finding of this
  pass) plus a missing rate limit, an unauthenticated internal service, and
  several places returning raw exception text to clients.

## Findings

| # | Severity | Finding | Fix commit |
|---|---|---|---|
| 1 | Medium-High | AI prompts (tutor, quiz-gen, vision, content-filter) treated "slide content" as trusted because it "comes from the professor's deck" — false, since `upload.py`/`materials.py` gate uploads with `require_creator`/`require_student`, so students can upload material too. Attacker-controlled document text could reach the tutor's cross-user context, quiz-generation, vision, and classification prompts unsanitized. | `bf01216`, `558e987`, `d75218c`, `7573a2c` |
| 2 | Medium | `generate-title-suggestion` (`courses.py`) joined an unbounded client-supplied list directly into an LLM prompt with no rate limit, unlike every sibling AI-content route. | `8960536` |
| 3a | Medium | Worksheet downloads didn't force `Content-Disposition: attachment` — the signed URL relied on whatever Content-Type ended up stored, which for `text/plain`/`text/csv` (no reliable magic bytes) is structurally unverifiable. | `fbeae61` |
| 3b | Medium | Worksheet uploads (`worksheets.py`) only checked the client-supplied `Content-Type` header — no magic-byte verification, unlike the main PDF/PPTX pipeline. | `572035c` |
| 4 | Medium | `mineru_server.py` (standalone parser microservice, not in any docker-compose) had zero authentication on `POST /file_parse`, bound to `0.0.0.0:8888`. | `e488a7c` |
| 5 | Low | `sanitize_filename()` didn't strip HTML metacharacters (currently inert — no live render path uses them unescaped). | `eaf2c15` |
| 6 | Low | Raw exception text reached clients on several 5xx/background-job error paths (could leak internal details). 4xx client-input-validation paths deliberately left as-is (useful UX, low sensitivity). | `2282cef` |

Full rationale, file:line references, and the exact fix for each is in its
commit message — not duplicated here to avoid drift between this doc and the
code as it evolves further.

## S-4 acceptance criteria

Per `docs/ROADMAP_10X_FOUNDATION.md` §14:

- **[x] Oversized/invalid/malformed uploads are rejected before parse with
  friendly errors.** The main pipeline already did this
  (`backend/core/file_validation.py`, `backend/services/upload_service.py`'s
  `_validate_pptx`). Worksheets now does too, as of `572035c` — magic-byte
  checks for every allowed type that has a reliable signature; `text/plain`/
  `text/csv` are handled by the download-disposition fix instead, since no
  byte check can exist for them.
- **[x] A private upload and every derived artifact are unreachable by any
  other user (RLS test).** Already covered and untouched by this pass — see
  `backend/tests/db/test_student_uploads_rls.py`.
- **[~] Storage URLs are time-limited; a documented takedown flow removes
  content + artifacts.** Signed URLs already carry a 1-hour TTL
  (`create_signed_url(path, 3600, ...)`). The takedown mechanism that exists
  is `backend/api/v1/admin.py`'s `toggle_course_visibility` /
  `toggle_lecture_visibility` (admin-only): both flip a row's `is_archived`
  flag, which the RLS policies key student `SELECT` access on. **Precisely
  what this is**: an access-control toggle — it hides content from students
  immediately via RLS, it does **not** delete the underlying storage object,
  derived slides/quizzes, or embeddings. There is no automated purge of
  those derived artifacts tied to this toggle, and no written process
  (who initiates it, expected turnaround, whether the uploader is notified)
  beyond the endpoint's own docstring. Marking this criterion partially met:
  the mechanism exists and is now described accurately in one place, but
  "documented takedown flow" as a process (not just a toggle) is still a
  gap — flagged here rather than asserted either way, since closing it is a
  product/process decision, not a code change this pass should guess at.

## Deferred / explicitly not fixed in this pass

- `creation-flow/app.js` — a dead prototype with an unescaped-`innerHTML`
  pattern, confirmed unreachable (no `fetch`/`XHR` calls anywhere in it, not
  referenced by the Vite build, nginx config, or any Dockerfile). Belongs to
  the existing `docs/dead-code-audit.md` report-only process, not this one.
- `sqlmodel` is a listed dependency in both `requirements.txt` and
  `requirements-docker.txt` with zero actual imports anywhere in `backend/`.
  Noted, not removed — dependency cleanup is the dead-code-audit skill's
  territory.
- A full `requirements.txt` lockfile (S-5's own deferred item, P4-4's scope).
- `docs/threat_model.md` is referenced by three other docs
  (`SECURITY_CI.md`, `GDPR_DATA_PROTECTION.md`, `RPC_EXPOSURE_AUDIT.md`) as a
  companion document but does not exist in the repo. Dangling reference,
  noted here rather than silently left for the next person to trip over.
- Whether hosted Supabase Storage actually sniffs `text/plain` as HTML in
  a real browser today isn't something reading code can settle — the
  download-disposition fix (3a) closes the gap regardless of the answer,
  so this wasn't chased down with a live `curl -I` against a real signed URL.
- Rate-limit coverage is inconsistent beyond finding #2: several read-only
  authenticated GET routes (`analytics.py`, `concepts.py`, `mind_map.py`)
  rely on the global 120/min default rather than an explicit per-route
  limit. For pure reads this is plausibly fine — not fixed blanket-style,
  since guessing which of these "should" be tighter without knowing real
  traffic patterns risks breaking legitimate dashboard polling.
- The ~150 `supabase_admin` (RLS-bypassing) call sites across `backend/api/v1/`
  are pre-existing, already tracked, and CI-guarded against new unguarded
  additions (`test_no_new_supabase_admin_imports.py`) — that's P2-1's scope,
  not re-litigated here.

## Roadmap housekeeping

`docs/ROADMAP_10X_FOUNDATION.md` §14's S-3 checkbox was ticked to reflect
that the rate-limit/proxy-trust fix described above is already live in code
(`backend/main.py`, `backend/core/rate_limit.py`) — it just never had its
own audit doc or checked box.
