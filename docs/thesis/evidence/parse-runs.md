# Parses in production: outcomes

Cited by chapter 4, section 4.3 ("What reliable means here").

**Method.** Read-only aggregate queries on the production table `parse_runs`
(Supabase project of the deployment), in November 2026. Every statement ran
inside `BEGIN READ ONLY … ROLLBACK` with `default_transaction_read_only=on`.
Only counts were read: no file names, user ids or texts. Runs of pipeline v5
are the rows whose `pipeline_version` starts with `5`; that includes `5`,
`5-student` (student uploads), and an older key format from July that appends
an id.

**Result.**

| | runs |
|---|---|
| pipeline v5 runs, June to November 2026 | 113 |
| completed | 99 |
| failed | 14 |
| any other status (running, queued, stuck) | 0 |
| distinct uploaders (developers included) | 23 |
| distinct files (by hash) | 65 |

| month | runs | failed |
|---|---|---|
| June | 6 | 0 |
| July | 64 | 13 |
| August | 22 | 1 |
| September | 1 | 0 |
| October | 19 | 0 |
| November | 1 | 0 |

Causes of the 14 failures, from the start of the stored error message:

| month | cause | runs |
|---|---|---|
| July | translation ("Localization failed"), model call exceeded the 90 s timeout | 7 (5 English, 2 German) |
| July | write to column `source_language`, which production did not yet have | 4 |
| July | PDF not found in storage | 2 |
| August | generic "PDF parsing failed" | 1 |

Median duration of a completed run: 114 s. Seven completed runs took more than
an hour; these counts do not explain them.

**What it is and is not.** Light use, mostly by the developers, and few runs.
It shows that failures were recorded as failures and that no run was left
unfinished. It does not measure reliability under load.
