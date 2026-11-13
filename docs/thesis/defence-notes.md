# Defence notes

Short answers to questions an examiner may ask, with the source for each.
These are checked facts that the thesis text does not need, so they live
here instead of in the chapters. Code paths refer to the pin `dfc20df6`
(`git show dfc20df6:<path>`). No slide text and no names of lecturers.

Rule for the thesis text: an edit goes into a chapter only if it fixes
something false or unsupported, or strengthens a part of an RQ's answer.
Everything else that we verified goes here.

## Chapter 4: Turning a PDF into Pages

### 4.3.1 Admission control

**Why a monthly quota of 30 for students?**
It is a setting, not a derived number: 5 by default, 30 in production
(`backend/core/config.py:134`; production value in the compose environment).
It caps what one student's uploads can cost. The thesis says "chosen rather
than derived".

**Why a queue ceiling of 50?**
Also a setting (`config.py:101`, `arq_max_queue_depth`). With one worker
running at most four jobs at a time (`config.py:96`), a burst meets a 429
instead of an open-ended wait. It is not a measured capacity, and the thesis
says so.

**Is admission control the same on every route?**
No. The route the current interface uses (`materials.py`) applies the quota
but no queue ceiling, and the ceiling check fails open when it cannot read
the queue depth (`queue_depth` returns 0 on error). The thesis states both.

### 4.3.2 Asynchronous processing

**What happens to a very long deck? An 82-page deck took 703 s, and the job
timeout is 900 s, while uploads may have 300 pages.**
A job that exceeds the timeout is cancelled by Arq. The pipeline's own
exception handler then marks the run as failed, so it is a visible failure,
not a hanging one (`backend/workers/arq_worker.py:51–56, 212–224, 362`). If
the worker process dies outright, a sweep marks runs stuck for 25 minutes as
failed.

It happened in production in November 2026: decks of 78 and 104 pages failed
at 900 s with "Processing timed out …", while decks of 82 to 136 pages had
completed in October. So it is not the page count alone; [Inferred] the
speed of the model provider and the share of vision pages likely matter too.
We did not measure where the limit lies or how long a 300-page deck takes.
The code comment "up to 15 minutes for a 200-page deck" is an estimate.
The two timed-out uploads were physics lecture PDFs uploaded by a student
from outside the project, so they also show the pipeline meeting a subject
outside the two computer-science courses of the corpus.
The thesis states this as a limit (4.3.2;
`docs/thesis/evidence/parse-runs.md`, "Job timeout").

**Why does the current interface poll instead of using the event stream?**
It polls every 3 s (`src/features/spaces/data/useRunReading.ts:6`). No
recorded reason was found. Do not claim one.

**How does the reader show the original PDF at once?**
The browser's PDF viewer fetches the stored reading copy in 16 kB ranges
(`src/components/pdf/worker.ts:29`), so the first pages appear before the
whole file has arrived.

### 4.3.3 Planning the deck

**What does "deterministic" mean here? Show it.**
The same pages always give the same plan: no model, no randomness, no
network (`deck_plan.py:1–7`). Checked in November 2026: a made-up 6-page deck
gave an identical plan on two runs, and a real deck gave the same SHA-256 of
its plan on three runs. Because of this the step can be tested without
paying for model calls, including with property tests
(`backend/tests/unit/test_deck_plan_*.py`, `tests/support/deck_strategies.py`).

**Why 60 %?**
Nobody recorded a reason. It first appears as a default in the implementation
plan (`docs/superpowers/plans/2026-10-10-ai-backend-deep-session.md:146`).
We checked it afterwards (`docs/thesis/experiments/deck-plan-threshold/`):
- 50 % or 70 % change the boilerplate of 3 or 4 of 25 decks.
- The systems decks are insensitive: all 28 of their boilerplate lines recur
  on at least 90 % of pages.
- The database decks are sensitive: 51 of 54 lines lie between 60 % and 90 %.
- The band 50–70 % is the thinnest part of the distribution (9 lines in the
  whole corpus), but there is no clean gap: one real topic heading sits at
  58 %.

A wrong threshold changes only what the model reads and which pages it picks,
never the page text the learner sees.

**How are the roles assigned?**
`classify_role` (`deck_plan.py:115–128`) looks at the page after the
boilerplate is removed and asks, in order:
1. almost no text → empty;
2. page 1 → title;
3. the first line starts with a heading word (Inhalt/Agenda, Übung/Exercise,
   Zusammenfassung/Summary, Literatur/References) → that role;
4. short and numbered ("3. …", "3.2 …", "Kapitel 2 …") → section;
5. otherwise → content.

Sections start at section pages, and at agenda pages if a deck has two or
more agendas (`deck_plan.py:148–170`).

**Are the roles correct?**
They were not validated against human labels. It is a simple word rule. Known
misses are normal for such a rule: "Übungsblatt 3" → content (the whole-word
match fails), "Literaturverzeichnis" → content, and "Summary of …" on a
content slide → summary. The roles only steer which pages the quiz and the
title step read.

**Why does the quiz read at most 10 pages, each with at least 50 characters,
and only content, summary and exercise pages?**
- The 10 and the 50 are inherited from the old rule
  (`[s for s in slides if len(s) > 50][:10]`, `docs/DECK_LAB_2026_10.md:18`).
  They were kept on purpose, so the old/new comparison changes only *which*
  pages are picked.
- The role filter is new (`deck_plan.py:203`). [Inferred] A quiz needs facts
  to ask about, and a title, agenda, divider, literature list or empty page
  has none.
- The title and summary step reads at most 15 pages over title, agenda,
  section, summary and content, always including page 1
  (`deck_plan.py:250–262`).

**What was the quiz numbering bug?**
Before f34a7870 (PR #84) the quiz kept the first 10 long pages and labelled
them "Slide 1–10" instead of with their real numbers, and the number the
model returned was stored as a real page. Example: pages 1 and 2 are short,
so page 5 is shown as "Slide 3", and its question is stored at page 3. PR #84
says this "anchored every question to slide 0". Production disproves that:
32 of 524 questions (6 %) sat on page 1. All 524, though, sat on the first
eleven pages (`docs/thesis/evidence/deck-quiz-anchors.md`).

**Was cost a reason for the deck plan?**
A small one. Removing boilerplate saves about 9 words per page (14,875 words
over 25 decks; PR #84 and `docs/DECK_LAB_2026_10.md`). The main gain is that
the metadata and quiz steps read the whole deck.

### 4.3.4 Routing

**Footer or boilerplate: are they the same thing?**
No.
- **Routing footer** (`page_blocks.py:22–23, 185`): a text *block* in the
  bottom tenth of one page, in smaller type than that page's body. It is left
  out of the character count and out of the page summaries
  (`studio_summary.py:48–51`).
- **Deck-plan boilerplate:** a *line* that recurs on at least 60 % of a
  deck's pages, wherever it sits. It is removed from the text the model
  reads.

Demonstrated on a made-up 5-page PDF: a header repeated at the top is counted
by routing but removed by the deck plan, and a one-off source line at the
foot is left out by routing but kept by the deck plan. Neither changes what
the learner sees.

**Does the rule see drawn diagrams?**
No. Only embedded images count as figures. A diagram drawn with lines goes to
vision only if its page has fewer than 25 characters. How many corpus pages
this affects was not measured. (Optional: an offline labelling session of
about 90 candidate pages.)

### History questions

**Why was Docling dropped from production?**
It was never in the production image. `requirements-docker.txt` (6ce7b5f1,
May 2026) excludes it as "lazy import, parser v3/v4 only (brings in easyocr,
huggingface_hub, scipy, rtree — adds 30+ min to build)". v5 is built on the
v2 engine (4f19bd1e). It was removed from `requirements.txt` in October
(58114939, 8 security advisories). The benchmark measured 1.5–2.9 s per page
and a 1.2–1.9 GB memory peak (`LAB_LOG.md:230`).

**Why a paid API and not a local or university-hosted model?**
The first AI features ran on a local model. It was replaced after a few weeks
by the free tiers of hosted models, whose rate limits stopped bulk parsing. A
self-hosted model on a university GPU server was planned but not set up:
setting it up and running it would have cost time and needed experience we
did not have, and its cost would have been harder to compare. Thesis 4.1 and
`\cref{sec:provider-history}`.
