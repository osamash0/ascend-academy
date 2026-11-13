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

The counts below include a second read later in November, after two more
runs (see "Job timeout"). The uploader and file counts are from the first
read (113 runs).

| | runs |
|---|---|
| pipeline v5 runs, June to November 2026 | 115 |
| completed | 99 |
| failed | 16 |
| any other status (running, queued, stuck) | 0 |
| distinct uploaders (developers included), first read | 23 |
| distinct files (by hash), first read | 65 |

| month | runs | failed |
|---|---|---|
| June | 6 | 0 |
| July | 64 | 13 |
| August | 22 | 1 |
| September | 1 | 0 |
| October | 19 | 0 |
| November | 3 | 2 |

Causes of the 16 failures, from the start of the stored error message:

| month | cause | runs |
|---|---|---|
| July | translation ("Localization failed"), model call exceeded the 90 s timeout | 7 (5 English, 2 German) |
| July | write to column `source_language`, which production did not yet have | 4 |
| July | PDF not found in storage | 2 |
| August | generic "PDF parsing failed" | 1 |
| November | job timeout ("Processing timed out before it could finish …") | 2 |

**Job timeout.** Cited by section 4.3.2. The worker cancels a job after
900 s (`arq_worker.py:362`) and the run ends as failed with a message to the
user. `parse_runs.page_count` is filled since October 2026; for those runs:

| pages | status | runs | median s | longest s |
|---|---|---|---|---|
| up to 50 | completed | 12 | 170 | 526 |
| 51–100 | completed | 6 | 392 | 704 |
| 51–100 | failed (timeout, 78 pages) | 1 | 901 | 901 |
| 101–150 | completed (largest 136 pages) | 2 | 846 | 904 |
| 101–150 | failed (timeout, 104 pages) | 1 | 900 | 900 |

Decks of 82, 120 and 136 pages completed in October, while decks of 78 and
104 pages timed out in November, so the page count alone does not predict
the limit. Where the limit lies was not measured.

Median duration of a completed run: 114 s. Seven completed runs took more than
an hour; these counts do not explain them.

**What it is and is not.** Light use, mostly by the developers, and few runs.
It shows that failures were recorded as failures and that no run was left
unfinished. It does not measure reliability under load.
