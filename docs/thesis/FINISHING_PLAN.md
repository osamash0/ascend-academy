# Thesis finishing plan — 2026-10-10

Branch `thesis/finishing-pass`. Supersedes `THESIS_PLAN.md`, which was
overtaken in August (see that file's own history).

## Where it stands

The apparatus is done and now trustworthy. The prose is not started.

| Part | State |
|---|---|
| Build | `make` compiles 48 pp, zero undefined refs; biber now runs (it never did before) |
| Figures | 19/19 wired; all re-rendered clean (every committed PDF had a PlantUML warning banner, two had broken branches) |
| Captions | four corrected where they stated false claims (f9, f10, f11, f14) |
| Bibliography | 75 academic sources, every DOI/arXiv id re-resolved; 0 cited so far |
| Results | F19 holds real retrieval numbers (precision@k, n=27–50); three other metrics honestly "not measured" |
| Constants appendix | 53 rows, each file:line re-read at `0be0081` |
| Claims | 91 claims in the briefs checked; corrections attached under 19 briefs |
| Title page | university, department, place filled; matriculation number left out because the repository is public |
| **Prose** | **effectively zero.** Chapter word counts (~5,000 total) are brief text and figure captions |

The evidence behind all of this is in `docs/thesis/evidence/`:
`CLAIMS_LEDGER.md` (what is true and what to write), `CONSTANTS.md`,
`REFERENCES_MAP.md` (which source supports which section).

## Decisions only you can make

These change what gets written. Each is a short conversation, not work.

1. **Deadline.** The plan dated late September has passed. Know your real
   submission date before anything else. A Marburg extension is typically
   capped at 20 % of the writing period on justified application; FB 12's own
   rule was not findable online, so ask the Prüfungsbüro.
2. **Research questions, with your supervisor.** RQ2 and RQ3 are perception
   questions and no study ran. Either scope them out, or keep them and present
   the study design as future work. This decides how much of chapters 1, 6 and
   7 exists. It has been "pending supervisor confirmation" since August.
3. **AI-use rules for your declaration.** No FB 12 policy was found online.
   Marburg's medical faculty allows AI for ideas and language but not for the
   introduction, results or discussion; FB 12 may be similar. Ask, then make the
   declaration page accurate. This also bounds how much help with prose is
   legitimate, which is why everything so far is evidence, not text.
4. **The audit revision.** Every claim cites `0be0081` (2026-08-18). `main` is
   174 commits later, but no migration and little claimed code changed. Two
   options:
   - **Keep `0be0081`** (recommended). All evidence is already pinned there.
     Anything fixed since becomes a "found, then fixed" sentence, which reads
     as rigour.
   - Move to current `main`. Cleaner present tense, but every file:line has to
     be re-read again.
5. **Land the pending fixes first or not.** The provider-chain repair and the
   anonymous-RPC revoke would each turn a "broken" finding into a
   "found-then-fixed" one. Landing them before writing means writing those
   sections once. *Update 2026-11-05: the anonymous-RPC revoke has landed
   (`537b9806`, PR #77), and so has the upload ownership check (`722167b0`);
   see "Found along the way". Both are now found-then-fixed.*

## Writing order

Evidence-richest first, so momentum comes from chapters where every fact is
already verified. Each line names the chapter's evidence.

| # | Chapter | Briefs | Evidence ready |
|---|---|---|---|
| 1 | 4 Design | 10 + 7 corrections | primer D4–D7, D12–D16, D19; ledger §4 |
| 2 | 5 Implementation | 12 + 9 corrections | primer D8–D11, D17–D18; ledger §5 |
| 3 | 6 Evaluation | 10 + 2 corrections | F19 + `thesis/results/`; primer Part 6; ledger §6 |
| 4 | 3 Requirements | 6 | appendix constants; f4, f5 |
| 5 | 2 Foundations | 7 | `REFERENCES_MAP.md` — **read the sources** |
| 6 | 1 Introduction | 7 | depends on decision 2 |
| 7 | 7 Conclusion | 5 | consolidates 4–6 |
| 8 | Abstract (EN + DE), structure paragraph | 3 | last |

A typical Informatik bachelor thesis body runs roughly 12,000–18,000 words.
Budget accordingly against the real deadline.

## Production probes still open

These claims have a verified code part and an unverified runtime part. Each
needs one read-only command against production, which needs your go-ahead.
The exact commands are in the ledger rows.

| Ledger | What it settles |
|---|---|
| 4.2 | whether prod's `/health/ready` reports the asyncpg path as configured |
| 4.20 | that the three badge keys are still absent from `badge_definitions` |
| 4.21 | the unmigrated `slides.embedding` column: still present, still all NULL |
| 4.25 | whether `LLM_TIMEOUT_SECONDS` overrides the 25 s default |
| 5.20 | live RLS policy count for the trust-boundary figure |
| 6.9 / 6.11 | which feature flags are actually on, and table row counts |

## Found along the way (not thesis work)

- **Security bug, fixed:** single-file upload did not check ownership of the
  course it attached a lecture to, so any creator account could put a lecture
  into another owner's course. Fixed in `722167b0` (2026-10-10), tested by
  `backend/tests/integration/test_upload_course_ownership.py`, and included in
  the 2026-10-30 production deploy (`35a30d73`). Citable as found-then-fixed.
- **Security exposure, fixed:** the 2026-09-17 production audit found 8
  exploitable anonymous-access database functions. That audit's fix,
  `fcb3f1e`, was never merged. It was superseded by migration
  `20261011000000_revoke_anon_security_definer_execute.sql` (`537b9806`,
  PR #77), which revokes `anon` EXECUTE on every SECURITY DEFINER function and
  is guarded by `backend/tests/db/test_anon_security_definer_exposure.py`. It
  was applied to production by hand on 2026-10-11. Re-probe production with
  `docs/runbooks/apply-a-migration-by-hand.md` before citing the prod state.
- The production image runs arq 0.26 while `requirements.txt` pins 0.28.

## Publishing (updated 2026-11-05)

This section used to say "do not push": the ledger, two correction notes in
chapter 5 and this file described the two vulnerabilities above while they were
open. Both are now fixed in code and in production, so they can be described as
found-then-fixed. The repository is still **public**, so two checks remain
before pushing: no matriculation number in `metadata.tex`, and no verbatim
lecturer slide text (see `docs/thesis/SOURCE_MAP.md` §6).
