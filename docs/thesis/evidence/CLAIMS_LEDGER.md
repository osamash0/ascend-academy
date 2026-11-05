# Claims ledger — thesis briefs vs. code

Every factual claim in the `\TODO{}` briefs of `thesis/chapters/03`–`06` and in
`docs/thesis/ARCHITECTURE_PRIMER.md` Part 6, checked against code.

- **Audit revision:** `0be0081` (2026-08-18), the thesis's `\thesisCommit`.
- **Current trunk:** `origin/main` @ `6b4333a`, 174 commits later.
- **Unmerged branches checked:** `6161e00` (`claude/ai-calls-cleanup-testing-8a4bac`, provider-chain repair),
  `26f87c3` (`claude/learnstation-afdd92`, PR #72, stalled-run sweep), `fcb3f1e`
  (`claude/project-hetzner-state-report-6faa1f`, anon EXECUTE revoke).
- **Update 2026-11-05:** both security findings in this ledger are fixed. The anon EXECUTE revoke landed as
  `537b9806` (PR #77, migration `20261011000000`, applied to prod by hand 2026-10-11) and superseded
  `fcb3f1e`, which was never merged. The single-file upload ownership gap was fixed in `722167b0`
  (2026-10-10) and deployed with `35a30d73` (2026-10-30). Rows that say "fix pending" or "only on an
  unmerged branch" describe the state on 2026-10-10. Write them as found-then-fixed.
- **Method:** every file:line was read with `git show <rev>:<path>` / `git grep <rev>`. The working tree
  was never treated as `0be0081`. The arq claim was checked against the installed `.venv`
  (`arq 0.28.0`). Retry arithmetic was computed with the installed `tenacity 9.1.4`.
- **Branch impact in general:** between `0be0081` and `origin/main` **no migration changed**
  (`git diff 0be0081 origin/main -- supabase` is empty). The commits that touch claimed code are
  `2f6d566` (PR #51: LiteLLM removal, zero-vector and embedding-task fixes, PPTX fail-fast),
  `5e020eb` (PR #54: LectureView/lectureService, not citation-related) and `30168f8` (roadmap docs).

Actions: **W** = write as-is · **C** = correct the number/wording · **F** = frame as found-then-fixed ·
**D** = drop · **P** = needs prod probe.

---

## Summary

**Unique claims checked: 91.** (Primer rows that duplicate a chapter row are marked `= #x` and are
counted only once.)

| Verdict | Count |
|---|---|
| W — write as-is | 47 |
| C — correct number/wording | 32 |
| F — frame as found-then-fixed | 6 |
| P — needs prod probe (code part verified, runtime part not) | 5 |
| D — drop | 1 |

### Must NOT be written as currently briefed

1. **Idempotency, "six mechanisms … at most one unit of effective work for identical input"** (#4.11, #4.13, #3.4).
   The guarantee only holds per owner: the unique key includes `user_id`, and the docstring admits that two
   owners each pay for a full parse. There are at least **seven** mechanisms on the parse path, because the
   Redis parse-cache replay runs before all of them. The brief also says "layer four" for the lock, but the
   figure files the lock (L4) under Layer 3.
2. **"Three compose files state three targets"** (#4.3). There are **four** compose files. Two name a
   production target (a university server and Oracle A1). Neither of them is Hetzner.
3. **"Eight attempts capped near three"** (#4.25). Up to **four** attempts fit inside 25 s (they start at
   0/4/8/16 s). The primer and figure f11 computed "4+8+16" without the ×2 multiplier.
4. **"~five independent failure domains"** (#4.23). The nine entries use **seven** distinct API keys.
5. **"26 of ~68 tables" and "four dead tables"** (#4.17, #4.18). f9 draws **30** public tables plus
   `auth.users`. A fifth table, `parse_pages`, has writers only in `_legacy`, yet it is drawn as live.
6. **"A missing FK made badge awards silently no-op"** (#4.20). `award_badge` returns NULL when it sees an
   unknown key. An FK would not have changed that.
7. **"Four plausible distractors"** (#5.10). Each question has four options, so three distractors.
8. **Tutor injection defences** (#3.2, #5.7, #5.8). The sanitiser runs only on student input, never on
   retrieved slide text. The audience is "students who chat about that lecture", not "every other student".
9. **"Review flag never cleared"** (#5.16). Manual saves never clear it, but an AI regenerate does.
10. **Security arc** (#5.21, #5.23, #5.24). Step 1's migration header documents no attack, and steps 4 and 5
    are in reverse chronological order. The exploit's root cause leaves out Supabase's explicit
    anon default grant. "Anon-callable ≠ anon-readable" must sit next to the 2026-09-17 prod finding: 48
    anon-executable SECURITY DEFINER functions, 8 of them exploitable. On 2026-10-10 the fix existed only
    on unmerged `fcb3f1e`; it has since been fixed by `537b9806` (PR #77, applied to prod 2026-10-11), so
    present it as found-then-fixed.
11. **"Authorisation is enforced in the database, not the API layer"** (#5.17). The backend mostly uses the
    service-role client.
12. **"Reconciler resolves runs stuck in a non-terminal state"** (#4.15). At `0be0081` it only resolves runs
    stuck in `extracting`.
13. **Built vs deployed** (#6.9, #6.11). Only two of the "three half-states" are flag-on/flag-off: Exam has no
    frontend flag at all. Whether the frontend flags are on is not visible in git. Also, `concept_mastery` is
    not emptied by the course-brain flag.
14. **Smaller corrections:**
    - #4.10: the generator-aware classifier is `_legacy/parser_classifier.py`, not `slide_classifier.py`.
    - #5.2: the scoping comment lives in migration `20260719020001`.
    - #5.4: the sim-0 anchor guards a refusal gate that was deleted.
    - #6.5: the refusal-gate result belongs to the unreachable course tutor.
    - #4.14: the deployed image pins arq 0.26, not 0.28, and timeouts are not retried either.
    - #4.2: the parse pipeline itself needs asyncpg.

### Cross-cutting caveats for Chapter 6 (threats to validity)

- **Prod was not running `0be0081` at audit time.** The audit commit's own message says prod was on
  `deploy/egress-hotfix @ 39c6590`, 355 files behind `main`. Every "deployed" statement taken from
  `0be0081` therefore describes compose configuration, not observed production. What prod runs today is
  a prod probe: `git -C /root/ascend-academy rev-parse HEAD; docker ps --format '{{.Names}}'`.
- **Prod-only state can't be seen from git:** `.env` contents (`VITE_FEATURE_*`, `FEATURE_*`,
  `DATABASE_URL`, `LLM_TIMEOUT_SECONDS`), Supabase default privileges, and row counts.
- **Found while checking #3.2, not verified, not a thesis claim:** single-file
  `POST /upload/parse-pdf-stream` accepts a `course_id` and never checks that the caller owns that course
  (`upload.py:84-200`). The batch path does check (`upload.py:528-533`), and persistence goes through asyncpg,
  which bypasses RLS. If confirmed, any creator could put a lecture into someone else's course. That would
  widen the injection audience in #5.7. It needs a test before anyone cites it.
  *Update 2026-11-05: confirmed and fixed in `722167b0` (2026-10-10), with
  `backend/tests/integration/test_upload_course_ownership.py`; deployed with `35a30d73`. Citable as
  found-then-fixed.*

---

## Chapter 3 — Requirements

| # | Claim (short) | Thesis location | @0be0081 | Evidence @0be0081 | @origin/main | Pending branches | Action for the writer |
|---|---|---|---|---|---|---|---|
| 3.1 | `require_creator` admits professors and students; the code comment states ownership-not-role intent | 03-requirements.tex:13-15 | yes | `backend/core/auth_middleware.py:243-245` (comment and `require_role("professor","student")`). Used by `api/v1/upload.py`, `courses.py`, `onboarding.py` | same (`:245`) | none | W |
| 3.2 | A student-uploaded PDF can reach another student's tutor context | 03:15-18 | partly | Slide text is not sanitised and reaches anyone "who chats about that lecture/course" (`services/ai/tutor.py:11-19`). Lecture-tutor retrieval is scoped to one lecture in SQL (`20260719020001_match_slides_by_lecture.sql:47-50`), so the audience is the students who open that lecture, not all students | same | none | C: write "students who open that lecture or course", not "every other student". See the unverified `course_id` lead in the caveats |
| 3.3 | Shaded use cases unreachable because every feature flag defaults to off | 03:8-9 (fig caption) | yes (code defaults) | Backend: `core/config.py:103,109,115,121,134,139,181` (all `default=False`). Frontend: `src/lib/featureFlags.ts:8-10` (`=== '1'`) | same | none | W ("default deployment" = code defaults; actual prod env is #6.9) |
| 3.4 | Idempotency is satisfied by six independent mechanisms | 03:37-41 | partly | See #4.11 and #4.13 | same | PR #72 sweeps the orphaned `queued` runs from #4.13 | C: "six mechanisms (a selection) per owner", not an input-level guarantee |
| 3.5 | *Quiz* has no table; a quiz is the questions reachable through a lecture's slides | 03:51-55 | yes | 68 distinct `CREATE TABLE` names in migrations, none of them a quiz table. `quiz_questions.slide_id REFERENCES slides` (`20260122202809_…sql:75-82`). Note that `exam_attempts.question_ids UUID[]` (`20260710020000_exam_mode.sql:13`) and `practice_sheets`/`practice_sheet_questions` **do** persist question sets | same | none | W (say "in-lecture quiz" so the exam and practice-sheet persistence don't contradict it) |
| 3.6 | Constraints: 4 GB / 2 vCPU single VM, low-cost LLM quotas, free-tier Postgres without backups, one developer | 03:60-63 | yes (as documented) | `docker-compose.prod.yml:82-83,113,194` ("4 GB box", "2 vCPU"). Quotas: `services/ai/orchestrator.py:150-238` (`daily_limit` per entry). No backups/PITR: `docs/MILESTONE_4_FIX_PLAN.md` (0be0081 diff, "no backups/PITR (confirmed 2026-08-17)") | same | none | W (cite the vendor tier for backups) |
| 3.7 | NFR values from the appendix, including "the resilience target for provider failure" | 03:32-35 | partly | Upload 50 MB `config.py:87`. Pages 300 `upload_service.py:13`. Queue 50 → 429 `config.py:98` and `api/v1/upload.py:180-188`. $5/month cap `config.py:173-174`. **No numeric resilience target exists anywhere in code or config** | same | none | C: drop "resilience target", or state the chain depth as the design position, not as a target |

## Chapter 4 — Design

### 4.1 Architecture and deployment

| # | Claim (short) | Thesis location | @0be0081 | Evidence @0be0081 | @origin/main | Pending branches | Action for the writer |
|---|---|---|---|---|---|---|---|
| 4.1 | No gateway on the LLM path; LiteLLM container had no live callers and has since been removed | 04-design.tex:18-19 | yes | `LITELLM_BASE_URL` / `litellm_client_key` are used only in `backend/_legacy/stage2_synthesize.py:85-86`, `stage3_generate.py:158,264`, `stage5_finalize.py:74` and `_legacy/fast_upload.py`. The live path calls providers directly (`orchestrator.py:831-847`). The container was still defined at `docker-compose.prod.yml:63`, and `api`/`worker` `depends_on` it at `:138-139` | **changed**: removed from compose and README by `2f6d566` (PR #51, merged 2026-08-28) | `6161e00` also deletes `backend/_legacy/`, `litellm/config.yaml` and the `LITELLM_*` config fields | F (2f6d566) |
| 4.2 | `/health/ready` reports healthy while the asyncpg path is entirely absent, so several features break with no signal | 04:20-22 | partly | Code: when `DATABASE_URL` is unset → `checks.database="not_configured"` and `ok` stays True (`backend/main.py:357-362`). This is deliberate and documented in the same comment. **Understated:** the parse pipeline itself needs asyncpg, because `repos._pool()` raises `"Database pool not available"` (`services/parser/repos.py:28-38`). Without `DATABASE_URL`, uploads fail outright, not just MV refresh, localisation and review. Whether prod lacks it can't be seen in git | same | none | P: `docker exec <api> curl -s localhost:8000/health/ready` (inspect `checks.database`), plus `docker exec <api> printenv DATABASE_URL \| wc -c`. Then C: write it as conditional and add the parse pipeline to the dependents |
| 4.3 | Three compose files state three different deployment targets | 04:33-34 | no | **Four** compose files: `docker-compose.yml:1` (local dev), `docker-compose.prod.yml:3` ("shared university server"), `docker-compose.oracle.yml:3` ("Oracle Cloud Free Tier (A1 Flex)"), `docker-compose.staging.yml` (no target). The real host (Hetzner) appears only in `docs/GDPR_DATA_PROTECTION.md:8` | same headers (litellm removed by `2f6d566`) | `6161e00` edits prod.yml comments only | C: "four compose files; two name production targets, neither of them the actual host" |
| 4.4 | One compose file is not deployable at all | 04:34-35 | partly | `docker-compose.staging.yml:1-21` uses `network_mode: "host"` together with `ports:` (:5-6, :13, :19-21). It points `REDIS_URL`/`REDIS_QUEUE_URL`/`LITELLM_BASE_URL` at hosts `redis`, `redis-queue` and `litellm` (:10-12), and those services are not defined in the file. It would start but could not reach its dependencies | `LITELLM_BASE_URL` line removed (`2f6d566`), otherwise same | none | C: "not functional as written" is safer than "not deployable" |
| 4.5 | TLS-terminating host proxy is absent from version control | 04:28-30, 35-36 | yes | No TLS config anywhere in the repo (no Caddy, certbot or `listen 443` file). The frontend is bound to `127.0.0.1:3000` only (`docker-compose.prod.yml:167`) | same (`:140`) | none | W (the proxy's existence and type are a prod fact: `ss -tlnp \| grep -E ':443'`) |
| 4.6 | Deployment is five containers on one VM | 04:28 (fig caption) | no at 0be0081 | `docker-compose.prod.yml` at 0be0081 defines **six** services: redis :15, redis-queue :37, litellm :63, api :97, frontend :153, worker :174 | **five** after `2f6d566` | none | F (2f6d566). Running count: `docker ps` on the host |

### 4.2 Ingestion pipeline

| # | Claim (short) | Thesis location | @0be0081 | Evidence @0be0081 | @origin/main | Pending branches | Action for the writer |
|---|---|---|---|---|---|---|---|
| 4.7 | Admission control (validation, hashing, backpressure) completes before enqueue; fail fast with an honest status | 04:53-56 | yes | `api/v1/upload.py:120-128` (413/400), `:131` hash, `:180-188` 429 when depth ≥ `arq_max_queue_depth`. Note that the Redis **parse-cache replay** (`:134-178`) short-circuits before backpressure | same (lines shift) | none | W (mention the cache short-circuit) |
| 4.8 | Durable queue; worker entry point, job timeout, SSE progress | 04:61-63 | yes | Arq `job_timeout = 900` at `workers/arq_worker.py:281`, `keep_result` at `:284`. Pub/sub channel `parse:{pdf_hash}` at `services/parser/unified_orchestrator.py:488-498` | same | none | W |
| 4.9 | Live routing rule is a single character-count threshold | 04:68-69 | yes | `_MIN_TEXT_FOR_SYNTH = 25` at `unified_orchestrator.py:67` (primer says :64). Applied at `:128` and `:711-715` | same (`:67`) | none | W (fix the line number) |
| 4.10 | Docs describe a richer generator-aware classifier; the code exists but is unreachable | 04:69-71 | partly | Generator detection (LaTeX/PowerPoint/Keynote via PDF Creator/Producer) is `backend/_legacy/parser_classifier.py:1-60` (`detect_generator` at :38), which no live code imports (`services/parser/__init__.py:12-13`). The primer's citation, `services/slide_classifier.py`, is a **layout** router (SKIP/TABLE/MATH/VISION/TEXT, :1-19) and is not generator-aware. It is reachable only via `file_parse_service.parse_pdf_stream` (:154), which has no callers | same | **`6161e00` deletes `backend/_legacy/`, so after that merge the generator classifier no longer exists at all** | C: cite `_legacy/parser_classifier.py`. If 6161e00 merges, write "existed, was archived, then deleted" |
| 4.11 | Six independent idempotency mechanisms across four layers | 04:76-78, 81-83; fig f10 | partly | All six exist: L1 `upload.py:131` and storage key `upload_service.py:112-120`. L2 `parser/repos.py:79-87` and `20260730000000_…sql:50`. L3 `unified_orchestrator.py:533-535`. L4 `:539-545` and `core/job_locks.py:41-54`. L5 `:637-644`. L6 `file_parse_service.py:832-841`. **But:** (a) a seventh parse-path mechanism runs first: the Redis parse-cache replay (`upload.py:134-178`). (b) There is more idempotency elsewhere: the `Idempotency-Key` dependency (`core/idempotency.py`, used by courses/exams/review) and `review_cards.content_hash` UNIQUE plus a lock (`review/card_factory.py:4-6,109`). (c) "Layers" is the figure's own grouping. The TODO calls the lock "layer four", but f10 puts L4 in "Layer 3" | same | none | C: "six mechanisms selected (≥7 on the parse path)". Say "mechanism L4", not "layer four" |
| 4.12 | Distributed lock is best-effort and proceeds unlocked on a Redis error | 04:84-86 | yes | `core/job_locks.py:47-54` (returns True when `redis_conn is None` and also on any exception). The module docstring at `:19-21` states the intent | same | none | W |
| 4.13 | "At most one unit of effective work for identical input" | 04:77-78 (fig f10 caption) | no | The unique key is `(pdf_hash, pipeline_version, user_id)` (`repos.py:82`), and the docstring admits that "two different owners uploading byte-identical PDF content each pay their own full parse" (`unified_orchestrator.py:467-473`). The lock is keyed on `pdf_hash` alone (`job_locks.py:33-34`). So when a **concurrent** second owner arrives, their run returns early (`unified_orchestrator.py:540-545`) and stays `queued`, which the 0be0081 sweep never touches (#4.15) | same | **PR #72 (`26f87c3`)** extends the sweep to `queued`/`pending`, which would resolve those orphans | C: "per owner", and name the orphan-run edge case |
| 4.14 | Queue retry budget does not apply to ordinary exceptions; verified against the installed library source | 04:92-95 | yes (0.28.0), with caveats | In arq 0.28.0 `worker.py:610-639`, a plain `Exception` takes the else branch and sets `finish=True`. Only `Retry`, `RetryJob` and `CancelledError` retry. `max_tries = 5` at `arq_worker.py:287`. The orchestrator re-raises (`unified_orchestrator.py:957-999`). **Caveats:** (1) the Docker image pins `arq>=0.26,<0.27` (`backend/requirements-docker.txt:38`), while 0.28.0 is only in `requirements.txt:33`, so the "installed source" checked is not the deployed version. (2) A `job_timeout` surfaces as `TimeoutError`, which is also permanent. The primer's D6 arrow "timeout → retry" is wrong | same (`requirements-docker.txt:51`) | none | C: name the version that was checked, say "0.26 deployed", and drop "timeout → retry" from the diagram |
| 4.15 | A cron reconciler resolves runs stuck in a non-terminal state | 04:95-96 | partly | Only `extracting` runs older than 25 min: `parser/reconcile.py:84-95` → `repos.list_stalled_extracting_runs`, `WHERE status = $1` (`repos.py:243`). Cutoff at `arq_worker.py:48`, cron every 10 min at `:257`. `queued` is explicitly excluded | same | **PR #72** adds `queued` + legacy `pending` (`repos.list_stalled_runs`) | C: "stuck in `extracting`"; mention #72 if it merges |
| 4.16 | A dead-letter table captures terminal failures | 04:96-97 | partly | Captured via `after_job_end` (`arq_worker.py:264-269`). `workers/dlq.py:12-18` documents that the `job_try > max_tries` crash-loop path bypasses the hooks and is **not** captured | same | none | C: add "except the crash-loop path, by the module's own admission" |

### 4.3 Data model

| # | Claim (short) | Thesis location | @0be0081 | Evidence @0be0081 | @origin/main | Pending branches | Action for the writer |
|---|---|---|---|---|---|---|---|
| 4.17 | Core schema shows 26 of roughly 68 tables | 04:103, 107 (f9 title) | partly | 68 distinct table names in migrations (my count; also matches "~68"). **But `thesis/figures/src/f9-er-core.puml` draws 31 classes = 30 public tables + `auth_users`**, not 26 | same | none | C: "30 of 68" (or trim the figure to 26) |
| 4.18 | Four excluded dead tables, with evidence | 04:107-108 | partly | `slide_chunks`: zero INSERTs, but one UPDATE at `api/v1/onboarding.py:626`. `tutor_messages`: only the `domain/parse_models.py:15,208` Pydantic model and generated types. `concept_mastery`: a writer exists but is a no-op (`review/mastery.py:6-12`). `catalog_course_links`: no non-type references. **Missed:** `parse_pages` is drawn as live (`PARSE_RUNS ‖ PARSE_PAGES`), but its `repos.py` helpers are called only from `_legacy/stage1_ingest.py` and `_legacy/parser_orchestrator.py`, so it is dead in v5 | same | `6161e00` deletes `_legacy`, leaving `parse_pages` with zero writers anywhere | C: five dead tables, or remove `parse_pages` from f9 |
| 4.19 | Three relationships have no DB-enforced FK | 04:108-109 | yes | `achievements.badge_name` (no REFERENCES; `gamification_engine.sql:191-193`). `exam_attempts.question_ids UUID[]` (`20260710020000_exam_mode.sql:13`). `assignments.course_id UUID NULL` (`20260503000009_assignments.sql:21`), with no later FK | same | none | W |
| 4.20 | Because badge names are only conventionally linked, three badges were never seeded and their award calls silently do nothing | 04:109-113 | partly | Not seeded: `20260710020000_exam_mode.sql:41-44`. Calls: `src/features/review/ReviewSession.tsx:69,70,77`. Silent: `award_badge` does `IF _def.key IS NULL … RETURN NULL` (`20260616000000_gamification_engine.sql:233-235`, also `_grant_badge` at :186-188). **The causal claim is wrong:** the function returns before any INSERT into `achievements`, so an FK on `badge_name` would not have turned this into an error. The defect is a string-keyed client→catalog contract with a deliberate NULL-on-unknown | same | none | C: reframe as an unchecked stringly-typed contract plus a swallow-unknown RPC. P: `SELECT key FROM badge_definitions WHERE key IN ('review-streak-7','review-streak-30','centurion');` |
| 4.21 | A vector column exists in prod with no migration, is null in every row, and has never been scanned | 04:115-118 | yes (migration part) | No migration defines `slides.embedding`, and `git log --all -S slides_embedding_ivfflat` finds only docs commits. The "100% NULL / 5,445 rows / zero scans in 252 days" figures come from `docs/MILESTONE_2026_08.md:206-208` (prod observation) | same (no migration changes) | none | P: `SELECT count(*), count(embedding) FROM public.slides;` `SELECT idx_scan, last_idx_scan FROM pg_stat_user_indexes WHERE indexrelname='slides_embedding_ivfflat';` |

### 4.4 Provider strategy

| # | Claim (short) | Thesis location | @0be0081 | Evidence @0be0081 | @origin/main | Pending branches | Action for the writer |
|---|---|---|---|---|---|---|---|
| 4.22 | Mechanism: registry, two ordered chains, availability filtering, rate-limit backoff, permanent disable on model-not-found | 04:128-130 | yes | Registry `services/ai/orchestrator.py:150-238`. `BULK_CHAIN` :245, `QUALITY_CHAIN` :251. `available()` :497-548. Backoff 90 s·2^n capped at 600 s (:467-473). 404 → `record_unavailable` (:863-878). Last-ditch: an empty availability list → whole chain (:826-827) | same | **`6161e00`**: hard vs soft gates. An empty list now raises instead of retrying the raw chain, which closes an OpenAI cost-ceiling bypass. Also adds a 402 class, vision permanent-disable, and new model slugs | W (describe the 0be0081 state; footnote the pending repair) |
| 4.23 | Four of nine entries share two API keys; ~five independent failure domains | 04:131-133; f11 caption and :9 | partly | 4 of 9 share 2 keys: `gemma`/`gemini` both use `GEMINI_API_KEY` (:173, :214), `groq_fast`/`groq` both use `GROQ_API_KEY` (:166, :222). **But 9 entries over 7 distinct keys gives at most seven credential domains, not ~five** | same | `6161e00` changes the slugs but keeps the sharing (`gemini-flash-lite-latest` and `openai/gpt-oss-20b` on the same keys). Its comments say most 0be0081 slugs were dead by Sep 2026 | C: "seven" (and fix f11:3, :9) |
| 4.24 | Classification is string matching rather than status codes and omits auth/payment, so a revoked key is retried indefinitely | 04:134-136 | partly | Rate limit is a substring sniff on `str(exc).lower()` (:849-850). **404 checks `exc.status_code` first** (:863-867). 401/402/403 fall to the generic branch with no penalty (:879-883), so they are re-attempted on **every subsequent call** for the process lifetime, though not in a tight loop. A 402 body containing "quota" is misclassified as a rate limit (90 s backoff) | same | **`6161e00` adds a 402/payment class checked before the quota sniff → permanent disable.** 401/403 are still unclassified | C: "mostly string matching (404 uses the status code)". "Re-attempted on every call", not "retried indefinitely". If 6161e00 merges, payment is no longer omitted |
| 4.25 | Retry budget configured for eight attempts but a timeout caps it near three | 04:137-138; f11:78-81 | partly | `stop_after_attempt(8)`, `wait_exponential(multiplier=2, min=4, max=60)`, `asyncio.wait_for(timeout=25)` (`services/llm_client.py:34-39,71-77`). Computed with tenacity 9.1.4: the waits are 4, 4, 8, 16 s, so attempts start at 0/4/8/16 s. **At most four** attempts fit in 25 s. The "4+8+16" arithmetic ignores the multiplier. Each "attempt" is a full chain traversal (`orchestrator.py:1191-1196, 1234-1239`), and retries happen only if the final error text matches 429/quota/503/timeout (`llm_client.py:28-31`). The timeout can be overridden via `LLM_TIMEOUT_SECONDS` | same | `6161e00` leaves `llm_client.py` unchanged | C: "at most four, fewer with real latency". P: `printenv LLM_TIMEOUT_SECONDS` in the api and worker containers |

## Chapter 5 — Implementation

| # | Claim (short) | Thesis location | @0be0081 | Evidence @0be0081 | @origin/main | Pending branches | Action for the writer |
|---|---|---|---|---|---|---|---|
| 5.1 | Lecture scope is applied in the SQL WHERE clause, not as a Python post-filter | 05-implementation.tex:25-29 | yes | `20260719020001_match_slides_by_lecture.sql:47-50`. Caller at `services/ai/retrieval.py:126-138` | same | none | W |
| 5.2 | "The migration comment explains this; cite it" | 05:29-30 | partly | The comment is in **`20260719020001_match_slides_by_lecture.sql:4-16`**. `retrieval.py:130` mis-cites "migration 20260719020000" (that file is `courses_public_catalog_rls`). The module docstring at `retrieval.py:4-7` still describes the old Python post-filter | same | none | C: cite `20260719020001:4-16` |
| 5.3 | Query-embedding cache | 05:32 | yes | `retrieval.py:34-89`: SHA-256 key, 600 s TTL, Redis failure treated as a miss | same | none | W |
| 5.4 | Current slide anchored at synthetic similarity 0 so refusal logic doesn't confuse anchor with relevance | 05:32-35 | partly | The code and comment exist (`retrieval.py:165-178`). **But the lecture tutor no longer has refusal logic:** `has_scope` is assigned and never read (`tutor.py:176-178`), and the docstring at `:4-9` still claims the refusal exists. The guard protects a deleted gate. The anchored slide is still citable with similarity 0.0 (`tutor.py:118`) | same | none | C: present it as vestigial, not as "a small detail that shows care" |
| 5.5 | Four layers; post-hoc validation drops cited slide indices absent from the retrieved set | 05:40-44 | yes | `tutor.py:106-133` (drops idx ∉ retrieved, :126-127); course tutor `:245-260`. Precision notes: the sanitiser covers only `user_message`/history (`:154,:187`). The prompt **permits** supplementary knowledge in blockquotes (`prompts.py:435-441`) | same | none | W (state both precision notes) |
| 5.6 | (Implied by "scoped retrieval" as a layer) the context is always retrieved slides | 05:40-41 | no | When retrieval returns nothing, the context falls back to the **client-supplied** `slide_text` (`tutor.py:87-88`; sent by `src/pages/LectureView.tsx:993`). Citations are then necessarily empty | same | none | C: name the fallback as a gap in layer 2 |
| 5.7 | A crafted PDF can reach every other student's tutor context | 05:49-51 | partly | = #3.2 | same | none | C: "students who chat about that lecture/course" |
| 5.8 | Mitigation: retrieved context labelled untrusted, plus a sanitiser that escapes delimiters and rewrites injection phrasings | 05:51-53 | partly | Prompt rule: `prompts.py:445-448`. **The sanitiser (`tutor.py:58-74`) never touches slide content.** The docstring says so (`:11-15`), and `_build_context_block` inserts raw text (`:77-103`). A PDF containing `[STUDENT MESSAGE]` marker text is not escaped | same | none | C: against uploaded-content injection the only defence is the prompt rule. The sanitiser defends against the student's own message |
| 5.9 | Questions produced inline by the pipeline; one concept-testing question per slide; prefer application over recall; ban "all of the above" | 05:60-65 | yes | `BATCH_SLIDE_PROMPT` `prompts.py:97` ("exactly ONE concept-testing MCQ"), `:110` (apply/analyse), `:113` (ban). Used via `orchestrator.py:1552-1653` from the unified pipeline. Additional deck-level questions come from `DECK_QUIZ_PROMPT` :154 and `CROSS_SLIDE_DECK_QUIZ_PROMPT` :172 | same | none | W |
| 5.10 | Four plausible same-length distractors | 05:62-63 | no | Four **options** = one correct + **three** distractors (`prompts.py:100-101`, `options: [A,B,C,D]`, `answer: one`). The prompt's own wording "All four options must be plausible distractors" (`:112`) is loose. The appendix already says "4 (3 distractors)" | same | none | C: "three distractors" |
| 5.11 | Card factory derives review cards with no further LLM call | 05:70-71 | yes | `services/review/card_factory.py:1-2`; imports `:22-32` (no LLM module) | same | none | W |
| 5.12 | SM-2 behind a stable interface | 05:71-72 | yes | `services/review/scheduler.py:1-7` (`schedule(state, rating, now)`; columns named for a future FSRS swap) | same | none | W |
| 5.13 | Coverage-first, weakness-weighted sampling with a server-generated seed | 05:72-75 | yes | `api/v1/exams.py:106-111` (`random.SystemRandom().getrandbits(63)`, never client-supplied). `services/exam_service.py:120-129`. Nuance: a student can re-roll by starting a new attempt (limit 30/min, `exams.py:85`) | same | none | W ("cannot choose or replay a seed", not "cannot get a different exam") |
| 5.14 | No draft/published state; the source comment says so verbatim | 05:86-87 | yes | `src/pages/BatchReviewPage.tsx:21-26` | same | none | W |
| 5.15 | Completion marker stored only in browser localStorage | 05:88-89 | yes | `BatchReviewPage.tsx:27-29, 35-65` | same | none | W |
| 5.16 | Review flag is never cleared on save, so a corrected slide stays flagged permanently | 05:89-90 | partly | Manual save never touches `needs_review` (`src/services/lectureService.ts:644-653`). **An AI regenerate recomputes and can clear it** (`services/ai/tutor_service.py:280-297`, endpoint `api/v1/ai_content.py:318`) | same (lectureService +21 line shift, `5e020eb`) | none | C: "a manually corrected slide stays flagged; only an AI regenerate clears it" |
| 5.17 | Authorisation is enforced in the database, not the API layer (f14 caption) | 05:98-99, 102 | partly | True for browser→PostgREST traffic. But the FastAPI backend mostly uses the service-role client (289 `supabase_admin` references in 30 `api/`+`services/` files vs 33 user-scoped) and the asyncpg pool, and enforces ownership in Python (e.g. `api/v1/upload.py:106-118`, `api/v1/concepts.py:42-50`) | same | none | C: "RLS is the boundary for direct client access; the backend bypasses it and checks in code" |
| 5.18 | Permissive policies OR-combine, so visibility is the union | 05:103-105 | yes | `20260719020000_courses_public_catalog_rls.sql:23-28` | same | none | W |
| 5.19 | No test composes a real endpoint against real policies | 05:105-107 | yes (self-reported) | `docs/MILESTONE_2026_08.md:199-204` (F4). No composing test added on main: the `backend/tests/db/*_rls.py` tests are SQL-level | same | none | W (cite the doc) |
| 5.20 | f14: "47 tables, 100% coverage, 198 policies" | f14-trust-boundaries.puml:4, 27 | no (stale) | The 47/198 figures come from `docs/RPC_EXPOSURE_AUDIT.md:178-183` (earlier date). At 0be0081 there are 68 tables, all with an `ENABLE ROW LEVEL SECURITY` statement, and 234 `CREATE POLICY` statements (the net count depends on DROPs) | same | none | C: update the figure. P: `SELECT count(*) FROM pg_policies WHERE schemaname='public';` |
| 5.21 | Five sequential migrations, each header documenting its own attack, each closing what the previous step created or left open | 05:113-118 | partly | Five steps span **six** files (step 3 = `20260601000000` + `20260615000800`). Step 1 (`20260122202809_…sql`) documents no attack. Its header just creates the enum, and its own `:134-135` creates the self-insert policy that step 2 (`20260502000003:1-8`) removes. **Steps 4 and 5 are reverse-chronological**: `20260620000000` (columns) comes before `20260621000000` (professor reads) | same | none | C: "five steps across six migrations; four headers document their attack; step 1 itself introduced the hole step 2 closes" |
| 5.22 | Step three (professor self-signup) introduced the vulnerability step four closes | 05:119-121 | yes | `20260621000000_scope_professor_read_policies.sql:3-11` cites `20260615000800` explicitly. Precision: the over-broad policy predates step 3; step 3 made it exploitable by anyone | same | none | W |
| 5.23 | Reproduced exploit: anon + SECURITY DEFINER + caller-supplied id + no ownership check leaked a social graph; four-way conjunction including the implicit PUBLIC grant; real DB; regression tests | 05:123-128 | yes, but incomplete | `20260721000001_s1_rpc_exposure_lockdown.sql:10-37`. 13 tests in `backend/tests/db/test_s1_rpc_exposure_lockdown.py`. Reproduced on **plain Postgres 18** (`:23-24`), where only the PUBLIC route exists. On Supabase, default privileges also grant EXECUTE to `anon` **explicitly**. Per `fcb3f1e`'s header, 31 of the 36 open prod functions were explicit-anon-only. The root-cause conjunction is therefore not the complete story for the deployed platform | same (fix migration not on main) | **`fcb3f1e`** documents the second route (header :4-21) | C: add the Supabase default-privilege route as a second path |
| 5.24 | Negative result: seven other functions are anon-callable but return no rows because they are SECURITY INVOKER | 05:130-134 | yes (for those seven) | Exactly 7 functions are INVOKER, non-trigger and without `REVOKE … FROM PUBLIC`: `match_concepts`, `match_slides`, `match_slides_scoped`, `search_concepts_keyword`, `search_lectures_keyword`, `search_slides_keyword`, `search_worksheets_keyword` (parsed from all 116 migrations; latest definition wins). **It must not be presented as "the remaining anon surface is benign":** `fcb3f1e` (2026-09-17 prod audit) found 48 anon-executable SECURITY DEFINER functions. Three leaked data to anon over HTTP (`get_user_courses`, `get_user_profile`, `get_global_leaderboard`) and five were writable (incl. uncapped `add_xp_to_user(uuid,int)`). Those functions are ones `docs/RPC_EXPOSURE_AUDIT.md:153-171` at 0be0081 classified as "safe as-is" | same: **the fix migration was not on main on 2026-10-10** | **`fcb3f1e`** (header :59-62 says it was applied to prod by hand; never merged). Superseded on main by `537b9806` (PR #77, `20261011000000`, applied to prod 2026-10-11) | C: keep the seven-function contrast, but present the 2026-09-17 finding next to it as the audit's own blind spot |

## Chapter 6 — Evaluation

| # | Claim (short) | Thesis location | @0be0081 | Evidence @0be0081 | @origin/main | Pending branches | Action for the writer |
|---|---|---|---|---|---|---|---|
| 6.1 | Golden set: 50 questions, 6 real DBS lectures | 06-evaluation.tex:39-40 | n/a (added later) | `backend/eval/data/golden_set.json` on main: 50 questions, 6 distinct `lecture_id` | yes | none | W |
| 6.2 | Run at production k/threshold, `retrieval.py:30-32` | 06:41 | yes | `DEFAULT_K=5`, `DEFAULT_THRESHOLD=0.65`, `DEFAULT_COURSE_K=6` | same | none | W |
| 6.3 | The other three metrics are not measured: `golden_sets.py` uses synthetic `deck_id`, and `LivePipeline` raises | 06:41-46 | n/a | `backend/eval/golden_sets.py:23,34,43` (`deck_id: str`); `backend/eval/pipeline.py:97` (`raise ValueError`) | yes | none | W |
| 6.4 | P@k passes its band at k=5 and k=6, within a few points of the ceiling | 06:46-48 | n/a | `thesis/results/20260917T214528Z/grid_results.md`: lecture k=5 P@k 0.184 (ceiling 0.200), course k=6 0.160 (ceiling 0.167). Band ≥ 0.150 (`f19-results.puml:16-17`) | yes | none | W |
| 6.5 | The refusal gate cost nothing (0% false refusals) | 06:48-49 | n/a | course_hybrid: refusal 0.000 and false refusal 0.000, n=27. lecture_dense: refusal 0.020, a **hypothetical** gate the lecture tutor no longer has (`retrieval_grid.py:320-323`). The real gate belongs to the course tutor, which is unreachable by default (`FEATURE_GLOBAL_SEARCH` off). Run commit was `a696be1-dirty`, not 0be0081 | yes | none | C: "the course tutor's gate, which the default deployment does not expose; n=27" |
| 6.6 | 23 of 50 questions unattemptable in course_hybrid because their lecture has no `course_id` | 06:49-51 | n/a | 23 of 50 entries have empty `course_id`; grid `Skip=23` | yes | none | W |
| 6.7 | Method: four independent readers; every claim checked against source at `0be0081` | 06:62-65 | yes (self-reported) | `ARCHITECTURE_PRIMER.md:15-16`; `2f6d566` message. `\thesisCommit = 0be0081` (`thesis/metadata.tex:26`). **Threat:** the 0be0081 commit message records that prod ran `deploy/egress-hotfix @ 39c6590` (355 files behind) | n/a | none | W, and add the prod-version threat to §Threats |
| 6.8 | Every feature flag defaults to off; deployed product is a strict subset | 06:84-87 | yes | = #3.3 (7 backend flags + 3 frontend flags, all off by default) | same | none | W |
| 6.9 | Three inconsistent half-states (frontend flag on, backend off) showing a nav entry whose endpoint 404s | 06:90-92 | partly / not in code | Frontend flags are **off** in code (`featureFlags.ts:8-10`); "on" would come from a build-time root `.env` that is not in git. Only **two** pairs exist (reviewEngine, studentUploads). Exam has **no frontend flag**: `src/lib/routes.ts:24-26` is unconditional while `FEATURE_EXAM_MODE` is off (`main.py:256-257`) | same | none | P: `grep VITE_FEATURE /root/ascend-academy/.env` and `docker exec <api> env \| grep FEATURE_`. Then C: "two flag mismatches plus one unflagged UI" |
| 6.10 | Env files excluded from the image cause local/deployed divergence | 06:92-94 | yes | `.dockerignore:28` (`**/.env`). Prod compose loads only root `.env` (`docker-compose.prod.yml:71,104,182`). `backend/.env` contents are not in git | same | none | W |
| 6.11 | A single default empties three database tables | 06:94-95 | partly | `FEATURE_COURSE_BRAIN=False` (`config.py:134`) gates pipeline concept ingestion (`unified_orchestrator.py:934-939`). But `concepts_router` is mounted unconditionally (`main.py:242`) with `POST /concepts/ingest/{lecture_id}` (`api/v1/concepts.py:37-59`). And `concept_mastery` is empty for a **different** reason: concept cards were never built (`review/mastery.py:6-12`, `card_factory.py:8-20`) | same | none | C: "one default idles pipeline concept ingestion; `concept_mastery` is empty independently". P: row counts |
| 6.12 | Production default is the least-tested configuration; tests force two flags on | 06:95-96 | yes | `backend/tests/conftest.py:32-33` (`setdefault` `FEATURE_REVIEW_ENGINE`/`FEATURE_EXAM_MODE` = "1") | same | none | W |
| 6.13 | Citations are computed and validated server-side | 06:106-107 | yes | `tutor.py:106-133, 211-212` | same | none | W |
| 6.14 | The clickable citation component exists and is imported nowhere | 06:107-108 | yes | `src/components/LectureChat.tsx` is referenced only by its own test and a `vi.mock` in `src/__tests__/pages/LectureView.test.tsx:152` | same (`:163`) | none | W |
| 6.15 | The two live student surfaces ignore the field or substitute a label from the visible slide | 06:108-110 | yes | `src/pages/LectureView.tsx:43` (`ChatMessage` has no citations), `:1028, :1031` (`data.citations` never read). `src/features/student/components/InlineLecturePlayer.tsx:232, 830-832, 1481-1483` ("Grounded in {sourceLabel}" = the current slide) | same. The `5e020eb` edits are unrelated. The v4 `features/spaces` reader renders citations from **mock fixtures only** | none | W |

## Primer Part 6 — "Documented claims that do not hold" (ledger rows L1–L12)

| # | Claim (short) | Thesis location | @0be0081 | Evidence @0be0081 | @origin/main | Pending branches | Action for the writer |
|---|---|---|---|---|---|---|---|
| L1 | README "Parser v3.0" headline; v3/v4 archived; `PARSER_VERSION` selects nothing | primer:764; 06:68-73 | yes | `README.md:5-7`. `services/parser/__init__.py:12-13`. `services/upload_service.py:258-262` (logs "is retired", runs v5 anyway) | README unchanged | `6161e00` deletes `_legacy` (archived → deleted) | W |
| L2 | "Local embeddings — FastEmbed" | primer:765 | yes | `README.md:11` vs `services/ai/embeddings.py:13-14` (`gemini-embedding-001`, 768) | same | none | W |
| L3 | "Resumable jobs" | primer:766 | yes | `README.md:12` vs `unified_orchestrator.py:637-644` (`clear_lecture_content`). The `parse_pages` checkpoint helpers are called only from `_legacy` | same | none | W |
| L4 | "Memory-safe ~150 MB" | primer:767 | yes (structurally) | `README.md:10`. v5 holds `pdf_bytes` for the whole job (`unified_orchestrator.py:549, 657, 663, 727`) plus all page text (`raw_slides`, :559). Memory itself was not measured | same | none | W (say "not measured") |
| L5 | "Generator-aware routing" | primer:768 | yes | = #4.9 / #4.10 | same | `6161e00` | = #4.10 |
| L6 | "LiteLLM proxy" (README, GDPR doc) | primer:769 | yes | `README.md:42`; `docs/GDPR_DATA_PROTECTION.md:23` | **fixed** by `2f6d566` (both rewritten) | none | F (2f6d566) |
| L7 | `max_tries = 5` "with exponential backoff for transient failures" | primer:770 | yes | `workers/arq_worker.py:286-287` (primer says :283). The same claim repeats at `services/analytics_rollup.py:28` | same | PR #72 touches `arq_worker.py` but not this | W (fix the line number; cite both sites) |
| L8 | Tutor docstring claims a deterministic refusal | primer:771 | yes | `services/ai/tutor.py:4-9` vs `:176-178` (`has_scope` dead) | same | none | W |
| L9 | `PRODUCTION_INFRA_GUIDE.md`: external LB, autoscaling, CDN, `/health` | primer:772 | partly | `PRODUCTION_INFRA_GUIDE.md:6, 9, 20` are **prescriptive** ("Use an external load balancer…"), not descriptive. Reality: `docker-compose.prod.yml:126` (`--workers 1`), healthcheck `/health/ready` (:140-146). Also `Dockerfile:44` says `--workers 2` (overridden) | same | none | C: "unrealised deployment guidance", not "a false claim" |
| L10 | `.env.example` "PARSER_VERSION 2 (default), 3, or 4" | primer:773 | yes | `.env.example:97` vs `core/config.py:67` (default "5") | still wrong (`.env.example:109`) | `6161e00` still wrong (`:126`) | W |
| L11 | Roadmap BULK chain "cerebras→groq_fast→gemma" | primer:774 | yes | `docs/ROADMAP_10X.md:40` vs `orchestrator.py:245` (9 entries, cloudflare third) and `:251` (QUALITY headed by cerebras) | still wrong (`:42`, after `30168f8`) | none | W |
| L12 | `tutor_messages` = "AI chat transcripts" in the GDPR-export gap | primer:775 | yes | `docs/MILESTONE_2026_08.md:195` (primer says :197). The table has no reads/writes outside the Pydantic model and generated types | same | none | W |

## Primer Part 6 — "Built but not deployed"

| # | Claim (short) | Thesis location | @0be0081 | Evidence @0be0081 | @origin/main | Pending branches | Action for the writer |
|---|---|---|---|---|---|---|---|
| B1 | All seven backend flags default off | primer:779-781 | yes | = #6.8 | same | none | = #6.8 |
| B2 | Review / My Materials: frontend **ON**, backend OFF | primer:788-789 | not in code | = #6.9 | same | none | P (= #6.9) |
| B3 | Exam mode: no frontend flag, backend OFF, so a dead end | primer:790 | yes (code) | `src/lib/routes.ts:24-26`; `main.py:256-257` | same | none | W |
| B4 | Tests force two flags on | primer:796-797 | yes | = #6.12 | same | none | = #6.12 |
| B5 | Locally 22 routers mount; prod serves 17–19 | primer:798-801 | yes (code) | 18 unconditional plus 4 flag-gated routers = 22 (`backend/main.py:234-264`). The prod count depends on env | same | none | P: `curl` `/openapi.json` on prod and count path prefixes |

## Primer Part 6 — "Known-broken paths"

| # | Claim (short) | Thesis location | @0be0081 | Evidence @0be0081 | @origin/main | Pending branches | Action for the writer |
|---|---|---|---|---|---|---|---|
| K1 | PPTX upload can't work in Docker (no `soffice`) | primer:806 | yes | `Dockerfile:30-33` installs only curl; `upload_service.py:228-237` routes `.pptx` through `office_convert.to_pdf` | **mitigated** by `2f6d566`: fail-fast rejection when LibreOffice is absent; `/upload/config` stops advertising `.pptx`. Still unsupported | none | F (2f6d566: "silently broken" → "explicitly unsupported") |
| K2 | OCR fallback always returns `""` | primer:807 | true but not a live path | `services/ocr_fallback.py` is imported only by the retired `file_parse_service.parse_pdf_stream` (no callers). See `requirements-docker.txt` note on main :53-58 | `pytesseract` dropped from the image (`2f6d566`) | none | D (dead code, not a broken user path) |
| K3 | Embeddings silently write 768 zeros when `GEMINI_API_KEY` is missing | primer:808 | yes (latent; key set in prod per `2f6d566` msg) | `services/ai/embeddings.py:26-31` | **fixed** `2f6d566` (`EmbeddingUnavailableError`, plus a zero-vector backstop) | none | F (2f6d566) |
| K4 | Embeddings are fire-and-forget; a parse can complete with them lost | primer:809 | yes | `unified_orchestrator.py:795` (`asyncio.create_task`, result not retained) | **fixed** `2f6d566` (`embed_tasks` joined with a timeout; `:691, :808, :940`). The retry queue is now drained | none | F (2f6d566) |
| K5 | v5 embeddings stamped `pipeline_version = "2"` | primer:810 | yes | `services/file_parse_service.py:79, 834-836, 854-861` | same (deliberately kept; see the `2f6d566` msg) | none | W |
| K6 | `needs_review` never cleared on save | primer:811 | partly | = #5.16 | same | none | = #5.16 |
| K7 | Batch review is not an approval gate | primer:812 | yes | = #5.14 | same | none | = #5.14 |
| K8 | "Done reviewing" is localStorage-only | primer:813 | yes | = #5.15 | same | none | = #5.15 |
| K9 | `FeedbackWidget` matches `/exams/...`; the real routes are `/exam/...` | primer:814 | yes | `src/components/FeedbackWidget.tsx:55-70` vs `src/lib/routes.ts:24-26` | same | none | W |
| K10 | Three badges never seeded | primer:815 | yes | = #4.20 | same | none | = #4.20 |
| K11 | `slides.embedding` in prod with no migration | primer:816 | yes (migration part) | = #4.21 | same | none | = #4.21 (P) |
