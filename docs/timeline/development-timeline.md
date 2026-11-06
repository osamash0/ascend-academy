# Learnstation: development timeline

*Written 2026-11-04 for the bachelor thesis "From Lecture Materials to Structured Educational Content: Design and Implementation of an AI-Assisted Learning Platform". Covers 2026-01-23 to 2026-11-02. Built from the git history of all refs, the 171 GitHub pull requests and the documents in the repo. The detail, with every source, is in the phase files `01-…md` to `10-…md`; the method and raw counts are in `00-overview.md`.*

**How to read the markers.** **[C]** (Confirmed) means a commit, PR, doc or comment states the reason. **[I]** (Inferred) means the reason is a best guess from the code or the order of events. Where neither is possible, the item is listed under "Open questions". Commit counts measure activity, not hours worked.

---

## 1. The project at a glance

| # | Phase | Dates | Commits¹ | Active days | AI co-authored² | Main focus of the work (share of changed lines) |
|---|---|---|---:|---:|---:|---|
| 1 | Prototype | 01-23 to 03-12 | 77 | 7 | 0% | classic frontend 81% |
| 2 | Two branches become one | 03-13 to 04-29 | 56 | 12 | 21% | classic frontend 71%, backend 12% |
| 3 | Parsing pipeline and the feature burst | 04-30 to 06-09 | 177 | 18 | 73% | frontend 33%, docs 15%, backend 14%, tests 13% |
| 4 | Pipeline unification and the feature audit | 06-10 to 06-30 | 51 | 12 | 55% | backend 31%, tests 32%, frontend 17% |
| 5 | 10x roadmap and the platform foundation | 07-01 to 07-31 | 164 | 18 | 57% | frontend 30%, backend tests 24%, backend 14% |
| 6 | Consolidation and the whole-app audit | 08-01 to 08-28 | 117 | 6 | 74% | tests 27%, frontend 20%, thesis 19%, docs 16% |
| 7 | The v4 redesign and the thesis apparatus | 08-29 to 09-30 | 159 | 10 | 73% | v4 frontend 55%, thesis 16% |
| 8 | Reader intelligence, Luna, launch prep | 10-01 to 10-19 | 377 | 6 | 99% | v4 frontend 49%, docs 18% |
| 9 | v4 live for real people | 10-20 to 10-30 | 337 | 5 | 92% | docs 29%, v4 frontend 21%, parser 20% |
| 10 | Evaluation and polish | 10-31 to 11-04 | 84 | 3 | 95% | parser benchmark 67%, tests 21% |

¹ Non-merge commits on all refs (1,599 in total). ² Commits with a Claude co-author trailer or author, plus the 111 commits of Abdullah's third git account on 05-02/03, which look like the Replit Agent [I]. Line shares come from `git log --numstat`, without lockfiles and images; they are rough.

**Three things stand out.**

1. **The PDF-to-content pipeline was rebuilt again and again.** Counting generously, there were eight generations in ten months (table in §3). Several of them existed side by side in the code. This is the thesis core, and it is where most of the design decisions are.
2. **The interface was built twice.** The "classic" app (professor and student rooms, courses, lectures) took until August. Then a new design, v4 (Spaces, Library, a reading-first Lesson reader), was built beside it from 08-30. It replaced the classic rooms for students on 10-26 and became what production serves on 10-29.
3. **The way of working changed.** Two developers on personal branches (Jan to Apr) became one trunk with pull requests (from 04-26), then mostly one developer, Abdullah, directing AI coding agents (Replit Agent in May; Claude Code from April and almost exclusively from October; Codex at the end). Half of all commits fall in October.

## 2. Where the time went

- **Calendar time vs activity.** The work came in bursts with long quiet gaps: 03-13 to 04-20 (only Osama's branch was active), 08-01 to 08-14, and 09-19 to 10-09. Phases 8 and 9 hold 714 commits on only 11 active days. That was possible because several agent sessions ran at once on one machine [C: `CLAUDE.md`, "Abi runs several Claude sessions on one working tree"].
- **The pipeline and the AI layer** took steady effort in every phase, but the biggest pushes were 04-28 to 06-17 (v2, v3, v4, v5 in seven weeks), 10-10 to 10-16 (deck plan, quiz grounding, cost) and 10-30 to 11-01 (the benchmark).
- **Rework hotspots.** The files that kept changing are the ones that held the core experience: `LectureView.tsx` (the classic reader: 30 commits in Phase 1, 33 in Phase 3), `upload.py` and `unified_orchestrator.py` (the pipeline entry points), `orchestrator.py` (the LLM provider chain), and later `LessonFacesScreen.tsx` (the v4 reader: 43 commits in Phase 8, 31 in Phase 9) and `StudioCanvasScreen.tsx` (17 fix commits for a surface that stayed behind a flag).
- **Testing and quality work grew over time.** Tests went from almost nothing (Phase 1 and 2) to about a quarter of all changed lines in Phases 4 to 6. Docs took 15 to 29% in Phases 3, 6, 8 and 9, mostly audits, plans, runbooks and corrections of stale docs.
- **Hardening came in waves:** a security pass (03-11), PR reviews (#1 to #6, 04-26 to 04-29), an agent security sweep (05-02), the feature audit (06-28), the foundation fleet (07-21), the whole-app audit and overnight fixes (08-17/18), the codebase audit weeks (10-24) and the documentation reset (10-30). Each wave found problems the earlier work had left behind.

## 3. Two lineages that run through every phase

### PDF-to-content pipeline

| Generation | Date | What it did | Fate |
|---|---|---|---|
| v1 "slide enhancement" | 02-24 | One LLM call per page at upload, via Ollama, then Gemini/Groq; original page shown next to the AI text (`4c23d254`, `86379610`) | replaced 05-01 |
| content filter | 03-20 | Pattern check, then density score, then LLM judge: non-teaching pages get no AI content (Osama's branch) | folded into later routing |
| v2 routed pipeline | 05-01 | Each page classified, then sent to text, OCR or vision; deck-level "pedagogical blueprint"; Cerebras (`7ffb0cd2`) | the default until June |
| v3 staged pipeline | 05-02 to 05-19 | Seven resumable stages, Docling, Arq job queue, FastEmbed, pgvector, LiteLLM gateway (`6ce7b5f1`); released as "v3.0" on 06-09 | never the default; later called "dormant" (`e6f039dc`) |
| v4 orchestrator | 05-28 | AI stage for every external extractor (Osama, `86270c2c`) | sent 142 of 143 slides of a real deck to text (`4f19bd1e`) |
| v5 "unified" | 06-17 | One server-side orchestrator: v2 routing, v3 run table, v4 prompts, vision-capable, server writes the result (`4f19bd1e`, `bd03f1d5`) | the single path from 07-10 (`a65b0f9d`) |
| deck plan first | 10-10 to 10-13 | Plan the deck (roles, sections) with no LLM call, then generate; grounded quiz; parse receipts with cost (#84) | live |
| page by page | 10-26 to 10-30 | Reader opens at once; Luna's content arrives page by page (#139, #145); packed PDF copy for the reader (#132) | live |
| (evaluation) | 10-30 to 11-01 | Blind benchmark of ten extraction methods (#168) | no production change yet |

### LLM providers

Ollama, local (02-24) → Gemini (03-12) → user-selectable Ollama/Gemini, then Groq as default (03-29) → Cerebras primary with a free-tier failover chain (05-02) → LiteLLM gateway container (05-19) → OpenAI-compatible provider, "OpenAI now, self-hosted university LLM later" (06-17, `cd3e39b2`) → gateway removed, providers called directly (08-25, `68a091e0`) → two ordered in-process chains, `BULK_CHAIN` and `QUALITY_CHAIN` (09-18, `a33c0296`) → Cerebras removed from the chains (10-10) → optional "OpenAI-only" mode for launch with spend caps (#92, #98) → an independent answer check on a different provider (Groq) for quiz questions (#166).

---

## 4. The phases

### Phase 1: Prototype (2026-01-23 to 2026-03-12), file `01-prototype.md`

The project started from a generated Lovable scaffold (React, Supabase, a small FastAPI service) [C: first README, "Welcome to your Lovable project"]. Over seven active days it became "Learn Station": a professor uploads a PDF, an LLM rewrites each page into Markdown with a title, summary and quiz question, and students read, answer and ask a slide-aware tutor. All work was on personal branches; `main` held only the first commit until 04-24.

- **02-24:** per-slide AI enhancement with Ollama; original page shown beside the AI text (`4c23d254`).
- **03-02:** live slide sync removed after one week, in favour of self-paced reading with tracked events (`97e71e69`). Reason not recorded.
- **03-11:** security pass: `.env` untracked, JWT check on every backend route, user id removed from RPC calls (`1fcc2bd4`, `c2b21e56`, `5acdb9d7`).
- **03-11/12:** GDPR features: Impressum, privacy policy, consent, export, delete, pseudonymised events (`4d3f572b` to `442d398b`).
- **03-12:** Ollama replaced by Gemini, then both made selectable (`86379610`, `74e57029`); first "RAG" tutor, which in fact put the current slide into the prompt (`f7cf1b92`).

### Phase 2: Two branches become one (2026-03-13 to 2026-04-29), file `02-two-branches-become-one.md`

Osama worked alone on his branch from 03-19: a three-layer content filter, Groq, an auth loading fix and anonymised analytics. On 04-21 to 04-24 the branches were unified and merged into `main`. The last four days held the first six pull requests, written with Claude Code.

- **03-20:** three-layer slide filter (pattern, density, LLM judge) [C: "not every page is teaching content"].
- **04-24:** one trunk; personal branches stop being the source of truth (`27fec458`).
- **04-26 to 04-29:** PRs #1 to #6: security and ownership checks, analytics overhaul, PDFs over ten slides fixed with per-slide SSE streaming, an optional vision path with PyMuPDF, a 21-issue pre-deployment review, and a layered architecture with an `LLMProvider` interface (#6).
- **04-26:** `load_dotenv(override=True)` added to the AI service. It later wrote rows to production during a local test (#99, Phase 8). Reason for adding it is not recorded.

### Phase 3: Parsing pipeline and the feature burst (2026-04-30 to 2026-06-09), file `03-parsing-pipeline-and-feature-burst.md`

The pipeline was rebuilt three times in seven weeks (v2, v3, v4). On 05-02/03 an AI agent produced about 110 commits in one long session: tests and CI, a security sweep, a grounded tutor with citations, English and German, "Ask Your Data", a mind graph. Docker and Sentry came in June, and the phase ended with a "v3.0" release.

- **05-01:** v2 routed pipeline; pdf2image dropped for PyMuPDF (`7ffb0cd2`, `b1c7a428`).
- **05-02:** test pyramid and first CI workflow (`23da3b34`, `docs/TESTING_STRATEGY.md`).
- **05-02:** tutor grounded only in the lecture's slides, with citations and a refusal path (`8d2eb095`).
- **05-03:** "Ask Your Data" uses a fixed intent catalogue, not LLM-generated SQL [C].
- **05-07:** Pipeline Test Lab to compare extractors (LlamaParse, MinerU) by hand (`4b54991e`).
- **05-19:** v3: background job queue (Arq + Redis), LiteLLM gateway, Docling, built beside v2 behind `PARSER_VERSION` (`6ce7b5f1`).
- **06-05 to 06-08:** a Node backend (Hono, better-auth) was added and removed three days later, with no code using it (`d35565d4`, `b9ea605e`).
- **06-09:** "v3.0" release notes say the default is v3; the config still said v2 [C: `CHANGELOG.md` vs `a4fc5abc`].

### Phase 4: Pipeline unification and the feature audit (2026-06-10 to 2026-06-30), file `04-pipeline-unification-and-feature-audit.md`

Four parser paths were folded into one server-side "unified" pipeline (v5). XP and badges moved to a server engine. A 258-story feature audit closed the phase.

- **06-12:** a GPU-server incident (open Redis, unauthenticated LiteLLM) led to dev services bound to loopback (`6a7c8306`).
- **06-15:** gamification moved from client code to one idempotent server engine (`343890c5`).
- **06-16:** "drop, do not default": a quiz question with an unresolvable answer key is removed (`f25dd41c`).
- **06-17:** v5 unified orchestrator: the server, not the browser, writes parse output, and it must handle images [C: v4 sent 142/143 slides to text] (`4f19bd1e`).
- **06-17:** separate bulk and vision models; configurable OpenAI-compatible LLM "OpenAI now, self-hosted university LLM later" (`cd3e39b2`).
- **06-24:** the tutor may add outside knowledge, labelled as such (`f39e93dc`). Reason not recorded.
- **06-28:** feature audit of 258 user stories from the code (`8470f9d8`).

### Phase 5: 10x roadmap and the platform foundation (2026-07-01 to 2026-07-31), file `05-roadmap-and-platform-foundation.md`

A written roadmap drove the month. It brought spaced repetition, exam mode, batch upload, PPTX import, trust signals and a brand voice. Then a "Foundation" audit was carried out as about 30 parallel fix branches merged on 07-21.

- **07-06/07:** 10x roadmap: every feature behind a flag, with EN/DE, RLS tests and typed events; "stabilisation beats new scope" (`docs/ROADMAP_10X.md`).
- **07-10:** one upload pipeline; old ones archived, "flag-not-delete" (`a65b0f9d`).
- **07-11:** SM-2 chosen over FSRS for the review engine; five roadmap features landed in one commit (`4cd58a66`).
- **07-12:** "Calm Competence" brand voice for AI output and UI (`6033f75d`).
- **07-16:** dedicated Redis for the job queue; fail loudly when the queue is down (`43a86927`).
- **07-19 to 07-21:** Foundation roadmap, "risk-reduction and instrumentation come before optimization" [C]. RPC lockdown, idempotency, LLM cost accounting, metrics, AI eval harness, DLQ, event partitioning, migration governance, GDPR posture, secrets and supply chain, continuous security CI.

### Phase 6: Consolidation and the whole-app audit (2026-08-01 to 2026-08-28), file `06-consolidation-and-app-audit.md`

After two quiet weeks the code was spread over 83 branches in 40 worktrees, and production ran an old hotfix branch. On 08-17 everything was folded into one trunk. Five audits were merged into one report, and an overnight agent run fixed most findings (#27 to #50). Thesis groundwork began.

- **08-17:** `main` is the single trunk again; every other branch becomes an `archive/*` tag (#9, `docs/MILESTONE_2026_08.md`).
- **08-17:** Supabase egress overage: decorative PDFs replaced by WebP posters, egress down 97.6% (#12).
- **08-17:** production database reconciled by hand; "never run `supabase db push`" (ledger had 2 of 115 rows).
- **08-17:** Osama's `Refactoring` branch (RBAC, SQLModel) rejected; two ideas kept for later.
- **08-18:** audit fixes #27 to #50: the route guard fails closed, fabricated admin data removed, error vs empty states, enrolment-scoped reads. Deploy deferred: prod was 355 files behind (`0be00814`).
- **08-25:** LiteLLM gateway removed; providers called directly (`68a091e0`). **08-28:** thesis figures and three pipeline fixes (#51).

### Phase 7: The v4 redesign and the thesis apparatus (2026-08-29 to 2026-09-30), file `07-v4-redesign-and-thesis-apparatus.md`

A new product model and interface, v4, was built on mock data beside the classic app. Its object is the Space (roles live inside a Space, not as global professor/student accounts). The thesis got an evaluation harness and a LaTeX skeleton, and CI was made honest.

- **08-30:** v4 design set enters the repo: Spaces, per-Space roles, a vocabulary law (`docs/design-v4/01-foundations.md`). Why a rebuild and not a refactor is not stated.
- **08-31:** mock data behind one seam (`data/useSpaces.ts`); one animation system, Motion (`0dbc641d`); first CI run of v4 (#55).
- **08-31 to 09-16:** study history "a record of days, not a streak system"; Moments replace the badge wall (#58, #61).
- **09-17:** the Lesson Reader: reading is the default, the original page one toggle away (#68).
- **09-08 to 09-17:** evaluation harness: only `retrieval_grid.py` produces thesis numbers and refuses to write results from broken runs (#69); LaTeX skeleton with 19 figures (#52).
- **09-16/17:** "audit what ships"; "verify before you baseline"; stale docs struck through and dated, not deleted (#63 to #67, #70, #71).
- **09-18:** provider failover revived as two in-process chains (`a33c0296`).

### Phase 8: Reader intelligence, Luna, launch prep (2026-10-01 to 2026-10-19), file `08-reader-luna-launch-prep.md`

After three quiet weeks, 377 commits landed in six days, almost all from Claude Code sessions. The reader got Explain, checkpoints and rehearsal. Luna got a face. The parser learned to plan the deck first, quiz grounding was tested against pre-registered gates, and the app was prepared for launch with cost caps, GDPR export/erasure and German.

- **10-10:** the reader becomes intelligent (#75); tool questions are graded by computing the answer, "never from the model's answer key" [C].
- **10-10 to 10-13:** deck plan first, with no LLM call in the planning layer (#84). Deck Lab on 25 real decks: mean quiz span 0.17 → about 0.84 (`docs/DECK_LAB_2026_10.md`).
- **10-11:** Provider Chaos Lab finds two live cost bugs: the daily ceiling was not enforced in the worker, and retired Gemini legs were still active (#84, #92).
- **10-11:** the quiz verifier stays advisory: the lexical check wrongly dropped 87.5% of correct paraphrased questions. Semantic grounding then failed its pre-registered gate (8/16 false keeps against a limit of 1/16), and the wiring was reverted, not tuned (#94, `7d4d79c4`).
- **10-11:** monochrome brand; "one fact, once"; the landing page shows only what the product does (#78, #104).
- **10-11 to 10-13:** GDPR export and ordered, retried erasure (#90); anon access to SECURITY DEFINER functions revoked (#77).
- **10-16:** launch prep: optional OpenAI-only mode, real users, Launch Control (#92); students' parse spend attributed and capped (#98).
- **10-16 to 10-19:** v4 in German, "du", with a lint guard (#97, #102, #105).

### Phase 9: v4 live for real people (2026-10-20 to 2026-10-30), file `09-v4-live.md`

v4 was wired to real data, and sign-up and first run moved onto it. The classic rooms were retired for students, and v4 became what production serves (10-29). The reader became "instant": it opens before the AI has run, and Luna's content arrives page by page. The phase also brought two audit weeks, legal pages, a domain move, monitoring, backups and a documentation reset.

- **10-24:** v4 on real data; a production build can only run v4 with live data (#96).
- **10-24:** audit weeks 1 and 2, test-first (#110, #112); a public storage bucket closed on prod (#114).
- **10-24:** everyone signs up as a learner; "teaching is owning a Space" (#115).
- **10-26:** classic student app retired (#126); product direction "drop anything, read it now" (spec `2026-10-26-library-and-spaces-design.md`); Luna study sessions behind a flag (#125).
- **10-29:** flags reach the production build (#136); rehearsal on real data (#140).
- **10-30:** instant reader and "Luna lights up" (#139, #145), motivated by a live test: on an 82-slide deck the full reader arrived only after 703 s, and the last ~3.5 min of that came after Luna had already written every page.
- **10-30:** "How it's landing" telemetry for owners, with a floor of five readers behind every share (#133, #142); visibility to other members opt-in (#146).
- **10-30:** monitoring and encrypted backups on free tiers (#158, #161); move to learnstation.app (#162); documentation reset, "the repo, not per-machine memory, has to carry the facts" (#151, #152, #154).

### Phase 10: Evaluation and polish (2026-10-31 to 2026-11-04), file `10-evaluation-and-polish.md`

A controlled evaluation for the thesis: a pre-registered, blind benchmark of PDF text extraction (#168). Alongside it came small production fixes.

- **10-30 to 11-01:** ten extraction methods, 24 pages from five PDFs, one blind human judge, 283 votes over four comparisons, four dated protocol deviations. AI vision transcription, `pymupdf4llm`, `mineru` and `opendataloader` beat the current raw PyMuPDF text (`docs/thesis/experiments/parser-benchmark/`).
- **10-31:** an independent answer check for generated quiz questions: "the checker is not the author", and an outage never empties a quiz (#166).
- **10-31:** Sentry for browser, API and worker, EU only, enforced in code (#165).
- **10-31:** a one-deck LlamaParse trial, not adopted. It is recorded only outside the repo.
- **11-01:** profile trust fields and XP rewards validated on the server (#169, written by Codex).

---

## 5. Key decisions

| Decision | Date | Alternatives (if visible) | Reason | Sources |
|---|---|---|---|---|
| Start from a generated scaffold (Lovable), Supabase for auth, DB and RLS, plus a Python service | 01-23 | none visible | not recorded | `184e5742`, Phase 1 |
| Generate study content per page with an LLM at upload time; show the original page beside it | 02-24 | live generation; text only | [I] keeps the source visible and the AI text checkable | `4c23d254` |
| Drop live slide sync for self-paced reading | 03-02 | keep the professor-driven sync | not recorded | `97e71e69` |
| Treat GDPR and German law as prototype requirements | 03-11/12 | add later | [I] German university context; commits cite Art. 13, 17, 20 and §5 TMG | Phase 1 |
| Enrich only teaching pages (three-layer filter) | 03-20 | enrich every page | [C] "not every page is teaching content"; [I] cost | Phase 2 |
| One trunk with pull-request review | 04-24/26 | personal branches | [I] merge conflicts and duplicated work between branches | `27fec458`, #1 to #6 |
| Layered architecture with an `LLMProvider` interface | 04-29 | logic in React components | [C] PR #6 architecture review | #6 |
| Classify each page and route it to text, OCR or vision | 05-01 | one call per page | [C] page types need different handling | `7ffb0cd2` |
| Tutor grounded only in the lecture, with citations and refusal | 05-02 | open chat | [C] avoid hallucination and cross-lecture leaks | `8d2eb095` |
| Fixed intent catalogue instead of LLM-generated SQL for "Ask Your Data" | 05-03 | text-to-SQL | [C] safety | Phase 3 |
| Background job queue (Arq + Redis) for parsing | 05-19 | parse in the API process | [C] long jobs, resumability, SSE progress | `6ce7b5f1`, `CHANGELOG.md` 3.0.0 |
| LiteLLM gateway in front of providers | 05-19 | direct calls | [C] provider routing without code changes | `CHANGELOG.md` 3.0.0 |
| Move XP and badges to an idempotent server engine | 06-15 | client-side XP | [C] client could forge rewards | `343890c5` |
| Drop quiz questions with unresolvable keys | 06-16 | default to option A | [C] silent wrong answer keys | `f25dd41c` |
| One server-side unified pipeline (v5) that can see images | 06-17 | keep v2, v3, v4 | [C] v4 sent 142/143 slides to text; frontend wrote parse output | `4f19bd1e` |
| OpenAI-compatible provider: "OpenAI now, self-hosted university LLM later" | 06-17 | free tiers only | [C] free vision tiers rate-limit "almost immediately" | `cd3e39b2`, `a12666cd` |
| Every feature behind a flag, with i18n, RLS tests and events | 07-06/07 | none visible | [C] roadmap standards | `docs/ROADMAP_10X.md` |
| One upload path; archive old pipelines ("flag-not-delete") | 07-10 | delete; keep all | [C] debt burn-down | `a65b0f9d` |
| SM-2 for spaced repetition | 07-11 | FSRS | not fully recorded | `4cd58a66` |
| `main` as the single trunk; branches become `archive/*` tags | 08-17 | keep branches | [C] 83 branches, a stranded security fix | #9 |
| Never `supabase db push`; apply migrations by hand | 08-17 | the CLI | [C] prod ledger held 2 of 115 rows | `docs/MILESTONE_2026_08.md` |
| Remove the LiteLLM gateway; call providers directly | 08-25 | keep the gateway | [C] it had no live callers | `68a091e0` |
| Build v4 around Spaces, with per-Space roles, beside the classic app | 08-30 | refactor the classic rooms | not recorded | `docs/design-v4/` |
| Build v4 on mock data behind one seam first | 08-31 | build on live data | [C] speed of design iteration | Phase 7 |
| Two ordered in-process provider chains (bulk vs quality) | 09-18 | one chain; a gateway | [C] model retirement as config change | `a33c0296` |
| Plan the deck before any LLM call | 10-10 | "first N slides" | [C] coverage; testable without a model | #84 |
| Grade tool questions by computation, not by the model's key | 10-10 | trust the model | [C] model keys can be wrong | #75 |
| Quiz verifier stays advisory after a failed pre-registered gate | 10-11 | enforce; tune the threshold | [C] 87.5% false drops; gate failed, "recorded, not tuned" | #84, #94 |
| Optional OpenAI-only mode, spend caps per student | 10-16 | multi-provider | [C] cost bugs; [reason for OpenAI not recorded] | #92, #98 |
| Retire the classic student app; v4 only for students | 10-26 | keep both | [C] one app for students (LS-050) | #126 |
| "Drop anything, read it now": reader first, AI arrives page by page | 10-26 to 10-30 | wait for the full parse | [C] 703 s until the full reader on an 82-slide deck, ~3.5 min of it idle | spec 10-26, 10-29; #139, #145 |
| Privacy floors: five readers per share, opt-in visibility | 10-30 | show per-person data | [C] GDPR Art. 25(2) | #142, #146 |
| Blind, pre-registered benchmark with one judge | 10-30 | automatic metrics only | [C] automatic checks never decide alone | `PROTOCOL.md`, #168 |
| Answer check on a different provider than the author | 10-31 | self-check | [C] "the checker is not the author" | #166 |

## 6. Problems and lessons learned

1. **Parallel pipeline generations.** By 05-22 the upload route chose between four parsers. Release notes described v3 as the default while v2 still ran, and a bug sat unnoticed in the "dormant" v3 code. **Lesson:** keep one live path and retire the rest explicitly. "Flag-not-delete" (07-10) was the eventual answer. [C: Phases 3 to 5]
2. **Branch sprawl and stranded work.** By August there were 83 branches in 40 worktrees, a security fix stayed off `main` for two weeks, and finished work was believed lost. **Lesson:** one trunk, small PRs, and "re-derive before deleting" [C: `docs/MILESTONE_2026_08.md`].
3. **Production drifted from the code.** The migration ledger did not match the files, prod ran an old branch, a storage migration from May was never applied, and frontend flags never reached the build. **Lesson:** check what is running, not what git says, and apply migrations by hand with probes [C: Phases 6 and 9, `CLAUDE.md` traps].
4. **Silent failures.** Errors were shown as empty states, fabricated data appeared as telemetry, features were dead behind undefined flags, and tests passed while nothing ran. **Lesson:** make failures loud and test against real systems (real Postgres, the auth role, the app booted) [C: #30, #33, #36, #48, #74, #129].
5. **Free-tier and cost limits shaped the AI design.** Rate limits and quota storms drove the provider switches, batching and lazy mode. Later, unenforced ceilings and unmetered calls were found. **Lesson:** measure and cap cost per call and per user [C: Phases 3, 4, 8].
6. **LLM output cannot be trusted as is.** Filler text, "Slide N" titles, truncated JSON, wrong answer keys and batch replies matched by position all had to be fixed. The response was validation by computation, matching by id, an independent checker and keeping model output only where it can be checked [C: Phases 1, 4, 8, 9, 10].
7. **Measuring quality is hard, and honesty matters.** The lexical verifier failed, semantic grounding failed its gate, and the benchmark showed most extractor outputs as "both unusable" on many pages. The team recorded failures instead of tuning until they passed [C: #94, `LAB_LOG.md`].
8. **Docs went stale and were then cited as fact.** This hit the secrets audit, the thesis notes on the gateway, roadmap Phase 2 and the CHANGELOG 3.0.0. **Lesson:** date every fact and strike through rather than delete; the documentation reset of 10-30 [C: #67, #70, #71, #151].
9. **AI agents bring speed and new risks.** 1,229 of 1,599 non-merge commits came from AI agents (1,118 with a Claude co-author trailer or author, 111 from the likely Replit Agent account). The speed is visible (110 commits in one session; 377 in six days). So are the costs: red quality gates after bursts, duplicate migration timestamps, lost constraints across parallel branches, stacked PRs merged into dead branches and flaky tests under load. The counter-measures grew over time: test-first, mutation checks, pre-registered gates, written ledgers and re-checking git state before every commit [C: Phases 3, 5, 7, 8, 9].
10. **Built for users who did not come yet.** Real usage was near zero from August (`docs/START_HERE.md`). Most evaluation is therefore technical (audits, benchmarks, measured performance), not user studies [C].

## 7. Open questions

These are places where the reason is not in the repo. Each phase file has more detail.

**Product direction**
- Why was the app started from a Lovable scaffold, and how much of the first commit was generated? (Phase 1)
- Why was live slide sync removed after a week? (Phase 1)
- What triggered the v4 product model (Spaces, per-Space roles) at the end of August: user feedback, low usage, or the thesis scope? And why build it beside the classic app instead of refactoring? (Phase 7)
- Why were university and programme questions dropped from first run (#115), and why are an owner's uploads outside the monthly quota (#128)? (Phase 9)
- Why move to learnstation.app on 10-30? (Phase 9)

**AI and pipeline**
- Why Gemini, then Groq, then Cerebras as defaults? Were providers ever compared on quality? (Phases 1 to 3)
- Which `PARSER_VERSION` ran in production on which date (2, 4, 5)? (Phases 3 and 4)
- What was the "Replit Node.js implementation" that the v4 orchestrator says it was ported from? Why were Hono and better-auth added and removed on 06-05/08? (Phase 3)
- Why did the tutor move from deck-only answers to labelled outside knowledge (06-24)? (Phase 4)
- Was a self-hosted university LLM ever set up? (Phase 4)
- When exactly did Docling leave the production path, and why? (Phase 8)
- Why OpenAI-only for launch, why those models, and when was the mode switched on in prod? (Phase 8)
- Why must `FEATURE_COURSE_BRAIN` stay off? (Phase 5)
- Will the benchmark result change the production parser? (Phase 10)

**Process and people**
- Who reviewed the ~110 agent commits of 05-02/03, and was the burst driven by a written task list? (Phase 3)
- What was the "principal engineering audit" behind PR #6? (Phase 2)
- What happened in the gaps 03-13 to 04-20, 08-01 to 08-14, 09-19 to 10-09 and 10-20 to 10-23? (Phases 2, 6, 7, 9)
- What was Osama's role after July? His last commit is from 08-28, and his `Refactoring` and `security-audit` branches were not merged. (Phases 5 to 9)
- Who or what is "Ascend Bot"? (Phase 5)
- Why was `load_dotenv(override=True)` added on 04-26? (Phase 2)

**Evaluation**
- Will the thesis use the F19 retrieval numbers, which exist only on an archive tag? Should they be re-run on `main`? (Phase 7)
- Were the research questions RQ2 and RQ3 (perception studies, see `docs/thesis/THESIS_PLAN.md`) scoped out with the supervisor? (Phase 7)
- Should the LlamaParse trial be recorded in the repo so it can be cited? (Phase 10)
- How was the strong AI vision model in the benchmark chosen? (Phase 10)

## 8. Thesis hints

**Requirements chapter**
- Early requirements as dated sources: the GDPR articles in Phase 1 commits; the seven goals of parser v3 (`project_docs/parser_v3_architecture.md`); the professor needs in `docs/analytics-redesign/00-brief.md`.
- The 258-user-story feature audit (06-28) is a ready-made requirements catalogue with IDs.
- `docs/ROADMAP_10X.md` §3 cross-cutting standards as non-functional requirements (i18n, RLS per table, typed events, flags).
- The v4 object model (`docs/design-v4/01-foundations.md`) and the agreed direction (`docs/superpowers/specs/2026-10-26-library-and-spaces-design.md`).
- Privacy and cost as hard requirements: #129, #142, #146, #98.
- Show how the requirements moved: from a professor-centred course platform to a reading-first app for any learner.

**Design chapter**
- The pipeline lineage (§3) as the central design story, with a reason for each step.
- Async worker and job queue (Arq + Redis) with per-page persistence.
- Provider abstraction: gateway (05-19) vs in-process ordered chains (09-18). Defend the second; `docs/thesis/NOTES.md` explains why.
- Deck plan first, without an LLM (#84).
- Trust in AI output: drop-not-default keys, grading by computation, the independent checker, and keeping model output only where it can be checked.
- RLS as the authorisation boundary; server-authoritative XP; privacy floors.
- Reader first: the instant reader and page-by-page handover (#139, #145).

**Implementation chapter**
- `backend/services/parser/unified_orchestrator.py`, `deck_plan.py`, `persist.py`, `compact_pdf.py`; `backend/services/ai/orchestrator.py`; `backend/workers/arq_worker.py`; `src/features/spaces/` (reader screens).
- Concrete technical examples with measured numbers: 16 KB range requests and packed PDFs (#131, #132), egress fix (#12), batch-reply id matching (#163).
- Testing approach: test pyramid (`docs/TESTING_STRATEGY.md`), real-Postgres e2e, nightly DB/RLS tests, CI gates.
- Deployment: Docker Compose on one server, manual deploys, migrations by hand, monitoring and backups (runbooks in `docs/runbooks/`).

**Evaluation chapter**
- Main result: the parser benchmark (#168; `docs/thesis/experiments/parser-benchmark/PROTOCOL.md`, `LAB_LOG.md`), with hypotheses, method, pooled scores, costs and threats to validity.
- Deck Lab scorecard (`docs/DECK_LAB_2026_10.md`) and the failed pre-registered grounding gate (#94): an honest negative result.
- Retrieval evaluation harness (#69, `backend/eval/retrieval_grid.py`).
- The quiz answer-check probe (#166), the Studio geometry report (`docs/STUDIO_PAGES_REPORT_2026_10.md`) and the reader performance tables (#131, #132).
- Audits as evaluation of the system against its own claims (Milestone-4: 135 findings).
- State the limit plainly: no user study, because real usage was near zero.

**Methodology or process (if your thesis has such a section)**
- From two personal branches to one trunk with PRs, then to one developer directing AI agents (Replit Agent, Claude Code, Codex). The AI co-author share per phase (§1) is a clean, countable fact.
- The counter-measures that grew with agent use: written plans and ledgers, pre-registered gates, test-first, documentation resets.

---

## Summary

- Ten phases, from a Lovable scaffold (01-23) to a live, reading-first app with a thesis benchmark (11-02). The PDF-to-content pipeline went through about eight generations, and the interface was built twice (classic, then v4).
- Effort came in bursts. Half of all commits fall in October, and 77% of non-merge commits (1,229 of 1,599) came from AI agents, rising from 0% in Phase 1 to 92 to 99% from October.
- Section 5 lists 32 key decisions with sources. Reasons are confirmed for most; the gaps are collected in §7 for you to fill in.
- The main lessons concern parallel pipeline versions, branch sprawl, prod/code drift, silent failures, cost limits, untrusted LLM output and stale docs.
- For the thesis, the strongest material is the pipeline lineage (design), the deck-plan and trust mechanisms (design and implementation), and the parser benchmark plus the failed pre-registered gate (evaluation).
