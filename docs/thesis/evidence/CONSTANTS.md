# Verified system constants: evidence for Appendix A

Every value below was read with `git show 0be0081:<path>` / `git grep -n <pat> 0be0081`
(thesis audit revision, `\thesisCommit` in `thesis/metadata.tex`) and re-checked at
`origin/main` = `6b4333a` (2026-09-17, fetched 2026-10-10). No `.env*` file was read. So
for any env-overridable constant, the value **in production is unverified**. The table gives the code
default and the variable that overrides it. Production reads its env from `.env` via
`env_file:` in `docker-compose.prod.yml`. The only `environment:` entries there are
`REDIS_URL`, `REDIS_QUEUE_URL` and `ALLOWED_ORIGINS`, so no constant below is pinned in version control.

Status key:
- **ok**: the cited value and line are correct at 0be0081.
- **line-wrong**: the value is right, but the appendix/primer line was already wrong at 0be0081. The line was never correct at any of the 15 preceding commits that touched the file, so this is not drift.
- **file-wrong**: the cited file does not hold the constant.
- **line-moved**: correct at 0be0081, but the line differs at main.
- **value-wrong**: the value is wrong.
- **new**: the constant is not yet in either table.

Of the 15 source files cited, only three changed between 0be0081 and main:
`upload_service.py` (+9), `unified_orchestrator.py`, and `embeddings.py`. In `embeddings.py` the
zero-vector fallback was replaced by `EmbeddingUnavailableError`, which is a behaviour change
and leaves the constants unchanged. All other lines below are identical at both revisions.

## A. The 13 rows currently in `appendix-a-constants.tex`

| # | Constant | Value @0be0081 | Full path:line @0be0081 | Value @main | path:line @main | Env override | Status |
|---|---|---|---|---|---|---|---|
| 1 | Maximum upload size | 50 MB | `backend/core/config.py:87` | 50 MB | `backend/core/config.py:87` | `MAX_UPLOAD_MB` | **line-wrong** (cited `:85`) |
| 2 | Maximum pages per document | 300 | `backend/services/upload_service.py:13` | 300 | same `:13` | none (hardcoded) | ok |
| 3 | Maximum files per batch | 30 | `backend/core/config.py:89` | 30 | `:89` | `MAX_BATCH_FILES` | **line-wrong** (cited `:88`) |
| 4 | Worker concurrency | 4 | `backend/core/config.py:93` (consumed at `backend/workers/arq_worker.py:278`) | 4 | `:93` | `ARQ_MAX_JOBS` | **line-wrong** (cited `:92`) |
| 5 | Queue depth limit (→ HTTP 429) | 50 | `backend/core/config.py:98` | 50 | `:98` | `ARQ_MAX_QUEUE_DEPTH` (0 disables) | **line-wrong** (cited `:99`) |
| 6 | Job timeout | 900 s | `backend/workers/arq_worker.py:281` | 900 s | `:281` | none | **line-wrong** (cited `:277`) |
| 7 | Synthesis batch size | 8 slides | `backend/services/ai/orchestrator.py:86` (fallbacks `:88`, `:95`) | 8 | `:86` | `QUIZ_BATCH_SIZE` (read via `os.environ`, not `Settings`) | **line-wrong** (cited `:85`) + env-overridable. Note: `replit.md:117` documents the default as 5 (stale doc) |
| 8 | Text-versus-vision threshold | 25 chars | `backend/services/parser/unified_orchestrator.py:67` | 25 | `:67` | none | **line-wrong** (cited `:64`) |
| 9 | Embedding dimensions | 768 | `backend/services/ai/embeddings.py:14` | 768 | `:14` | none | ok |
| 10 | Retrieval top-k (lecture / course) | 5 / 6 | `backend/services/ai/retrieval.py:30,32` | 5 / 6 | `:30,32` | none (per-call arg) | ok |
| 11 | Similarity threshold | 0.65 | `backend/services/ai/retrieval.py:31` | 0.65 | `:31` | none (per-call arg) | ok |
| 12 | Context cap (total) | 10,000 chars | `backend/services/ai/tutor.py:38` | 10,000 | `:38` | none | ok |
| 13 | Monthly per-user LLM cap | $5.00 | `backend/core/config.py:173` (`Field(`; `default=5.0` on `:174`) | $5.00 | `:173–174` | `LLM_MONTHLY_USER_COST_CAP_USD` (0 disables) | ok. Only enforced on calls that pass a `user_id` (comment `config.py:169–172`) |

## B. Rows only in the primer (`ARCHITECTURE_PRIMER.md` §Appendix)

| Constant | Value @0be0081 | Full path:line @0be0081 | Value @main | path:line @main | Env override | Status |
|---|---|---|---|---|---|---|
| nginx request-body limit | 55 MB | `nginx.conf:66` | 55 MB | `:66` | none (baked into the image at build time) | **line-wrong** (primer `:54`) |
| Parse job lock TTL | 1200 s | `backend/services/parser/unified_orchestrator.py:58` | 1200 s | `:58` | none | **file-wrong**: the primer cites `job_locks.py:49`, which is only the generic `SET NX EX` call. The value lives in `unified_orchestrator.py` |
| RRF constant | 60 | `backend/services/ai/retrieval.py:251` | 60 | `:251` | none | ok |
| Query-embedding cache TTL | 600 s | `backend/services/ai/retrieval.py:41` | 600 s | `:41` | none | ok |
| Context cap (per slide) | 2,400 chars | `backend/services/ai/tutor.py:39` | 2,400 | `:39` | none | ok |
| History window | 5 turns × 1,000 chars | `backend/services/ai/tutor.py:40–41` | same | `:40–41` | none | ok |
| User message cap | 2,000 chars | `backend/api/v1/ai_content.py:53` (also `backend/services/ai/tutor.py:37`) | 2,000 | `:53` | none | ok (primer range `:51–59` contains it; narrow to `:53`) |
| LLM call timeout | 25 s | `backend/services/llm_client.py:72` | 25 s | `:72` | `LLM_TIMEOUT_SECONDS` | primer gave no line. **Env-overridable.** `config.py:76` says gpt-4o-mini "wants ~90", and prod is believed to run gpt-4o-mini, so the prod value may not be 25 (unverified) |
| SM-2 ease min / default | 1.3 / 2.5 | `backend/services/review/scheduler.py:20–21` | same | `:20–21` | none | primer `scheduler.py:20-30` is **ambiguous**: two `scheduler.py` files exist (`backend/services/scheduler.py` is unrelated). Use `review/scheduler.py` |
| SRS intervals 1 d / 6 d, "again" → 10 min | 1.0 / 6.0 d / 10 min | `backend/services/review/scheduler.py:25,26,29` | same | same | none | same ambiguity as above |
| New cards per queue call / total cap | 20 / 100 | `backend/api/v1/review.py:38–39` | same | `:38–39` | none (query-param defaults) | ok |
| Default exam length | 30 questions | `backend/api/v1/exams.py:80` | 30 | `:80` | none | ok (primer `:79–81`; narrow to `:80`) |
| OpenAI daily fleet ceiling | $10.00 | `backend/core/config.py:166` (`default=10.0` on `:167`) | $10.00 | `:166–167` | `LLM_OPENAI_DAILY_COST_CEILING_USD` (0 disables) | ok |

## C. New constants the chapter TODO briefs depend on

Each row gives the chapter brief that needs it.

| Constant | Value @0be0081 | Full path:line @0be0081 | Value @main | path:line @main | Env override | Status / brief |
|---|---|---|---|---|---|---|
| Student uploads per month | 5 | `backend/core/config.py:123` | 5 | `:123` | `STUDENT_UPLOAD_MONTHLY_LIMIT` | new (NFR upload limits, 03) |
| SSE heartbeat (comment ping) | 20 s | `backend/services/upload_service.py:321` | 20 s | `backend/services/upload_service.py:330` | none | new, **line-moved** (04 §async) |
| nginx proxy read/send idle timeout | 120 s | `nginx.conf:52–53` | 120 s | `:52–53` | none | new (04 §async) |
| Arq `max_tries` | 5 | `backend/workers/arq_worker.py:287` | 5 | `:287` | none | new (04 §failure). Per the brief it does not apply to ordinary exceptions. Prod image installs `arq>=0.26,<0.27` (`backend/requirements-docker.txt:38`) while `backend/requirements.txt:33` pins `0.28.0`, so verify the claim against 0.26 |
| Arq result retention | 604,800 s (7 d) | `backend/workers/arq_worker.py:284` | same | `:284` | none | new (04 §async, SSE replay) |
| Worker heartbeat interval / TTL | 30 s / 90 s | `backend/workers/arq_worker.py:41`; `backend/core/worker_heartbeat.py:23` | same | same | none | new (04 §architecture, `/health/ready`) |
| Stalled-run reconciler cutoff | 25 min | `backend/workers/arq_worker.py:48` | 25 min | `:48` | none | new (04 §failure) |
| Reconciler sweep interval | 10 min | `backend/workers/arq_worker.py:53` (cron at `:257`) | same | same | none | new (04 §failure) |
| Review-card lock TTL | 300 s | `backend/services/review/card_factory.py:39` | 300 s | `:39` | none | new (04 §idempotency) |
| Synthesis batch context overlap | 1 slide | `backend/services/ai/orchestrator.py:90` | 1 | `:90` | `QUIZ_BATCH_OVERLAP` | new (04 §pipeline) |
| LLM rate-limit retry budget | 8 attempts | `backend/services/llm_client.py:36` | 8 | `:36` | none | new (04 §provider (3)) |
| LLM retry backoff | exp., ×2, 4–60 s | `backend/services/llm_client.py:37` | same | `:37` | none | new. Tenacity waits 4, 4, 8, 16, 32 s, so inside the 25 s `wait_for` (`:74`) at most 4 attempts can start (3 with ~3 s failing calls). "Near three" holds only at 25 s; at a 90 s prod timeout about 5–6 attempts fit |
| Provider registry size / chain length | 9 entries; both chains 9 | `backend/services/ai/orchestrator.py:150` (registry), `:245` (BULK), `:251` (QUALITY) | same | same | API-key env vars per entry | new (04 §provider). `groq`/`groq_fast` share `GROQ_API_KEY` and `gemini`/`gemma` share `GEMINI_API_KEY`: 4 entries on 2 keys, as the brief says |
| Vision model (default) | `gemini-2.0-flash` | `backend/core/config.py:71` | same | `:71` | `VISION_MODEL` | new (04 §routing) |
| Parser bulk LLM (default) | `cerebras` | `backend/core/config.py:77` | same | `:77` | `PARSER_LLM_MODEL` | new. **The prod value differs from the default** (believed to be gpt-4o-mini per the project's memory; unverified, .env not read) |
| Embedding model | `gemini-embedding-001` | `backend/services/ai/embeddings.py:13` | same | `:13` | none | new (05 §retrieval) |
| Anchor-slide synthetic similarity | 0.0 | `backend/services/ai/retrieval.py:177` | 0.0 | `:177` | none | new (05 §retrieval) |
| Quiz questions per slide | 1 | `backend/services/ai/prompts.py:97` | 1 | `:97` | none | new (05 §assessment) |
| Options per question | 4 (1 correct + **3** distractors) | `backend/services/ai/prompts.py:100`; enforced `backend/services/ai/quiz_validator.py:98` | 4 | same | none | new. **The 05 brief says "four plausible ... distractors", which is wrong: there are 4 options, so 3 distractors.** The prompt wording "All four options must be plausible distractors" (`prompts.py:112`) is the likely source |
| SM-2 rating scale | 1–4 (again/hard/good/easy) | `backend/services/review/scheduler.py:58` | same | `:58` | none | new (02 §srs) |
| SM-2 lapse ease penalty | −0.20 | `backend/services/review/scheduler.py:65` | same | `:65` | none | new (02 §srs) |
| SM-2 ease delta (hard/good/easy) | −0.15 / 0 / +0.15 | `backend/services/review/scheduler.py:82` | same | `:82` | none | new (02 §srs) |
| SM-2 interval multiplier (easy bonus) | ×1.3 (hard/good ×1.0) | `backend/services/review/scheduler.py:83` | same | `:83` | none | new (02 §srs) |
| Mock-exam size bounds | 20–40 questions | `backend/api/v1/exams.py:42–43` | same | `:42–43` | none | new (05 §srs-impl) |
| Mock-exam time limit / grace | 45 min / 30 s | `backend/api/v1/exams.py:44–45` | same | `:44–45` | none | new (05 §srs-impl) |
| Mock-exam seed | 63-bit, `SystemRandom` (server-side) | `backend/api/v1/exams.py:110` | same | `:110` | none | new (05 §srs-impl, "cannot replay") |
| Exam sampler minimum weight | 0.05 | `backend/services/exam_service.py:23` | same | `:23` | none | new (05 §srs-impl) |
| Exam difficulty boost (hard/medium/easy) | 1.2 / 1.0 / 0.8 | `backend/services/exam_service.py:24` | same | `:24` | none | new (05 §srs-impl) |
| Unseen-concept weakness weight | 0.5 (neutral) | `backend/services/exam_service.py:88` | same | `:88` | none | new (05 §srs-impl) |

Row counts: A = 13 (6 line-wrong, 0 value-wrong). B = 13 (1 line-wrong, 1 file-wrong, 2 with an
ambiguous basename, 1 with no line). C = 28 new (1 line-moved at main). That makes 54 constants in total; the LaTeX block has 53 rows (the parser default is left out).

## LaTeX: drop-in longtable body for `appendix-a-constants.tex`

The rows use 0be0081 values and lines and replace the 13 existing rows plus the `\TODO{remaining rows}` line.
Basenames are kept except for `review/scheduler.py`, because `backend/services/scheduler.py` also exists.

```latex
  % --- Ingestion: admission control ---
  Maximum upload size                    & 50\,MB          & \code{config.py:87} \\
  nginx request-body limit               & 55\,MB          & \code{nginx.conf:66} \\
  Maximum pages per document             & 300             & \code{upload\_service.py:13} \\
  Maximum files per batch                & 30              & \code{config.py:89} \\
  Student uploads per month              & 5               & \code{config.py:123} \\
  Worker concurrency                     & 4               & \code{config.py:93} \\
  Queue depth limit                      & 50              & \code{config.py:98} \\
  % --- Ingestion: asynchronous processing ---
  Job timeout                            & 900\,s          & \code{arq\_worker.py:281} \\
  Job retry limit (\code{max\_tries})    & 5               & \code{arq\_worker.py:287} \\
  Job result retention                   & 7\,days         & \code{arq\_worker.py:284} \\
  SSE heartbeat interval                 & 20\,s           & \code{upload\_service.py:321} \\
  Proxy idle timeout                     & 120\,s          & \code{nginx.conf:52} \\
  Worker heartbeat interval / TTL        & 30\,s / 90\,s   & \code{arq\_worker.py:41}, \code{worker\_heartbeat.py:23} \\
  Stalled-run reconciler cutoff          & 25\,min         & \code{arq\_worker.py:48} \\
  Reconciler sweep interval              & 10\,min         & \code{arq\_worker.py:53} \\
  Parse job lock TTL                     & 1200\,s         & \code{unified\_orchestrator.py:58} \\
  Review-card job lock TTL               & 300\,s          & \code{card\_factory.py:39} \\
  % --- Ingestion: routing and synthesis ---
  Text-versus-vision threshold           & 25 chars        & \code{unified\_orchestrator.py:67} \\
  Vision model (default)                 & \code{gemini-2.0-flash} & \code{config.py:71} \\
  Synthesis batch size                   & 8 slides        & \code{orchestrator.py:86} \\
  Synthesis batch context overlap        & 1 slide         & \code{orchestrator.py:90} \\
  Quiz questions per slide               & 1               & \code{prompts.py:97} \\
  Options per question                   & 4 (3 distractors) & \code{quiz\_validator.py:98} \\
  % --- LLM provider strategy ---
  Provider registry entries              & 9               & \code{orchestrator.py:150} \\
  LLM call timeout                       & 25\,s           & \code{llm\_client.py:72} \\
  LLM rate-limit retry attempts          & 8               & \code{llm\_client.py:36} \\
  LLM retry backoff                      & 4--60\,s, exp.  & \code{llm\_client.py:37} \\
  Monthly per-user LLM cap               & \$5.00          & \code{config.py:173} \\
  OpenAI daily fleet ceiling             & \$10.00         & \code{config.py:166} \\
  % --- Grounded tutor ---
  Embedding model                        & \code{gemini-embedding-001} & \code{embeddings.py:13} \\
  Embedding dimensions                   & 768             & \code{embeddings.py:14} \\
  Retrieval top-$k$ (lecture / course)   & 5 / 6           & \code{retrieval.py:30,32} \\
  Similarity threshold                   & 0.65            & \code{retrieval.py:31} \\
  Anchor-slide synthetic similarity      & 0.0             & \code{retrieval.py:177} \\
  RRF constant                           & 60              & \code{retrieval.py:251} \\
  Query-embedding cache TTL              & 600\,s          & \code{retrieval.py:41} \\
  Context cap (total / per slide)        & 10\,000 / 2\,400 chars & \code{tutor.py:38--39} \\
  History window                         & 5 turns $\times$ 1\,000 chars & \code{tutor.py:40--41} \\
  User message cap                       & 2\,000 chars    & \code{ai\_content.py:53} \\
  % --- Spaced repetition (SM-2) ---
  Rating scale                           & 1--4            & \code{review/scheduler.py:58} \\
  Ease factor minimum / initial          & 1.3 / 2.5       & \code{review/scheduler.py:20--21} \\
  Graduating intervals                   & 1\,d / 6\,d     & \code{review/scheduler.py:25--26} \\
  Relearning interval (``again'')        & 10\,min         & \code{review/scheduler.py:29} \\
  Ease penalty on lapse                  & $-0.20$         & \code{review/scheduler.py:65} \\
  Ease delta (hard / good / easy)        & $-0.15$ / 0 / $+0.15$ & \code{review/scheduler.py:82} \\
  Easy interval bonus                    & $\times 1.3$    & \code{review/scheduler.py:83} \\
  New cards per queue call / total cap   & 20 / 100        & \code{review.py:38--39} \\
  % --- Mock exams ---
  Exam length (default / min / max)      & 30 / 20 / 40    & \code{exams.py:80,42--43} \\
  Exam time limit / grace period         & 45\,min / 30\,s & \code{exams.py:44--45} \\
  Exam sampling seed                     & 63-bit, server-side & \code{exams.py:110} \\
  Sampler minimum weight                 & 0.05            & \code{exam\_service.py:23} \\
  Difficulty boost (hard / medium / easy)& 1.2 / 1.0 / 0.8 & \code{exam\_service.py:24} \\
  Unseen-concept weight                  & 0.5             & \code{exam\_service.py:88} \\
```

Notes for the prose:
- Rows whose value is an env default: upload size, batch files, student uploads, concurrency,
  queue depth, vision model, synthesis batch size and overlap, LLM timeout, and both cost caps.
  The appendix intro could add a sentence saying the table records *code defaults*, and that
  production may override them through environment variables not held in version control.
- The parser's bulk LLM default (`cerebras`, `config.py:77`) is left out of the LaTeX block on
  purpose. Production overrides it, so printing the default would mislead.
