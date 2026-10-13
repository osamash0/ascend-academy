# SDD ledger — plan: docs/superpowers/plans/2026-10-10-ai-backend-deep-session.md

Spec: no standalone spec file; authority = plan's "Spec" paragraph (memory project-parser-redesign-2026-09). Rulings provisional.

## Pre-flight scan
| Rows | Produces vs consumes | Finding |
|---|---|---|
| T0→T1,T2,T4 | decks()/FOOTER_LINES used by property tests | consistent |
| T1→T2 | normalize_line/find_boilerplate/strip_boilerplate | consistent; T2 appends to same file, imports must move to top (plan says so) |
| T2→T4 | SlideRole/DeckSkeleton/SlidePlan.section | consistent |
| T4→T5 | select_slides, QUIZ_ROLES, META_ROLES | consistent |
| T3→Arc6 | real_deck_pages helper | lives in test file; Arc6 may import from tests — revisit then |
| T0 self | test checks footer prefix in page | agrees |
| T1 self | 7 tests | agrees |
| T2 self | 15 tests; random words may start with role keyword | risk noted in plan step 4 |
| T4 self | eligible definition in test == impl (role in QUIZ_ROLES, len>=50) | agrees |
| T5 self | orchestrator call sites by line number (~621/~852) — may drift | implementer must locate by grep |
| Arcs 3-6 | no task-level detail | by design |

Ruling: T2 random-word keyword collisions — implementer may exclude role keywords from _WORD in deck_strategies.py — fixture realism over coincidence — cost if wrong: hides a real classifier ambiguity (low; covered by real-deck T3).
Ruling: Arcs 3–6 get their detailed plan written by the controller (via a Plan subagent reading the code) when reached, appended as Tasks 6+ to a new arc plan file — plan explicitly mandates this — cost if wrong: extra planning turns.
Ruling: implementers in this worktree use /Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python; pip install of hypothesis into that shared venv is allowed (dev-only, additive) — cost if wrong: shared venv gains a package.

## Progress
Baseline (Task 0): 1595 passed, 1 skipped, 233 deselected (-m "not db").
Task 0: complete (commits d7c9032..a108938, review clean)
Task 0: minor (deferred): footer assertion checks prefix only (test_deck_strategies.py:12)
Task 0: minor (deferred): commit trailer says Haiku 5.5 not Opus 5.5 — left as-is (truthful about the authoring model, local unpushed)
Ruling: hypothesis too_slow/deadline — register a session-wide hypothesis profile in backend/tests/conftest.py (suppress too_slow, deadline=None) inside Task 1, so every plan test runs verbatim — suite runs under heavy CPU contention (documented flake history) — cost if wrong: a genuinely slow strategy goes unnoticed.
Ruling: deck_strategies docstring claims "optional section dividers" that don't exist — Task 1 implementer removes the claim — cost if wrong: none.
Task 1: complete (commits a108938..7f78a75, review clean)
Task 1: minor (deferred): footer-strip property never asserts non-footer content survives
Task 1: minor (deferred): repeated real lines like "Step 1" on >=60% pages are stripped by design — document before LLM use
Ruling: Co-Authored-By trailer — subagent commits name the model that actually authored them (Haiku/Sonnet); controller commits use Opus 5.5 — truthful attribution beats uniformity — cost if wrong: cosmetic amend of local unpushed commits.
Task 2: complete (commits 7f78a75..ad10f76, review clean) — implementer found plan's mutation B survived brief tests; added test_footer_does_not_hide_a_section_divider
Task 2: minor (deferred): empty-deck guard untested
Task 2: minor (deferred): blank cover slide -> EMPTY role, section 0 title "" (watch in T3)
Task 2: minor (deferred): short 1-2 line slides (<=6 words) become SECTION dividers — measure on real decks in T3
Task 3: complete (commits ad10f76..96bae91, review clean) — survey of 20 real decks: 0 genuine numbered dividers; fix 1 = only numbered short slides are SECTION
Task 3: minor -> folded into Task 3b: numbering regex accepts "10 Gbit Ethernet", "2024 Ergebnisse", "1 / 66"
Task 3: minor (deferred): import fitz inside helper errors (not skips) if PyMuPDF missing
Task 3: minor (deferred): section-0 title = author/date because deck title is boilerplate; blank cover -> EMPTY
Ruling: add Task 3b (not in plan) — sections also start at recurring progress-agenda slides (deck has >=2 AGENDA slides); real decks otherwise collapse to 1 section, which makes Arc 2's section-balancing a no-op and Arc 6's coverage metric meaningless — cost if wrong: one extra task; worst case agenda-splitting is coarse and the sampler still spreads evenly.
Ruling: Task 3b real-deck bound lowered from 'half of SR decks split' to '>=3 decks' — most SR decks show Inhalt only once; data beats the brief's guess — cost if wrong: weaker regression guard on sectioning.
Task 3b: complete (commits 96bae91..68a58b9, review clean) — 4/14 SR decks split by agenda; DBS decks stay 1 section
Task 3b: minor (deferred): "Overview of X" first lines -> AGENDA, now can start sections
Task 3b: minor (deferred): "27.04 Termine" still matches multi-level numbering
Task 3b: minor (deferred): real-deck >=3 bound has 1 deck of slack
Task 4: review found CRITICAL ZeroDivisionError in plan-authored _spread (budget < sections); fix round 1 dispatched (FIX_BASE f2fe9d8)
Task 4: fix round 1/5 (2 addressed, 0 open — ZeroDivisionError guard + docstring; commits f2fe9d8..49a86db)
Task 4: complete (commits 68a58b9..49a86db, review clean after 1 fix round)
Task 4: minor (deferred): META_ROLES unused until Task 5
Task 5: review approved w/ IMPORTANT vacuous non-list quiz test + minor unguarded skeleton build; fix round 1 dispatched (FIX_BASE f34a787)
Task 5: fix round 1/5 (2 addressed, 0 open; commits f34a787..4b11267)
Task 5: complete (commits 49a86db..4b11267, review clean after 1 fix round). Full suite 1651 passed.
Arc 2 DONE.
Arc 3 plan written by Plan agent (opus) -> docs/superpowers/plans/2026-10-10-arc-3-chaos-lab.md; tasks = ledger Tasks A3.1..A3.5 (briefs arc3-task-N-brief.md)
Controller verified BUG A (worker never calls init_redis; flush_openai_cost_to_redis increments in-memory only after redis write -> ceiling never trips in worker) and BUG B premise (404 check uses status_code / "error code: 404").
Task A3.1: complete (commits f1986bf..ec59703, review clean)
Task A3.1: minor (deferred): google timeout only as httpx.ReadTimeout (no 504 DEADLINE_EXCEEDED variant); groq legs faked with openai exception type; json_mode fallback not exercised
Ruling: add A3.6 — wire init_redis() into Arq worker startup (planner follow-up) — without it the fleet-wide openai cost cap and provider daily counts never work in the process that does all parsing — cost if wrong: worker startup now depends on Redis being reachable (it already needs queue Redis).
Task A3.2: complete (commits ec59703..03cf41d, review clean — BUG B text path fixed; residual: transient google 404 disables leg, same trade-off as openai legs)
Task A3.3: complete (commits 03cf41d..5cf0099, review clean — BUG A fixed)
Task A3.3: minor (deferred): rotator day uses local date, redis key uses UTC date
Task A3.4: complete (commits 5cf0099..b6f10fc, review clean — no bug; all 3 mutations caught)
Task A3.4: minor (deferred): truncated-object prefixes sampled, not exhaustive
Task A3.5: complete (commits b6f10fc..f4a0a54, review clean — BUG B vision path fixed: 50 doomed calls -> 1). Controller full suite: 1672 passed (implementer's "1311" was a misreport).
Task A3.6: complete (commits f4a0a54..381d716, review clean; prod compose confirms worker reaches cache redis)
Task A3.6: minor (deferred): shutdown tests not hermetic re db_pool; shutdown-failure test doesn't assert warning
Arc 3 DONE. Full suite 1677 passed.
Arc 4 plan (opus Plan agent; survived session restart) -> docs/superpowers/plans/2026-10-10-arc-4-grounded-quiz.md; briefs arc4-task-N-brief.md. Storage: no migration (metadata.support_score); per-parse summary deferred to Arc 5.
Task A4.1: complete (commits a40eba8..323e234, review clean; reviewer independently confirmed tie-test mutation)
Task A4.1: minor (deferred): options[key_idx] assumes list; lru_cache on skeleton requires hashability
Task A4.2: complete (commits 323e234..70d4d4c, review clean; threshold 0.5, grounded min 0.663 / ungrounded max 0.339 over 19 real pairs)
Task A4.2: minor (deferred): calibration pairs are verbatim-style; no paraphrased-grounded / on-topic-hallucination pairs; no held-out set; tripwire ±0.01 brittle to PyMuPDF changes
Ruling: paraphrase risk carried into Arc 6 — the Deck Lab scorecard must add paraphrased-grounded + plausible-hallucination pairs and report the drop rate before the verifier is trusted as a production gate — cost if wrong: valid paraphrased LLM questions get dropped, shrinking quizzes (visible via the logged kept/dropped counts from A4.4).
Ruling: A4.3 prompt wording deviation accepted ('slide label below, "Slide N"' instead of literal '[Slide N]') — avoids a fake label in the template that would also confuse the model's slide count — cost if wrong: slightly less explicit instruction.
Task A4.3: complete (commits 70d4d4c..d09410d, review clean)
Task A4.3: NOTE — between d09410d and A4.4/A4.5, _map_deck_quiz still reads slideId while v3 emits source_slide: do not deploy mid-arc (A4.4/A4.5 close it)
Task A4.4: review Needs fixes (2 Important: unbounded repair fan-out; gather aborts on one exception) — fix round 1 dispatched (FIX_BASE 540eb6f). Ruling: cap 12 questions + Semaphore(3) — prompt asks 5–8; 12 leaves headroom — cost if wrong: a deck that legitimately yields >12 good questions loses the tail.
Task A4.4: fix round 1/5 (2 addressed, 0 open; commits 540eb6f..cdbf72a)
Task A4.4: complete (commits d09410d..cdbf72a, review clean after 1 fix round). Suite 1722 passed.
Task A4.5: first implementer interrupted by app quit — WIP uncommitted in 5 files, no report; fresh implementer dispatched to audit+finish (BASE cdbf72a)
Task A4.5: complete (commits cdbf72a..1a7d810, review clean; off-by-one audit clean). Suite 1727 passed.
Task A4.5: minor (deferred): mapper uses bare int() vs verifier's parse_source_slide; max(0,..) silent; no "3" string test
Arc 4 DONE.
Arc 5 plan -> docs/superpowers/plans/2026-10-10-arc-5-parse-receipts.md (5 tasks). Ruling (plan's): students get no receipt access; provider/cost per slide deferred (needs run_id in llm_calls) — honest gap, not faked.
Arc 6 plan saved (c03d294) -> docs/superpowers/plans/2026-10-10-arc-6-deck-lab.md; briefs arc6-task-N-brief.md; run after Arc 5.
Task A5.1: complete (commits 11d6050..faf9908, review clean)
Task A5.1: minor (deferred): stats empty when LLM returns non-list JSON (receipt treats empty as no grounding)
Task A5.2: opus review Needs fixes — 2 Important (write-grant test can't fail; other-professor test vacuous). Fix round 1 dispatched (FIX_BASE 3db9380).
Task A5.2: parked — receipt keyed by run_id alone; parse_runs dedupes per (pdf_hash,pipeline_version,user_id) so one owner's two lectures from the same PDF share one receipt — Ruling: same-owner only (no cross-user leak), rare; record as known limitation in Arc 5 docs — cost if wrong: second lecture shows the first lecture's receipt.
Task A5.2: fix round 1/5 (3 addressed, 0 open; commits 3db9380..c47871b)
Task A5.2: complete (commits faf9908..c47871b, review clean after 1 fix round)
Task A5.3: complete (commits c47871b..38c43cd, review clean; SQL statically matches migration)
Task A5.3: minor -> carry into A5.4: DB e2e must assert upsert replaces row (incl. lecture_id) on re-parse
Task A5.4: complete (commits 38c43cd..ef47ca0, review clean). Suite 1742 passed.
Task A5.4: minor (deferred): no wait_for timeout on receipt write (parity with sibling persist calls); replay test doesn't assert receipt count stays 1
Task A5.5: complete (commits ef47ca0..0329fe6, opus review: code approved; only finding = trailer, covered by earlier ruling). Suite 1750 passed.
Task A5.5: parked — trailer names Sonnet not Opus — Ruling: stands per earlier trailer ruling (truthful authorship) — cost if wrong: cosmetic amend before PR.
Task A5.5: minor (deferred): no 500-path test; ownership compares raw strings (no lowercase normalisation); parse_runs.user_id (uploader) vs lecture owner assumption
Arc 5 DONE.
Task A6.1: complete (commits 0329fe6..217cf4a, review clean)
Task A6.1: minor (deferred): duplicate filter is substring "-2"/"Kopie" (latent false drop)
Controller check: discover_decks() finds 25 real decks.
Task A6.2: complete (commits 217cf4a..2fae131, review clean; meta prompt byte-identical via golden hashes)
Task A6.3: complete (commits 2fae131..49e50ae, review clean; legacy selectors verified faithful to f34a787^)
Task A6.4: done c50a97f — PROBE RESULT: false-drop 14/16 (87.5%; all 8 German paraphrases dropped), false-keep 0/16 at threshold 0.5. Verifier is a surface-overlap filter.
Ruling: add A6.6 BEFORE A6.5 — grounding verifier goes ADVISORY by default (ENFORCE_SUPPORT_THRESHOLD=False): structural failures (no_source, source_out_of_range, empty_slide, not_an_object, no_answer) still dropped; low_support/ambiguous kept + flagged with support_score/verdict in metadata; no repair LLM calls in advisory mode; enforce mode kept behind the constant with its tests — measured 87.5% false-drop makes hard gating destroy most real (paraphrasing) LLM questions and spend a repair call on each — cost if wrong: some ungrounded questions ship (flagged, visible in receipts) until a semantic scorer exists.
Task A6.4: complete (commits 49e50ae..c50a97f, review clean; pairs verbatim, 6 citations spot-checked, counts correct). Caveat: rule-3 strict paraphrase => 87.5% is a lower bound on paraphrase fidelity; 0% false-keep only shows lexically distant hallucinations are rejected.
Task A6.6: implemented 85c462f (advisory default), under review
Task A6.6: complete (commits c50a97f..85c462f, review clean; no repair path in advisory mode; receipt gets flagged/flag_reasons)
Task A6.5: implemented 8b7731f..5fe3a7a — 25 decks: quiz span 0.17->0.84, sections covered 26->31/31, meta last page 15 -> ~61; boilerplate 14930 tokens; probe 14/16 false-drop
Task A6.5: review Needs fixes — 1 Important (static interpretation prose can contradict data/flag); scorecard reproduced byte-for-byte by reviewer. Fix round 1 dispatched (FIX_BASE 5fe3a7a).
Task A6.5: fix round 1/5 (2 addressed, 0 open; commits 5fe3a7a..0706d06)
Task A6.5: complete (commits 85c462f..0706d06, review clean after 1 fix round). Suite 1832 passed.
Arc 6 DONE. ALL ARCS DONE. Final whole-branch review next.
Final review: clean after one fix wave (2efc1f3). Merged-tree check by reviewer: origin/main+branch merges clean; 1890 unit / 258 db pass (1 pre-existing clock-skew flake).
