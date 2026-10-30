# Documentation reset — session prompt

*Written 2026-10-30 by Claude Fable 5.1 for Abi. Paste everything below the line into a fresh Claude Code session on a new branch (`docs/documentation-reset`). Budget: one long session, three PRs.*

---

You are working on **Learnstation** (repo root = this checkout, main @ 35a30d73 or later). Read `~/.claude/projects/-Users-abdullahabobaker-Desktop-ascend-academy/memory/MEMORY.md` first; it is the only "start here" that exists today. Your job is to make that no longer true.

## Goal

Three deliverables, three PRs, in this order. Each PR must be mergeable on its own and must not touch product code or migrations.

1. **Session efficiency** — a new session should be productive within its first two tool calls.
2. **Repo documentation** — what is in `docs/` and the root `*.md` files matches what is actually on `main` and in prod.
3. **Screen text** — every string a learner sees (26 i18n namespaces, en + de) obeys the glossary, the voice rules and the honesty rule.

## Hard rules (these override anything you infer)

- **Verify before you write.** Every factual sentence you put in a doc must come from the code, `git log`, a migration file, or a probe you ran this session. Memory files are hints, not sources. If you cannot verify a claim, write "unverified" next to it or leave it out.
- **No product changes.** Docs, i18n JSON and comments only. No TSX/py logic, no migrations, no deploys, no `supabase db push` (the prod ledger is unreliable; that command is forbidden).
- **Learnstation only.** Never suggest other projects or side quests.
- **Other sessions may share this working tree.** Re-run `git status` and `git log -1` before every commit and push.
- **Small PRs.** One per deliverable. Open each with `gh pr create`, base `main`, then move on; do not wait on CI.
- **One fact, once.** A fact lives in exactly one file; everything else links to it.
- **Honesty rule for screen text:** only describe what the app really does today. No feature is promised, implied or "coming soon" in UI copy.

## Deliverable 1 — session efficiency (PR 1: `docs/claude-md`)

There is **no `CLAUDE.md` in the repo**. Create one, plus a `docs/START_HERE.md` it points to.

`CLAUDE.md` (≤ 120 lines, scannable, no prose paragraphs). Sections, in this order:

1. **What this is** — two lines. Learnstation, PDF reader first ("the reader IS the product, felt never said"), v4 UI live in prod, Luna sessions layered on top.
2. **Where things are** — a table: frontend `src/` (Vite+React+TS, i18n at `src/i18n/locales/{en,de}/`), backend `backend/` (FastAPI, Arq worker, parser v3), `supabase/` (migrations), `docs/`, `e2e/`, `deploy/`. One line each, verified by `ls`.
3. **Commands that actually gate** — the exact test, typecheck and lint commands that CI runs (read `.github/workflows/*` to find them). Note explicitly that `tsc -p tsconfig.json` checks nothing and `tsconfig.app.json` is the real one. Note that CI does not run on feature-branch pushes.
4. **Prod facts** — one line each, dated: host, how to deploy (link to the runbook you will write in PR 2, do not inline it), which feature flags are on, which branch the server runs. Verify by reading `deploy/` and `docker-compose.prod.yml`; mark anything you cannot verify from the repo as "see memory / ask Abi".
5. **Rules Abi has set** — the feedback memories, condensed to one line each: reader first; calm non-salesy voice; one fact once; Luna stays identifiable; match existing visual language; summary section at the end of substantial answers; Learnstation only; concurrent sessions on one tree.
6. **Traps** — the verified gotchas: `load_dotenv(override=True)` in `orchestrator.py` pulls the prod DSN into tests; a second `user_roles` row locks an account out; seed scripts never reset existing users; subagent worktrees branch from main not HEAD; `supabase db push` forbidden; browser `form_input` does not register in React forms on `/auth` (type instead).
7. **Trackers** — where open work lives: the release punch list (artifact db "issues", LS-xxx ids), `docs/V4_GLOSSARY.md`, `docs/BRAND_VOICE.md`. Say that memory files are per-machine and the repo must not depend on them.

`docs/START_HERE.md` (≤ 200 lines): the orientation a new human or agent needs that is too long for CLAUDE.md — architecture in ten lines, the v4 rooms and their routes (read `src/` router to list them), the parse pipeline in five lines, how auth/roles/onboarding gate routes, and a dated "state of the world" block (what is merged, what is deployed, what is open) that you fill from `git log`, `gh pr list --state all --limit 40` and the punch list.

Also in PR 1: a `docs/prompts/README.md` that lists the reusable session prompts already in the repo (`AUDIT_SESSION_PROMPT.md`, `V4_SCENARIO_TESTING_PROMPT.md`, `OVERNIGHT-PROMPT-ROADMAP-PHASE2.md`, this file) with one line each on when to use them. Move them into `docs/prompts/` with `git mv` so links survive.

## Deliverable 2 — repo documentation (PR 2: `docs/inventory-and-runbooks`)

1. **Inventory first.** Produce `docs/INVENTORY.md`: every `.md` file in the root and in `docs/` (recursive), with columns: path, last commit date (`git log -1 --format=%cs -- <path>`), what it claims to be, status = `current | historical | stale | superseded-by:<path>`. Decide status by reading the file against the code, not by its date. Historical specs and audits stay where they are and get a one-line banner at the top: `> Historical (YYYY-MM-DD). Kept for the record; see <current doc> for the present state.` Stale docs with no historical value move to `docs/archive/` with `git mv`.
2. **README.md** says "Learnstation v3.0" and lists features from the pre-v4 era. Rewrite it for what `main` is now: v4 reader-first UI, Spaces, Library, Luna, parser v3, the real tech stack, the three ways to run it (dev, docker compose, prod), and links to START_HERE, SETUP_GUIDE, PRODUCTION_INFRA_GUIDE, DEPLOYMENT_READINESS. Keep it under 150 lines. No emoji headings, no marketing adjectives.
3. **Runbooks.** `docs/runbooks/` has one file. Add, each verified against `deploy/`, the compose files and the existing infra guides:
   - `deploy-main-to-prod.md` — the exact sequence used on 2026-10-30 (tag rollback point, pull, build, migrate by hand, verify, roll back). Pull the steps from `deploy/` scripts and `PRODUCTION_INFRA_GUIDE.md`; where the memory and the repo disagree, the repo wins and you note the disagreement.
   - `apply-a-migration-by-hand.md` — how migrations are actually applied to prod (psql through the pooler on port 5432, never `db push`, probe `pg_catalog` not `schema_migrations`).
   - `rotate-a-secret.md` — where each secret lives (two env files; which one the compose files read), how to rotate the admin password, Resend key, LLM keys.
   - `local-dev.md` — the verified `launch.json` entries, Supabase CLI at `~/.local/bin`, absolute `.venv` path, default test user `abdul@test.com` (no password in the doc).
4. **Fold the loose root files.** `DEPLOYMENT_READINESS.md`, `TESTING_STRATEGY.md`, `CLEANUP_NOTES.md`, `WORKLOG.md`, `ANALYTICS_IMPROVEMENTS.md`, `replit.md`, `threat_model.md`: each is either current (move to `docs/` and link from START_HERE), historical (banner + move to `docs/archive/`) or dead (`git rm`). `replit.md` is almost certainly dead; confirm before removing.
5. **CHANGELOG.md**: append a dated section listing every PR merged since the last entry (`gh pr list --state merged --limit 60`), one line each, grouped by area. Do not editorialise.

## Deliverable 3 — screen text (PR 3: `i18n/copy-pass`)

Scope: `src/i18n/locales/en/*.json` and `src/i18n/locales/de/*.json` (26 namespaces each). Rules you apply:

- **Glossary** `docs/V4_GLOSSARY.md` is law. Space/Lektion/Seite/Idee/Material/Bibliothek/Studio/Leute; "Folie", "Vorlesung", "Kurs", "Konzept", "Dozent" (bare) and "Student(en)" are forbidden in v4 namespaces. In pre-v4 namespaces (dashboard, lecture, professor, exam, review, gamification, myMaterials) only fix what a learner can still reach from the v4 rooms; check the router before deciding.
- **Register** `docs/BRAND_VOICE.md`: du never Sie; gender-inclusive forms; no exclamation marks introduced in translation; "wir" in errors; calm, assured, never salesy; no pain-contrast hooks on the landing page.
- **Honesty:** every string that describes a capability must match a feature that is on in prod. Build the list of on flags from the code first, then grep the strings. Remove or reword anything that promises more.
- **One fact once:** a label or number must not appear twice on one screen (including the top bar). Walk each v4 room in the browser (dev preview, `abdul@test.com`) and look, do not only read JSON.
- **Hallmark/Impeccable rules** already adopted: no eyebrow labels, no decorative dots, no glow, figures not gauges, hairline lists. These are mostly TSX concerns and out of scope here; note violations you see in a list for a later PR, do not fix them.
- **Parity:** every key in en exists in de and vice versa. Write a tiny script in the scratchpad to diff key sets and paste its output in the PR.
- **Dead keys:** keys no TSX references (`grep -r "t('ns:key'" src` and the `useTranslation(ns)` forms). Delete them; list them in the PR.

Output of PR 3 besides the JSON edits: `docs/COPY_AUDIT_2026_10.md` with a table per namespace: key, old en, new en, old de, new de, rule applied. Keep the table; it is how Abi reviews copy.

## How to work

- Start with a 15-line plan in chat, then go. Do not ask questions you can answer with a tool call.
- Use the codebase-memory graph tools for structure questions (routes, callers) and plain grep for strings.
- Where you must touch many files mechanically (banners, `git mv`), write a short script in the scratchpad and run it once; do not hand-edit forty files.
- After each PR is opened, post in chat: PR link, what changed in one paragraph, what you could not verify, and the list of TSX-level findings you parked.
- Finish with a **Summary** section: the three PR links, anything left undone and why, and the one-line change you recommend to `CLAUDE.md` after the next deploy.

## Done means

- `CLAUDE.md` exists on the branch, under 120 lines, every prod fact dated, every command in it runs.
- `docs/INVENTORY.md` lists every markdown file with a status, and no root-level stray `.md` remains except README, CHANGELOG, CLAUDE.
- en/de key sets are identical, zero forbidden glossary words in v4 namespaces, zero unverifiable capability claims in UI copy, and a walk of Home → Spaces → a Space → a Lesson → Library → Settings in both languages shows no duplicated fact on any screen.
