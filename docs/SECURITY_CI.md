# Continuous security in CI (S-6)

> Implements Foundation 10x roadmap §14, S-6: "Security findings should be
> caught continuously, not in one-off audits." Companion to `threat_model.md`
> and the roadmap's other security items (S-1 RPC-exposure audit, S-2 GDPR
> posture, S-3 rate-limit hardening, S-4 upload security, S-5 secrets/supply
> chain, P2-1 RLS-as-boundary). Those are separate, larger initiatives; this
> doc describes the CI wiring, not their individual findings.

## What runs on every PR

| Check | Job | Always runs? |
|---|---|---|
| Lint (frontend) | `lint` | Yes |
| Frontend unit tests (Vitest) | `frontend-tests` | Yes |
| Backend unit tests (pytest, non-`db`/`e2e`) | `backend-tests` | Yes |
| E2E (Playwright) | `e2e` | Yes |
| DB / RLS regression suite (`pytest -m db`) | `nightly-db` | **Conditionally** — only when the PR diff touches `supabase/migrations/**`, `backend/tests/db/**`, or `backend/app` RLS/core code (see `changes` job, path-filtered via `dorny/paths-filter`) |

`nightly-db` is the enforced authorization-boundary regression suite for
RLS — the P2-1 "RLS-as-boundary" contract. Prior to this change it only ran
on the nightly schedule (`if: github.event_name == 'schedule' ||
'workflow_dispatch'`), meaning a PR that silently dropped or weakened a
policy could merge and reach `main` hours before the 03:17 UTC run caught
it. It now also gates PRs, but **only** ones whose diff plausibly touches
RLS/migrations — not every PR.

### Why path-scoped, not blanket, PR gating

The DB suite boots a real Postgres via `testcontainers` (a pinned
`pgvector/pgvector:pg15` image) and replays all 85+ migrations before any
test runs — real wall-clock cost per the suite's own `conftest.py` comments.
Running it unconditionally on every PR (including pure frontend/docs/i18n
changes, which are the majority of this repo's recent commits) would slow
down unrelated work for no security benefit. Running it only nightly, on
the other hand, leaves a multi-hour window where a bad migration or RLS
regression is on `main` before being caught. Path-scoped PR gating is the
balance: any PR that could plausibly change authorization behavior pays the
Docker cost and gets caught before merge; everything else merges at normal
speed and is still covered by the nightly run as a backstop (e.g. for
drift not visible in a single PR's diff, or a migration whose blast radius
crosses files the filter doesn't list).

If the path filter proves too narrow or too broad in practice, tighten or
widen the `filters:` block in the `changes` job in
`.github/workflows/ci.yml` — it is the single place this policy lives.

## What runs nightly (03:17 UTC) and on `workflow_dispatch`

- **`nightly-db`** — the full DB/RLS suite (also now runs on qualifying
  PRs, see above). This is the backstop for anything the PR path-filter
  misses.
- **Future home for S-1 / S-5 scheduled checks.** S-1 (systematic
  PostgREST/RPC exposure audit — an anon-key probe test suite) and S-5
  (SCA/secret scanning) are separate, in-flight initiatives on their own
  branches. When merged, their scheduled components should be added as
  additional jobs gated on the **same** `if: github.event_name ==
  'schedule' || github.event_name == 'workflow_dispatch'` condition, under
  the **same** `cron: "17 3 * * *"` trigger already in `ci.yml` — not a
  second `schedule:` entry. One nightly cron is the single coherent home
  for every scheduled security check; multiplying schedule entries
  multiplies the "hourly cron stampede" risk the existing off-the-hour
  time was chosen to avoid, and fragments where a developer looks when
  something fails.

## The seeded cross-tenant-leak canary

`backend/tests/db/test_seeded_cross_tenant_leak_canary.py` is the
proof-of-mechanism test for the acceptance criterion "a deliberately-
introduced cross-tenant leak (seeded) fails CI." It does not modify any
real migration or leave the schema vulnerable between commits. Instead,
inside a single explicit transaction on its own test connection, it:

1. Runs `ALTER TABLE public.student_progress DISABLE ROW LEVEL SECURITY`
   — the exact class of regression a careless future migration could
   introduce.
2. Confirms, as an authenticated student, that another student's progress
   row is now visible (the leak actually reproduces).
3. Rolls the transaction back (RLS enable/disable is transactional DDL, so
   `ROLLBACK` fully restores it — no other test in the session is
   affected).
4. Re-confirms the leak is gone afterward, proving the rollback restored
   the boundary cleanly.

A second test in the same file (`test_seeded_leak_canary_would_fail_if_
policy_stayed_disabled`) makes the causal claim explicit: it reproduces
the same seeded-disabled state and asserts, via `pytest.raises
(AssertionError)`, that the identical assertion used in
`test_rls_policies.py::test_student_cannot_see_other_students_progress`
would raise under that condition — i.e. if a real migration ever silently
dropped that policy, the always-on regression test is provably wired to
catch it, not just narrated as "should."

**Caveat:** these `pytest.mark.db` tests require Docker (testcontainers)
and were not executed in the sandbox that authored this change (no Docker
daemon available there). They were verified for Python syntax
(`py_compile`) and reviewed against the existing `test_rls_policies.py`
conventions (same `_as_user` helper pattern, same fixtures). They must be
exercised for real the next time `nightly-db` (or a qualifying PR) runs in
an environment with Docker — flag this if the first real run surfaces
anything unexpected.

## What's a documented gap (not wired, on purpose)

- **`/security-review` (the Claude Code slash-command/skill).** This is an
  interactive, developer-invoked pass — it is not automatable into CI as
  written; it depends on an agent session, not a deterministic script. We
  are **not** claiming to have wired it into CI. The honest state: it
  remains a manual/on-demand step a developer runs before a risky PR or
  during periodic hardening sweeps (as this very S-6 work and its sibling
  S-1/S-2/S-5/P2-1 initiatives were produced). If a deterministic,
  non-interactive security-linting pass is wanted in CI, that is a
  separate initiative from "run the interactive review command inside a
  GitHub Actions runner."
- **Failure alerting beyond GitHub's default.** There is no Slack/webhook
  notification configured for this workflow (verified: no
  `SLACK_WEBHOOK`-shaped secret, no notify step, in the current
  `.github/workflows/ci.yml`). Failures rely on GitHub's default "notify
  the actor and repo watchers by email" behavior. Wiring an explicit
  channel (Slack, PagerDuty, etc.) needs an actual endpoint/secret this
  repo doesn't have configured yet — documented here as a gap rather than
  invented.
- **S-1 (anon-key RPC/PostgREST exposure probe) and S-5 (SCA/secret
  scanning) themselves.** These are being built on separate branches by
  parallel work. This document describes where their scheduled component
  should be wired (see above) once merged, not their content.
- **P2-1 (RLS-as-boundary enforcement work itself)** — also a separate,
  in-flight branch. This doc treats its regression tests
  (`backend/tests/db/*_rls.py`, including the new canary) as the enforced
  authorization layer per the roadmap's framing, but does not implement
  P2-1's broader RLS/grant audit.
