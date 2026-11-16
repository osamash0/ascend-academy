# Defence notes

Short answers to questions an examiner may ask, with the source for each.
These are checked facts that the thesis text does not need, so they live
here instead of in the chapters. Code paths refer to the pin `dfc20df6`
(`git show dfc20df6:<path>`). No slide text and no names of lecturers.

Rules for the thesis text:
- An edit goes into a chapter only if it fixes something false or
  unsupported, or strengthens a part of an RQ's answer. Everything else that
  we verified goes here.
- **Page budget.** The StPO BSc Informatik (25.01.2023) says "Der Umfang der
  Bachelorarbeit beträgt i.d.R. 25–60 Seiten". The body (chapters 1–7) was
  exactly 60 pages in November 2026. The target is about 50: every addition
  to a chapter names what it replaces or cuts.
- The main text names production only as evidence for an RQ answer, or where
  production differs in a way that changes a claim.

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

## Chapter 5: Closing the Loop

### 5.2 The Event Model

**Do all event writes go through `record_event`?**
All writes of the reading view do: views, turning back and completion
(`v4_reading_service.py:120–139`), quiz answers (`v4_practice_service.py:178–182`),
questions, check-ins and checkpoints (`v4_telemetry.py:46`). Three older
writers outside the reading view do not:
- search uses `insert_event` (`search.py:64`), which validates but has no
  savepoint;
- exams and review insert directly (`exams.py:124, 325`, `review.py:228`),
  after building the same Pydantic model, so their data is still checked,
  but a failed write would fail that request.

Exam mode and the review engine are behind flags that are off in production.
The thesis scopes the claim to the reading view for this reason.

**Why drop an event instead of failing?**
Analytics must never break reading. The insert runs in a savepoint, so a
refused row rolls back alone and the reader's page turn still succeeds
(`event_repo.py:64–91`).

**Why no foreign key from an event to its Lesson and page?**
The references sit in the JSON payload. That keeps the insert cheap and
simple, and the price is that the database cannot check the Lesson exists.

**Can a member forge events?**
Yes, about themselves, by inserting directly through the database interface
(the type constraint applies, the Pydantic models do not). Three guards
limit the effect on the owner's view:
- a trigger rejects a timestamp more than 300 s from the server's clock
  (`20261105010000`, lines 33–34);
- the engine reads at most 5,000 events per member (`space.py:29`);
- the engine reads only the payload keys it needs, and ignores pages beyond
  2,000.

**Does production match the repository?**
No. The table has no partitions, and there is no roll-up table, so
retention has never run (`docs/thesis/evidence/event-table.md`).
Production also has 90 public tables against the repository's 78 logical
ones (Appendix C).

### 5.3 Aggregation

**Does opening Explain or asking mean a reader needed help?**
Not necessarily, which is why the thesis says *reached for help* and calls it
a proxy. The code counts any one of four signals (`space_facts.py:72–75`):
- Explain opened: also curiosity;
- asked: also going further;
- "Still foggy" check-in: the most direct signal, a self-report;
- turned back: also revising.

Because any one counts, the signal errs towards flagging a page. The design
spec calls it a "per-page help index" (`2026-10-26-how-its-landing-design.md`,
B4) and records no validation.

**What about "unsure"?**
The code also counts an "unsure" rating, but the reading view offers only
"Clicked" (`got_it`) and "Still foggy" (`confused`), and the endpoint refuses
anything else (`v4_reader.py:340`; spec A8: "`unsure` unused"). The check-in
is optional, offered once per idea, and recorded on the idea's first page.

**Where do the thresholds come from (20 % hotspot, floor of five, …)?**
- No recorded source. The detector thresholds came in a work-in-progress
  commit in June 2026 (`0b2aa58e`), for the older professor dashboard.
- The floor of five came in October 2026 (`01951949`).
- Neither was calibrated on real readers, and both predate the study, so the
  study did not tune them.
- Honest answer: chosen, not derived. A minimum cell count of this size is
  common in statistical disclosure control (the threshold rule), but we did
  not derive five from it. Do not claim otherwise unless a verified source is
  added.

**Do duplicated events distort the numbers?**
Mostly not. Every page fact is a set of members, so counts are of distinct
people. Dwell is the exception: durations are summed per sitting, and a sum
above 30 minutes is dropped. The log has no idempotency key, and lost or
duplicated events were not measured.

**Do members' questions leave the server?**
Yes, in one step: the themes. Each asker's latest 3 questions, at most 60
per page and each cut to 300 characters, go to an external model (it prefers
OpenAI; `themes.py:32–36, 76, 169`). A filter then drops any theme that
repeats a question (four or more words in a row) and any theme with a word
only one asker used (`themes.py:89–144`). Whether a paraphrase can still
point to someone was not tested.

### 5.4 What the Owner Sees

**Can a member send a question to the owner?**
Not yet. The owner's screen already has a questions row
(`LandingScreen.tsx`, `QuestionsRow`), but it stays empty because the server
always sends `questions: []` (`v4_landing_service.py:132`). This is the code
behind 5.7's "a member cannot yet send a question to the owner".

**What does an owner learn below the floor?**
Whether anyone has read: Luna says either "Nobody has been reading yet…" or
"A few people have been reading…" (the `reach` word, `none` or `few`). Never
how many, and no numbers or map.

**Why 403 for members and 404 for everyone else?**
A member already knows the Space exists, so they are told it is not theirs.
A stranger learns nothing, not even that the Space exists
(`authorization.py:47–62`).

### 5.3 Signals and detectors (added after the walkthrough)

**Which signals does the engine read, and why these?**
Three kinds:
- what readers do: views with dwell, turning back, opening Explain, asking;
- what they say: the check-in, "Clicked" (`got_it`) or "Still foggy"
  (`confused`), optional, once per idea;
- what they get right: first tries at checkpoints and quizzes, graded on the
  server.

Each is a proxy. No finding fires on a request for help alone; only the
map's brightness and the landing number count it by itself.

**Why does the calibration gap matter?**
A confident check-in followed by a missed checkpoint is an overconfident
judgement. Dunlosky & Rawson (2012), *Learning and Instruction* 22(4),
271–280, general discussion 4.1, found that overconfidence made students
stop studying too early and retain less. We did not measure retention.

**Help seeking.**
Aleven et al. (2003, *Review of Educational Research* 73(3)) review on-demand
help: help use is linked to learning, but learners often use it badly. This
is not cited until the author has confirmed the passage.

**The leaky bucket with rising counts (6-6-6-5-2-6-6)?**
No leak. The engine counts the readers still in the Lesson, meaning everyone
who read the page or any later one (`space_engine.py:106–124`). Only people
who never come back make a drop. Only the single worst drop of 20 % or more
per Lesson is reported, with at least 3 people before it.

**Skipped page and title pages.**
A skipped page (median dwell under 5 s, 5 views, under 20 % confused) is
shown to the owner as "A page that's being passed over". The engine does not
know page roles, so a title page can be a false alarm. Connecting the deck
plan's roles is future work.

**Overpacked.**
All of these must hold:
- at least 5 views;
- at least 30 % confused;
- median dwell at least 1.5 times the Lesson's median;
- and either at least 0.3 questions per viewer, or a dwell spread with a
  coefficient of variation of at least 0.8 (`detectors.py:35–39, 42–56`).

**Why does the v4 reader send one call per page left?**
At first the v4 reader recorded nothing, so v4 readers looked absent. Since
commit `99904eea` (October 2026), one server call per page left writes the
progress, the visit, the streak and the events in one transaction, through
`record_event`. The older reader still writes events straight from the
browser (`studentService.ts:131–139`), which is the source of the
direct-insert path in 5.2.

### 5.5 Privacy by Design (details cut from the text)

**Was there a fault before the pin?**
Yes. A student who owned a Space could read members' user ids and their tutor
questions, word for word, through the analytics routes of the older
interface. PRs #175 and #176 closed it before the pin.

**What exactly does the professor policy expose?**
The `learning_events` rows, with user ids and without names, of every user
enrolled in any course the professor owns, not only the Space in question.
It withholds only the questions asked in the reading view. No screen uses
it. PR #184 narrows it to the professor's own Lessons. It is prepared, not
applied.

**Is the floor k-anonymity?**
No. It is a minimum-count threshold on released statistics, of the kind
statistical disclosure control applies to the cells of published tables.
k-anonymity is a property of released records. The floor is enforced only in
the engine's code; no database rule enforces it.

## Chapter 6: Trusting the Machine

### 6.2 and 6.3 (details cut from the text)

**Did retrieval work before the scope bug was fixed?**
In one other Space, yes: the retrieval measurement of September 2026 found
the right page among its six hits for 26 of the 27 questions it could run
there (96 %), under the old join. The bug (commit `b66a97c6`, PR #96) hid
40 of 68 rows in the Space it was found in; no record says how large the
blind part was elsewhere.

**Could an owner always ask in their own Space?**
Not before PR #173: an owner who had not joined their own Space got a
server error from the ask bar.

**When did the marker rewriting arrive?**
With PR #179, before the pin. At the previous revision the prompts inserted
retrieved text raw, and the reading view's prompts did not have the
"data, never instructions" rule.

**What does Luna's validator promise?**
Its file opens with the rule for Luna's structured output: nothing the model
writes reaches a learner unchecked; the validator drops what fails and never
shows it broken (`luna/validate.py`). It holds for the structured parts
(pages, phrases, check questions), not for Luna's prose.

**Is the mini-app only contained by the browser?**
The server also drops an app whose code names the network, storage, the
surrounding page, `eval`, or any `http(s)://` address
(`v4_reader_service.py:501`, applied at `:526`). That is a deny-list, which a
determined author could evade, so the thesis rests the claim on the browser:
`sandbox="allow-scripts"` without same-origin (`Sandbox.tsx:145`) and a CSP of
`default-src 'none'`, images only from `data:`/`blob:` (`Sandbox.tsx:30`).

**How are members' questions fenced in the themes prompt?**
Each question is a JSON string (`json.dumps`), so it cannot close its own
quotes, and the prompt says the questions are "data to summarise, not
instructions to follow" (`insights/themes.py:76–80`). The prompt does not use
`inert()`. The output filter drops any theme with a word only one asker used
(`themes.py:113–144`), so one member alone cannot put a word of their own into
a theme.

### 6.2 The hierarchy of scopes (why the three ways to ask differ)

**Why do the three surfaces see different amounts of material?**
They form a hierarchy of scopes, and each answer starts from the least
material its question needs (the author's design idea). At the pin:
- Explain: the open page and the titles of pages p−2 … p+2
  (`v4_reader_service.py:728`); Ask: the open page, the conversation's last
  turns and the question (`:854`). Neither searches.
- Luna: the step's target page and the page the learner reads, each with one
  page either side (`luna/context.py:23`). Only in a "connect" step does it
  search the rest of the Space: full-text, 3 hits, the current Lesson
  excluded (`session_service.py:114–117, 274–277`; `find_in_course`,
  `v4_reader_service.py:968`).
- Ask bar: hybrid search over the Space's live Lessons, best six
  (`ai/retrieval.py`).

**What is the evidence that less material helps?**
Shi et al. (ICML 2023) show that irrelevant context lowers the accuracy of
language models. Liu et al. (TACL 2024) show that models use information in
the middle of a long context less well. Neither tested our system; we did not
measure what a wider scope would do to Explain.

**Is there evidence against it?**
Yes, and an examiner may know it. Cuconasu et al., "The Power of Noise"
(SIGIR 2024, pp. 719–729, doi:10.1145/3626772.3657834), found that adding
random documents to a RAG prompt could raise accuracy in their setting, while
related but irrelevant documents hurt it. The honest reading: what hurts is
material that looks relevant but is not, which is what a wide search inside a
Space tends to return. Narrow scope avoids that by not searching at all.

**What does the narrow scope cost?**
The checks weaken as the scope narrows: Explain and Ask have no retrieved set
to check a citation against, so only the block structure is checked, and the
fallback is the original page one key away (6.1). A question that needs
another page cannot be answered there; the prompt tells the model to say so.

**Is the scope also a security boundary?**
For the ask bar, yes: the Space restriction is in the SQL query, not a filter
afterwards (migration `20261014000000`), and the caller must be a member or
the owner. A narrow scope cannot leak another Space's material into an answer.

**Why was the reliability remark cut from 6.2.4?**
For space. The point stands: a learner cannot perceive a trust mechanism that
no screen shows, which limits what a later study of perceived reliability
could find.

**Can the refusal gate be tested without a model?**
Yes. The gate is a pure function of the retrieved list (`tutor.py:302–347`),
so a test asserts on it with no model call. Cut from 6.2.2 for space.

**Is "the checks weaken as the scope narrows" a general law?**
No, it describes this system as built, and the sections show it: the ask bar
has a refusal gate before the model and a citation filter after it (6.2.2);
Luna's validator checks the pages and phrases it names (6.2.3); Explain and
Ask are checked only for the structure of their blocks (6.2.3). Figure 2.1
draws the same order. A narrow scope does not force weak checks; we simply
built no content check for the reading view.

**What happens when a question on a page needs another page?**
Nothing in code. Only the prompt rules decide (`v4_reader_service.py`):
- both Explain and Ask: "On factual pages (schedules, contacts,
  requirements), use only stated facts … say it is not given" (`:615`);
- Explain only: "On conceptual pages, add intuition, a clearly hypothetical
  concrete example, or the mistake students make" (`:636`), so on a
  conceptual page the model is invited to add knowledge of its own;
- Ask only: "say so plainly if the slide or lecture does not cover
  something" (`:774`).
No validator checks whether the model followed them.

### 7.4 The learner's own loop (future work)

**What is the learner's loop?** Chapter 5's loop sends what many learners do
on a page to its owner, who may change the page. The learner's loop sends
what one learner does back to that learner: a page they marked *Still foggy*
or asked about with Ask would start a Luna session on that page, and its
questions would come back later as practice cards. The owner's loop improves
the material for everyone; the learner's loop helps one person go back to
their own weak pages.

**Why does the text not mention Luna's memory?** Luna also keeps short notes
about the learner, written at the end of each session. The thesis never
defines them, and chapter 3 uses "notes" for the learner's own notes, so the
paragraph says only what Luna lacks: the reading view's signals.

**What exists today?** Luna plans a session from the Lesson, the open page,
the learner's first message and its notes from earlier sessions
(`luna/prompts.py:114–119`); the notes are written only at a session's
wrap-up (`session_service.py:383`). Luna's revisit deck shows only cards from
Luna sessions (`luna/store.py:230–242`, `source_type = 'luna_session'`). The
reader offers a session whenever the learner is not following the timeline
(`lights.ts:123`, `lunaReady: !following`), not because of any signal.

**What would be new?** The reading view's own signals (a *Still foggy*
check-in, a question asked in Ask) would start a Luna session on that page
and add its questions to the revisit cards.

**Why is it safe for privacy?** The learner sees only their own events, so no
other person is shown; the floor of five in Chapter 5 protects members from
the owner, which this loop does not involve.

**Why is it not a claim about learning?** It is not built or tested. Whether
it helps is for the controlled study proposed first in 7.4.

### 6.4–6.7 The second model, failing open, and the RQ3 answer

**Is the checker always a different model from the writer?**
No, only while the provider chains do not fail over. The check prefers the
head of the quality chain (Groq's reasoning model, `CHECK_MODEL = "groq"`,
`parser/synthesis.py:76–80`); the question is written on the bulk chain. Both
chains hold the same eight providers in a different order
(`orchestrator.py:389–393`), so after failovers both calls can land on the
same model. In OpenAI-only mode (off) both chains collapse to `["openai"]`
(`:396–397`); with production's empty model settings that is gpt-4o-mini for
both, the model that agreed twice with the wrong key of the question that
started the work (code comment at `synthesis.py:76–79`).

**Why a different model at all: the literature or our own measurement?**
Our own: the pull request records that a model of the writer's family agreed
with the wrong key twice. Self-preference (Panickssery et al.) supports the
choice; it was not the recorded reason.

**What does "fails open" mean here?**
When the checker errors or returns an unreadable reply, the question is kept
(code comment: "A failed or unreadable check keeps the question as before").
The system gives up the check of one key so that an outage does not empty a
quiz. Failing closed would drop every question during an outage.

**Is a translated quiz checked?**
No. `_validate_translation` (`localization_service.py:181–213`) compares
ids, slide numbers, question count, `correct_answer`, and option count. It
does not read the translated wording, so the answer check vouches only for
the original language.

**Why does 6.7 have two parts and not three?**
RQ3 was narrowed in November to "checked before learners see it, and what
happens when a check fails". The measurements (6.5) now support the first
part instead of answering a separate "how can it be measured" question.

## Chapter 1: Method

### 1.5 The seven evaluations

**Why seven evaluations, when a bachelor thesis usually has one?**
Each answers a part of a research question, and each is small and scoped to
what it can show. One per chapter carries the answer; the others support it:

| RQ | Main evaluation | Supporting |
|---|---|---|
| RQ1 | extraction benchmark (24 pages, 283 blind votes, protocol committed before the first vote) | routing study, deck-plan scorecard |
| RQ2 | study with scripted readers (every planted behaviour flagged at each of 100 seeds; 18 of 23 expectations in the published run, median 17 over 100 seeds, 16 for an engine that reports nothing) | none |
| RQ3 | the 16 pairs (lexical score drops 14 good keys; similarity keeps 8 wrong ones and fails its criterion; answer check makes no error in the calls that returned a verdict) | refusal gate (27 of 27 answerable let through, 30 of 30 refused, narrow margin) |

**Why a simulation for RQ2 and not real readers?**
Real reading data did not arrive: in 56 days, 4 Spaces had a member who
read, at most 6 readers in one Space, and 1 page reached the floor of five
(`docs/thesis/evidence/readers.md`). The engine behind the owner's view is a
pure function of its input, so scripted readers with planted behaviour test
exactly what the code does with known input: does the view say what it
should, and stay silent when it should? It does not show how real learners
behave, or whether an owner acts on what the view says. The expectations
were written before the run but committed with the results (1.5).

**Which evaluation is the weakest, and why keep it?**
The answer check: it was built for one real failing question and measured
on the same 16 pairs, with no criterion fixed in advance; its wrong keys are
on the topic but plainly false, and its other options are off the subject
(6.5.3). It stays because it is the check that runs in
production, and the thesis calls its result promising, not proven.

### 5.6 The study with scripted readers, after the seed sweep

**What did the supervisor's example thesis teach us?**
An earlier bachelor thesis from the chair, which the supervisor shared,
evaluated its system with a simulation and no users. Its simulation stood in
for the environment, not for people; it fixed its requirements before the
results, marked one requirement as only partly met, and left the user study
openly to future work. It gave no source for evaluating without users, a thin
model description, no baseline, and no variation. We kept what it did well
(criteria fixed first, honest scope) and added what it lacked: a source for
synthetic learner data (Berg et al.) and for verification versus validation
(Boehm), the personas' values in Appendix C, a baseline (the engine that
reports nothing), and variation (the seed sweep). We copied no text from it.

**Is 18 of 23 a good result?**
Not on its own. An engine that reports nothing meets 16 of 23, because 15 of
the expectations ask for silence, nine of them in the control arm. Over 100
seeds the engine met 16 to 19 (median 17); the published run was a good
draw. The robust result is per kind: every planted behaviour was flagged at
every seed (a finding on page 10 and a speed bump on page 12 in arm A; a
leak and skipped pages in arm E; a calibration gap in arm F), and the
control arm of four members stayed silent at every seed.

**Why did arm A show "overpacked" in 81 seeds instead of the hotspot?**
Overpacked pre-empts the hotspot on the same page when confusion is at least
30 %, at least 0.3 of the readers asked, and the page's median dwell reaches
1.5 times the Lesson's. In arm A page 10 has 50 % confusion and every
struggler asks, so the dwell decides: the median of twelve readers falls
between the slowest steady reader and the fastest struggler, about 1.5 to
1.7 times the Lesson's median, and the draw puts it on either side of the
line. For the owner both name page 10.

**Was the sweep decided after seeing the data?**
The protocol and the driver were committed first (`8ba95552`, 17:14:01 on
15 November 2026); the run took eight seconds right after it, and the
results followed (`03e8c92b`). Seed base 0 reproduced the published run
exactly. Two predictions missed narrowly and are reported: the hotspot of
arm A in 19 seeds, not 20 to 60, and one calibration gap in arm A.

**Is the study a validation of the rules?**
No. It verifies that the engine implements its rules; whether the rules
describe real reading would need real readers (Boehm: building the product
right versus building the right product).

**What would a study with real owners look like?**
One course over a term: the lecturer gets the owner's view, and we record
which flagged pages they change and whether the signals on those pages
change for later readers, plus a short interview on whether the findings
read as intended. It needs at least five readers per page per week to show
the weekly numbers, which is why the quiet weeks before the exams gave no
data.

**What did the sweep correct in the notes?**
Three statements in the study notes of 9 November were wrong and are marked
there: arm B did light the Lesson, the thresholds were not tuned for real
ratios (they have no recorded source), and a different seed does change
which kinds fire (arm A).

### Details cut from chapter 6 on 15 November (for oral questions)

- **How many deck-quiz questions does the code accept?** At most twelve
  (`parser/synthesis.py:52`, `MAX_DECK_QUIZ_QUESTIONS`; Appendix A lists it),
  because the code does not trust the length of a model's list.
- **What happened to a question whose key did not resolve, before June 2026?**
  It was stored with option A as its key (fixed in `f25dd41c`). Since then the
  code drops it, and says why: a wrong answer key is worse than fewer questions.
- **What does the parse receipt record?** The outcome of every stage of the
  question lifecycle for each Lesson (Figure 6.1: "counts written to the parse
  receipt"; Appendix C, cost as a question of trust).

### Details cut in the first round of shortening (15 November)

- **Why did the pipeline become dependable?** In our experience only when one
  path remained: by the end of May 2026 the upload route switched between four
  parser paths, none removed; two of the three tables that no live code writes
  and several faults in chapter 4 trace back to that state. Not measured.
- **Did the system run ahead of its users?** Yes: review, exams, badges, and
  analytics were built before learners arrived, and production switches on
  four of twelve flags. Feature toggles accumulate as debt (Rahman et al. 2016;
  Hodgson 2017); here it showed as menu entries that led to "not found" until
  the build derived each interface flag from its backend flag in October.
- **Other drift between documents and the system:** the nginx comment says
  the proxy strips a path prefix it keeps (`nginx.conf:24`); configuration
  named a server the system did not run on; the production database has a
  column no migration defines and a migration history of two entries; until
  October a storage bucket let anyone download every lecture PDF.
- **Recall of the ask bar's retrieval in the refusal-gate run:** the expected
  page was among the first five hits for 25 of 27 answerable questions (the
  grid's closest setting to the six hits the ask bar keeps).
- **The retrieval join bug:** the scoped search joined embeddings on a column
  that is empty for most rows; PR #96 fixed it with a database test that fails
  on the old join.
- **The first grounded tutor** (`8d2eb095`, May 2026) refused everything
  outside the retrieved pages; `f39e93dc` (June 2026) removed the refusal from
  the older interface's tutor.
- **Event table detail:** the migrations also declare a default partition and
  four indexes (user, lecture, type and time, GIN on the payload); an unused
  `pseudonymize.ts` helper from an early plan for pseudonyms is still in the
  frontend.
- **Owner gate in the browser:** the owner's link is visible only to the
  owner, and the browser sends anyone else back to the Space; the server's
  403/404 is the real gate.
- **The older professor dashboard:** since PR #175 it applies the floor of
  five and returns no rows per student; since PR #176 its routes require the
  professor role (Appendix C, authorisation).
- **Account deletion** is an ordered job that survives a crash (PR #90).
- **The layout view:** backend PR #182 is on main and switched off; the
  reading-view part PR #183 is not on main.

### Details cut in the second round of shortening (15 November)

Chapter 4:
- 12 of the 1,593 pages have fewer than 25 characters: eleven empty closing
  photo pages and one summary page with 11 characters.
- The measured 82-page deck took 703 s from upload to a complete reading
  view; the last three and a half minutes passed after the worker had written
  the last page (`docs/thesis/evidence/reader-timing.md`).
- Thirteen of the 16 failed production parses fell in July: seven translations
  over the 90-second model timeout, four writes to a database column that
  production did not yet have, two files missing from storage.
- An older upload route still streams progress as server-sent events over
  Redis pub/sub; the current interface polls. Making the server the only
  writer of parse output was one reason for rebuilding pipeline v5.
- Lineage in one sentence now; the three design steps (v5 server-only writer,
  v3 not default because Docling was too heavy, the 25-character threshold of
  June) stay in Appendix C.
- Routing details: text pages are batched eight per call with a one-call
  fallback; vision pages render at twice the base resolution; the footer is
  also left out of the optional page summaries (`studio_summary.py:48-51`);
  a generator-aware classifier was deleted in September 2026 and a second
  router has no caller.
- Idempotency in full: the hash names the stored object; upserted outputs and
  embedding reuse make a re-parse safe; lecture reuse; each mechanism covers a
  gap the others leave (Appendix C, "The Nine Idempotency Mechanisms",
  with its figure).
- The benchmark's deviations one by one: line breaks; vision models plus a
  second comparison; heavy local engines plus a third; the PaddleOCR build
  plus a fourth. The four comparisons were judged between 30 October and
  1 November 2026. The current extraction came second to last, above only
  MarkItDown.
- The deck-plan scorecard now lives in Appendix C, with the PR #84 numbers.

Chapter 2:
- Paper Plain was evaluated with 24 participants; Learn Your Way comes from a
  team at Google, and its trial had students aged 15 to 18.
- The January proposal compared the project with quiz and presentation
  products from public product pages; not repeated in the thesis.
- Literature no longer cited because its paragraph was cut: the doing effect
  (Koedinger et al. 2015), multiple representations (Ainsworth 1999, 2006;
  the reading view is consistent with it, not derived from it), human versus
  intelligent tutoring (VanLehn 2011), a model-generated conversational tutor
  that changed perception but not learning (Schmucker et al. 2024), and two
  gamification sources (Deterding et al. 2011; Hamari et al. 2014). SM-2
  (Wozniak 1990) is now cited in chapter 3.
- HNSW (Malkov and Yashunin) is now cited in Appendix C, where the index is
  described.

### Details cut from chapter 4 in the third round (15 November)

Deleted from the thesis, not moved; Appendix C already holds the items marked
so.

- **Admission control (the whole subsection).** The API checks
  authentication, a rate limit of five uploads per minute (ten on the route of
  the current interface), and that the uploader owns the target Space; it reads
  at most 50 MB and validates type, signature, and page count (at most 300).
  For students it claims a monthly quota atomically (five by default, thirty in
  production). Queue backpressure answers 429 once 50 jobs wait; one worker
  runs at most four jobs. These limits are settings, chosen and not measured.
  Outside development the API never parses inside the request. Two
  qualifications: the backpressure check fails open when it cannot read the
  queue depth, and the route of the current interface applies the quota but no
  queue ceiling, so admission control belongs to each route, not to the
  pipeline. The text keeps one sentence and points to Appendix A for the
  limits.
- **Providers (paragraph).** Bulk and quality chains; a spending cap per user
  and day; the privacy policy names OpenAI, Groq, Google and OpenRouter, while
  the default chains also call Cloudflare and Mistral (Appendix C keeps this);
  the OpenAI-only mode was off at the pin.
- **Chapter opening.** The "found, then fixed" convention and the pointer to
  the deployed state. Appendix C now gives the months of the two older
  revisions itself.
- **Third demand.** The first AI features ran on a local model, replaced after
  a few weeks by the free tiers of hosted models.
- **Pipeline.** The code calls v5 "unified"; Docling is no longer installed.
  Tests named before: `test_parse_runs_stalled_sweep.py` (the stuck-run sweep)
  and `test_job_locks.py` (the lock against parsing one file twice at once);
  `test_unified_pipeline_e2e.py` stays in the text.
- **Asynchronous processing.** Redis keeps jobs across restarts; the interface
  polls the run every three seconds (`useRunReading.ts`); for later visits and
  other devices the worker stores a copy rewritten so that its first page
  arrives sooner, which the browser fetches in 16 kB ranges.
- **Deck plan.** The role rules in full: the first page is the title, a page
  with almost no text is empty, a short numbered page such as "3. Scheduling"
  starts a section, a first line "Inhalt", "Übung", "Summary" or "Literatur"
  makes an agenda, exercise, summary or references page, and every other page
  is content. The step entered in October 2026 (PR #84); the old filter
  numbered the pages it kept 1 to 10.
- **Routing.** Text pages are synthesised eight per model call; the parse
  receipt stores the reason for each page's route; before November four places
  in the code decided with three measures; `backend/eval/routing_check.py`
  fails if the image pages sent to vision leave 75 to 100.
- **Idempotency and failures.** The lock is best-effort by decision; the
  worker never retries automatically although one setting reads as if it did
  (Appendix C keeps both).
- **Routing study.** File names `routing-labels-2026-11-05.csv` and
  `routing-signals-2026-11-05.json`; footer-free characters are counted as
  PyMuPDF's block-level extraction counts them.
- **Benchmark design.** One deck per course plus two exercise sheets of the
  software-engineering course, treated as a fourth source; seeds 20261030
  (page draw) and 20261103 (bootstrap); a prior of one virtual drawn game per
  method (protocol, section 7); page types lists 8, diagram 5, dense text 5,
  layout 3, table or formula 3; deviation 2 chose `gpt-6.1-sol`.
- **Benchmark numbers that Figure 4.3 shows.** Marker 1141, Docling 1128,
  OpenDataLoader 1112, PaddleOCR 1037, pdf.js 1007, MarkItDown 952. Corrected
  lower bounds: 1331 and 1251 (vision), 1164 (pymupdf4llm), 1068 (MinerU), 1030
  (OpenDataLoader); Marker 958, Docling 983. First round alone: 1321, 1311,
  1063, 1055, OpenDataLoader 916. Page bootstrap: 1325, 1243, 1150, 1078,
  OpenDataLoader 987. The quick "both unusable" verdicts had a median of 3.2 s.
- **Where the methods differ.** MinerU breaks lines as often as the text layer
  (21 % of line pairs) and 18 % of its words are not in PyMuPDF's text layer;
  Docling 7 %, Marker 8 %. Footer counts: OpenDataLoader 4, Marker 1, MinerU 0.
- **Cost.** Current 0.004 to 0.058 s per page; pymupdf4llm 0.56 to 0.93 s;
  vision $0.04 (`gpt-4.1-mini`) and $0.17 (`gpt-6.1-sol`) for the 24 pages.
- **What follows (paragraph).** pymupdf4llm stands 263 points above current,
  about 4.5:1, without a fee, under a second more per page and about 330 MB
  more memory; the two met directly in three duels (two wins, one "both
  unusable"). The deck plan removes the footer from the model's input but not
  from the stored text. The text keeps "we did not change the production
  parser at the pin" in the answer.

### Details cut from chapter 5 in the third round (15 November)

Deleted from the text; the code references the text dropped are listed with
their lines.

- **Names that repeated the sentence.** `EVENT_REGISTRY` and `extra="forbid"`
  (`backend/schemas/learning_events.py`); the function `record_event` (the text
  keeps `event_repo.py:64-91`); `MIN_READERS = 5` (the text keeps
  `space_engine.py:25`); `LANDS_BELOW = 0.2`; `LANDING_TTL = 300`
  (`backend/services/v4_landing_service.py:49`, line 53 at `2e146f51`);
  `assert_space_owner` (the text keeps `domain/authorization.py:47-62`).
- **Table 5.1.** The nine types that the engine does not read, by name:
  `lecture_start`, `micro_quiz_attempt`, `login`, `search_performed`,
  `exam_generated`, `exam_submitted`, `review_graded`, `lecture_uploaded`,
  `onboarding_completed`. The table now names two and counts nine.
- **Storage.** References to the Lesson and the page live inside the payload
  without a foreign key, which trades enforced integrity for a cheap insert. A
  daily roll-up table exists in the code but not in production, and the
  retention script would fill it before it deletes anything; the script is
  neither a job of the worker nor a service of the deployment.
- **Facts.** "Read" means a view with positive duration.
- **Weekly numbers.** The third number weighs every member equally: one who
  answered one question counts as much as one who answered ten.
- **Themes.** At most twelve words per theme and five pages per view; the
  result is cached for 30 days; the model sees at most 60 questions per page.
- **Dwell.** The roles of the deck plan could keep a title page from being
  reported as skipped (future work).
- **Pseudonyms.** The older dashboard's pseudonym was an unsalted hash of the
  user id, the same in every course; PR #175 removed it.
- **Repeats.** The opening's bridge sentence ("what readers do ... travels
  back to the person who wrote them"), a sentence in 5.1 that the figure's
  paragraph repeats, the RQ2 answer's lead-in line, and "retention has never
  run" in the answer's last paragraph (5.2.2 states it). Dunlosky and Rawson
  are no longer named in the sentence; the citation stays.

### Details cut from chapter 6 in the third round (15 November)

History and the older interface, deleted from the text:

- **The blind scoped search.** Until October 2026 a wrong join hid 40 of 68
  pages of one Space from the ask bar (commit `b66a97c6`, PR #96, with a
  database test that fails on the old join); no record says how large the
  blind part was in other Spaces. The point it made: every later check depends
  on retrieval, and a refusal gate or a citation check is worth nothing when
  retrieval does not see the material.
- **The older tutor's refusal.** The tutor of the older interface lost its
  refusal in June 2026 for a reason the repository does not record (Appendix
  C, "The Change of 24 June"); it no longer reaches students, and the ask bar
  kept the gate. Nothing in chapters 1 to 7 points to that appendix section
  any more.
- **Citations nobody saw.** At the revision of August 2026 (`0be0081`) no
  screen in use showed the citations that the server computed (the
  citation-gap figure in Appendix B, now referenced only from there).
- **The older review page.** It marks a batch as reviewed only in the
  professor's browser (`src/pages/BatchReviewPage.tsx`).
- **Retrieval settings,** now only in Appendix A: similarity above 0.65 for
  the vector search, at most 12 hits from each search, fusion constant 60.
- **Property tests.** Appendix C also reports two cost defects that planning
  the property tests uncovered; chapter 6 now points there only for the case
  of a failing provider.

### The appendix pass (15 November)

Deleted from Appendix C, because no chapter needs them:

- **Deployment and Operations (with its deployment figure).** Five containers
  on one Hetzner CX23 (two vCPUs, 4 GB, Ubuntu 24.04): `frontend` (nginx on
  port 3000, loopback only, forwarding `/api/`), `api` (FastAPI, one uvicorn
  worker, 512 MB), `worker` (Arq, 512 MB, up to four jobs), `redis` (cache,
  256 MB, LRU eviction), `redis-queue` (broker, 128 MB in a 160 MB container,
  no eviction, append-only). TLS by the host's nginx with Let's Encrypt; that
  configuration lives only on the server (the deploy runbook documents it);
  DNS at Cloudflare without proxying; Supabase in the EU (Ireland) on the free
  tier, without point-in-time recovery. Until November the repository held
  four compose files, none naming the host in use; the staging and Oracle
  files were deleted and the production header fixed. The host proxy
  configuration and the dump script exist only on the server; the runbooks,
  the heartbeat and the scripts that encrypt and upload the dump are
  versioned. Deploys are manual with rollback tags; a five-minute heartbeat
  checks readiness, the containers, the public site, disk and memory, and the
  certificate; the nightly dump is encrypted with `age` and kept 14 days in EU
  object storage. `/health/ready` reports ready with the database
  `not_configured` when no database URL is set, although the pipeline and the
  routes of the current interface need the pool (a latent gap, not a live
  fault). Chapter 3 now states the deployment facts in four sentences.
- **The prose of the pipeline lineage (the table stays).** Pipeline v5 (June)
  made the server the only writer of parse results; on the deck that had
  exposed v4's blindness it routed 88 of 143 pages to vision. Pipeline v3 with
  Docling never became the default: the configuration stayed at version 2
  until 28 June and then jumped to 5. The production image left Docling out
  because of heavy dependencies and a build over 30 minutes (`6ce7b5f1`); v5
  was built on version 2's PyMuPDF engine (`4f19bd1e`); Docling left the
  requirements in October after eight security advisories, with no quality
  reason recorded. The 25-character threshold came with v5 on 17 June
  (`bd03f1d5`) and was applied in four places with three measures until the
  one routing rule of 6 November. The table's caption now cites
  `docs/timeline/` (on main).
- **The two provider sections, merged into one.** Kept: the chains, the
  failure classes, the six credentials, the privacy-page gap, the history in
  brief, the open question whether stored vectors mix two embedding models,
  the OpenAI-only mode in full, and the cost controls. Deleted: the failover
  figure; the registry's fields (model, credential, daily limit, requests and
  tokens per minute, date verified); a 403 does not disable a provider,
  because one provider answers a moderation-flagged prompt with 403; the
  classification partly matches exception text; the wrapper's eight
  rate-limit attempts run under a 25-second default timeout that fits at most
  four; two found-then-fixed failure classes (at `0be0081` a provider without
  credit was retried on every call, as Cerebras later failed, and payment
  errors became permanent in September; at `2b8b1f7b` a rejected key was
  retried until 401 became permanent in November); a test fails when a
  provider's limits were verified more than 45 days ago; the chains were
  revived in September after eight of nine entries were found dead; the
  gateway blocked start-up when unhealthy; the ledger detail (Gemini 228 calls,
  208 of them embeddings; Groq 95, led by Luna sessions 29 and Explain 28;
  OpenAI bulk generation 249); what ran the October OpenAI embeddings was not
  identified (`embeddings.py:24`).
- **A Hosted Parser, Tried Once.** LlamaParse on one deck, 31 October 2026:
  it mis-numbered pages until a page separator was configured, its Python
  package had been unmaintained since 1 May 2026, it added a dependency, and
  it would send every uploaded page to LlamaParse, which the privacy page
  names only for uploads that select that engine. The record is
  `docs/thesis/experiments/llamaparse-trial-2026-10-31.md`; not adopted.
  Chapter 4 no longer mentions it.
- **Schema Notes.** 768-dimensional vectors with an HNSW index on cosine
  distance (the HNSW citation moved to the decisions table); the two
  embedding models are not comparable; tables without a live writer (text
  chunks with their own vector index, per-page parse records, the
  concept-mastery table, whose writer returns early); three badge names
  missing from the catalogue, so awarding them silently does nothing; the cost
  ledger keeps no foreign key so that it survives the deletion of runs; the
  event log keeps a foreign key to its user for the deletion cascade.
- **"A boundary repaired in steps"** repeated the opening of "Hardening as a
  Sequence", which follows directly.
- **The Change of 24 June, with its TODO.** The older tutor's refusal was
  removed on 24 June 2026 in commit `f39e93dc` by the co-developer, without a
  message body, one minute after a commit titled "debugging AI Tutor". A
  comment in the diff says the tutor should not refuse outright "if the
  question is conceptual" and should send every question to the model "so it
  can provide supplementary knowledge". The test that expected the refusal
  was adjusted four days later (`8f986043`). The TODO asked the author to ask
  the co-developer why; the question stays here for the defence.

Deleted from Appendix B (the sources stay in `thesis/figures/src`, and
`figures/MANIFEST.md` marks the figures as not wired):

- **F9b**, the learner-facing half of the schema (17 tables: practice, Luna
  sessions, notes, gamification). The schema section now names what they
  serve.
- **F15**, the hardening arc (nine steps in two phases). "Hardening as a
  Sequence" gives the three classes of fault with their migrations.
- **F16**, the citation gap (at `0be0081` no screen a student could reach
  showed a source). Chapter 6 no longer tells that history.

Tooling: `scripts/lint_tex.py` now counts figures placed with a plain figure
environment (Figures 3.1 and 4.3) and expects 20. After Figure 4.3 left
`\thesisfigure` it had warned "only 18 of 19 available figures are used", a
non-blocking warning that went unreported in the chapter 4 summary.

### Details cut from chapters 1, 3 and 7 (15 November)

- **Chapter 3, repeats and trivia.** The platform's first idea was to stand
  between the learning management system, which stores files, and the AI
  assistant, which knows nothing about the course. The code calls the
  Library's uploads "materials". Older routes reach the database through
  Supabase's web interface at roughly 360 call sites (a comment in the
  production compose file records the count). The opening listed what the
  chapter covers; the section titles say it. "Only its owner can publish it"
  repeated the sentence before.
- **Chapter 3, numbers that chapters 4 and 7 give.** The benchmark rates nine
  of the ten alternatives above the current extraction on points, five at
  the corrected lower bound and four when pages are resampled. The corpus:
  25 decks with 1,593 pages from two courses of one university, in English
  and German; the benchmark's 24 pages from five PDFs of three courses.
- **Chapter 3, two stale pointers fixed.** PR #182 (the backend of a fourth
  view of a page, switched off) pointed to the outlook, which no longer
  discusses it; the provider chains pointed to chapter 4, which no longer
  describes them (Appendix C does).
- **Chapter 7.** That the production extractor "is what remained when we
  removed other tools for memory, cost, or complexity" now stands only in
  chapter 3.
- **Chapter 1.** Unpacked only; nothing deleted.

### The layout pass (16 November): appendices cut, verbatim
Appendix A (constants), six diagrams of Appendix B, and ten sections of
Appendix C left the thesis. Their LaTeX follows unchanged, so nothing is
lost for the oral defence. What stays in the thesis: the pipeline diagram,
the lineage table (with the workbench's two corrections and months only),
the scripted readers in detail, and the table of declared and deployed
database rules. The figure sources stay in `thesis/figures/src`.

#### Appendix A, Verified System Constants

```latex
\chapter{Verified System Constants}
\label{app:constants}

Every value below is a default in the code at revision \thesisCommit{},
read from source and not from project documentation. Where documentation
states a different default, the documentation is out of date; see
\cref{sec:reality-vs-documented}. Twelve values, marked~$\dagger$, can be
overridden by environment variables, and production does not have to run
them. The deployed values were not read, with two exceptions: production
allows a student 30 uploads per month (the operator's configuration, 30
October 2026), where the code default is five, and a read of the API
container on 11~November 2026 found the LLM call timeout at 90\,s
(\cref{sec:openai-only}). Per-row evidence and the
names of the variables are in \code{docs/thesis/evidence/CONSTANTS.md}.

% The caption sits outside the longtable: the class's longtable caption
% started 3.6pt left of the text edge.
\captionof{table}{System constants: defaults in the code at the pin.
  $\dagger$~can be overridden by an environment variable.}
\label{tab:constants}
\setlength{\LTpre}{0.5\baselineskip}
\begin{longtable}{@{}p{5.6cm}p{3.1cm}p{5.0cm}@{}}
  \toprule
  \textbf{Constant} & \textbf{Value} & \textbf{Location} \\
  \midrule
  \endfirsthead
  \toprule
  \textbf{Constant} & \textbf{Value} & \textbf{Location} \\
  \midrule
  \endhead
  \midrule
  \multicolumn{3}{r@{}}{\textit{continued on next page}} \\
  \endfoot
  \bottomrule
  \endlastfoot

  % --- Ingestion: admission control ---
  Maximum upload size                    & 50\,MB$^\dagger$ & \code{config.py:90} \\
  nginx request-body limit               & 55\,MB          & \code{nginx.conf:66} \\
  Maximum pages per document             & 300             & \code{upload\_service.py:13} \\
  Maximum files per batch                & 30$^\dagger$    & \code{config.py:92} \\
  Student uploads per month              & 5$^\dagger$ (production: 30) & \code{config.py:134} \\
  Worker concurrency                     & 4$^\dagger$     & \code{config.py:96} \\
  Queue depth limit                      & 50$^\dagger$    & \code{config.py:101} \\
  % --- Ingestion: asynchronous processing ---
  Job timeout                            & 900\,s          & \code{arq\_worker.py:362} \\
  Job retry limit (\code{max\_tries})    & 5               & \code{arq\_worker.py:371} \\
  Job result retention                   & 7\,days         & \code{arq\_worker.py:365} \\
  SSE heartbeat interval                 & 20\,s           & \code{upload\_service.py:333} \\
  Proxy idle timeout                     & 120\,s          & \code{nginx.conf:52} \\
  Worker heartbeat interval / TTL        & 30\,s / 90\,s   & \code{arq\_worker.py:47}, \code{worker\_heartbeat.py:24} \\
  Stalled-run reconciler cutoff          & 25\,min         & \code{arq\_worker.py:57} \\
  Reconciler sweep interval              & 10\,min         & \code{arq\_worker.py:336} \\
  Parse job lock TTL                     & 1200\,s         & \code{unified\_orchestrator.py:68} \\
  Review-card job lock TTL               & 300\,s          & \code{card\_factory.py:39} \\
  % --- Ingestion: routing and synthesis ---
  Page routing: no-text threshold        & 25 chars        & \code{page\_blocks.py:201} \\
  Page routing: figure-page text cap     & 150 chars       & \code{page\_blocks.py:202} \\
  Page routing: minimum figure share     & 0.05 of page    & \code{page\_blocks.py:203} \\
  Vision model (default)                 & Gemini$^\dagger$ & \code{config.py:74} (selector); model \code{gemini-flash-latest}, \code{orchestrator.py:331} \\
  Synthesis batch size                   & 8 slides$^\dagger$ & \code{orchestrator.py:158} \\
  Synthesis batch context overlap        & 1 slide$^\dagger$ (retired v2 path only) & \code{orchestrator.py:162} \\
  Deck quiz questions asked for (cap)    & 5--8 (12)       & \code{ai/prompts.py:422}, \code{synthesis.py:52} \\
  Options per question                   & 4 (3 distractors) & \code{quiz\_validator.py:98} \\
  % --- LLM provider strategy ---
  Provider registry entries              & 9               & \code{orchestrator.py:239} \\
  LLM call timeout                       & 25\,s$^\dagger$ (production: 90\,s) & \code{llm\_client.py:72} \\
  LLM rate-limit retry attempts          & 8               & \code{llm\_client.py:36} \\
  LLM retry backoff                      & 4--60\,s, exp.  & \code{llm\_client.py:37} \\
  Monthly per-user LLM cap               & \$2.00$^\dagger$ & \code{config.py:194} \\
  Daily ceiling on paid calls, all users             & \$10.00$^\dagger$ & \code{config.py:187} \\
  % --- Grounded tutor ---
  Embedding model                        & \code{gemini-\allowbreak embedding-001}$^\dagger$ & \code{embeddings.py:21,25} \\
  Embedding dimensions                   & 768             & \code{embeddings.py:29} \\
  Retrieval top-$k$ (one Lesson / one Space)   & 5 / 6           & \code{retrieval.py:30,32} \\
  Similarity threshold                   & 0.65            & \code{retrieval.py:31} \\
  Similarity assigned to the open page      & 0.0             & \code{retrieval.py:180} \\
  Reciprocal rank fusion (RRF) constant                           & 60              & \code{retrieval.py:254} \\
  Query-embedding cache TTL              & 600\,s          & \code{retrieval.py:41} \\
  Context cap (total / per page)        & 10\,000 / 2\,400 chars & \code{tutor.py:42--43} \\
  History window                         & 5 turns $\times$ 1\,000 chars & \code{tutor.py:44--45} \\
  User message cap                       & 2\,000 chars    & \code{ai\_content.py:54} \\
  % --- Spaced repetition (SM-2) ---
  Rating scale                           & 1--4            & \code{review/scheduler.py:58} \\
  Ease factor minimum / initial          & 1.3 / 2.5       & \code{review/scheduler.py:20--21} \\
  Graduating intervals                   & 1\,d / 6\,d     & \code{review/scheduler.py:25--26} \\
  Relearning interval (``again'')        & 10\,min         & \code{review/scheduler.py:29} \\
  Ease penalty on lapse                  & $-0.20$         & \code{review/scheduler.py:65} \\
  Ease delta (hard / good / easy)        & $-0.15$ / 0 / $+0.15$ & \code{review/scheduler.py:82} \\
  Easy interval bonus                    & $\times 1.3$    & \code{review/scheduler.py:83} \\
  New cards per queue call / total cap   & 20 / 100        & \code{review.py:56--57} \\
  % --- Mock exams ---
  Exam length (default / min / max)      & 30 / 20 / 40    & \code{exams.py:80,42--43} \\
  Exam time limit / grace period         & 45\,min / 30\,s & \code{exams.py:44--45} \\
  Exam sampling seed                     & 63-bit, server-side & \code{exams.py:110} \\
  Sampler minimum weight                 & 0.05            & \code{exam\_service.py:23} \\
  Difficulty boost (hard / medium / easy)& 1.2 / 1.0 / 0.8 & \code{exam\_service.py:24} \\
  Unseen-concept weight                  & 0.5             & \code{exam\_service.py:88} \\


\end{longtable}
```

#### Appendix B, the six diagrams that left (captions)

```latex
\thesisfigure{f4-use-case}
  {Actors and goals as implemented. Student goals are served by the current
   interface. Whether a user may create and publish a Space depends on
   ownership, not on the account type, and professor and admin goals remain in
   the older interface. The shaded goal is built but
   switched off in production.}
  {fig:use-case}

\thesisfigure{f5-domain-model}
  {Conceptual domain model. Analysis-level vocabulary, deliberately distinct
   from the physical database schema.}
  {fig:domain-model}

\thesisfigure{f17-flag-reality}
  {Built versus delivered. Twelve backend flags are all off by default, and
   production switches on four. Since the end of October the build sets each frontend flag from its backend flag. This removed screens that the interface showed at the earlier revision \thesisEarlierCommit{} (August 2026) while their backend was off.}
  {fig:flag-reality}

\thesisfigurepage{f9-er-core}
  {Core physical schema, part 1: identity, Spaces, content, and parsing --- 19
   of the 36 core tables, out of 79 tables defined in the migrations
   (distinct \code{CREATE TABLE} names, one of them the default partition of
   the event table). The dashed line marks a reference without a database-enforced foreign
   key.}
  {fig:er}

\thesisfigure{f14-trust-boundaries}
  {Trust boundaries. A browser holding the anonymous key meets three
   database-side boundaries --- table row-level security, function execute grants, and storage policies. Most backend routes bypass row-level security
   and check ownership in application code.}
  {fig:trust-boundaries}

\thesisfigurepage{f12-tutor-sequence}
  {The grounded course tutor behind the home ask bar. Groundedness is enforced
   at five points, including a refusal before any model call.}
  {fig:tutor-sequence}
```

#### Appendix C, Technology Decisions

```latex
\section{Technology Decisions (Chapter 3)}
\label{sec:decisions-table}

\begin{table}[htbp]
  \centering\small
  \caption{Technology decisions with a recorded reason (dates are 2026).}
  \label{tab:decisions}
  \begin{tabular}{@{}p{0.26\textwidth}p{0.46\textwidth}p{0.20\textwidth}@{}}
    \toprule
    \textbf{Decision} & \textbf{Recorded reason} & \textbf{Source} \\
    \midrule
    A background job queue (Arq) & Parsing takes longer than a request may. &
      \code{6ce7b5f1}, 19~May; \code{CHANGELOG.md} \\
    Two Redis instances & A cache may evict; a queue must not lose a job. &
      \code{43a86927}, 16~July \\
    PyMuPDF for text and rendering & A second renderer was dropped for a
      memory leak; the plain text call stayed as the only live extractor. &
      \code{227267e7}, \code{b1c7a428}; \code{CHANGELOG.md} \\
    No LLM gateway & The gateway had no live callers, used 1\,GB of a 4\,GB
      host, and its health check could block start-up. &
      \code{68a091e0}, 25~Aug (main: PR~\#51, 28~Aug) \\
    HNSW~\cite{malkov2020hnsw} instead of IVFFlat & Recorded in the migration that replaces the
      index. & \code{20260719000002} \\
    Small WebP posters for page previews & Full PDFs as backdrops exceeded
      the storage egress quota; posters are 97.6\,\% smaller than the PDFs
      they replace. &
      PR~\#12, 17~Aug \\
    One embedding size (768) & Two embedding models fill the same column. &
      \code{ai/embeddings.py} \\
    \bottomrule
  \end{tabular}
\end{table}
```

#### Appendix C, The Nine Idempotency Mechanisms

```latex
\section{The Nine Idempotency Mechanisms (Chapter 4)}
\label{sec:idempotency-detail}

\thesisfigure{f10-idempotency}
  {Nine idempotency mechanisms in four layers, eight of them active in the
   code. Thick borders mark mechanisms keyed on the bytes alone and shared by
   every uploader. The rest are per uploader, run, or lecture, so the stack
   yields at most one parse per uploader and pipeline version, and two
   uploaders of the same bytes each pay for one.}
  {fig:idempotency}

\Cref{fig:idempotency} shows the nine mechanisms that use this identity to avoid
doing the same work twice, grouped in four layers. Eight of them are active in the code.
\begin{description}
  \item[Layer 1, the request.] \emph{M0}: a database parse cache keyed by hash.
    The older upload route still reads it, but the live pipeline never writes
    it, so it can no longer hit. It is a legacy layer. \emph{M1}: the hash is the
    stored file's name, written with upsert, so identical bytes become one
    object. \emph{M2}: deduplication per uploader. The route of the current interface returns the
    Lesson the student
    already owns, without a quota charge or a job, and the batch route skips
    bytes the same user has already uploaded.
  \item[Layer 2, the database.] \emph{M3}: each parse is a row in
    \code{parse\_runs} with a unique key on hash, pipeline version, and user.
    Creating it is an upsert that never overwrites an existing row's state.
    \emph{M4}: a run that already completed is replayed from the database
    instead of re-parsed, unless a re-parse is forced.
  \item[Layer 3, Redis.] \emph{M5}: before parsing, the worker takes a lock on
    the hash (\code{SET NX}, 20 minutes, longer than the 15-minute job timeout).
  \item[Layer 4, the outputs.] \emph{M6}: a re-parse clears the lecture's content
    but keeps the lecture, so links to it survive. \emph{M7}: the reader copy, the
    poster image, and the parse receipt are written with upsert. \emph{M8}: before
    any paid embedding call, a slide's text hash is checked, and unchanged
    slides are not embedded again.
\end{description}

The weak link is chosen deliberately: the lock is best-effort, so if Redis
fails the worker proceeds without it, preferring availability over strict
mutual exclusion, and two simultaneous jobs for one uploader can then both create a lecture. The
guarantee also has a gap between uploaders. Four
mechanisms (M0, M1, M5, and M8) are keyed on the bytes alone and shared by
every uploader. The rest are per uploader, run, or lecture. A second user who
uploads identical bytes while the first parse runs finds the shared lock
held, and the second user's job stays queued until the sweep, which runs
every ten minutes, fails runs that have been queued for six hours. If the uploads do
not overlap, each user pays for a full parse. At the end of every parse
the embeddings are re-attached by hash, so they point at whichever uploader's lecture finished last. The thesis presents the case of
the second uploader as a known
limitation of the design.
```

#### Appendix C, Failure Handling

```latex
\section{Failure Handling (Chapter 4)}
\label{sec:failure-handling}

Failure handling has three tiers. Inside the job, any exception is caught: a
partial lecture is finalised if slides were already written, the run is
marked failed, and the error is re-raised. A refusal because the user's
budget is exhausted ends the job normally. Above the job, a sweep every ten
minutes resolves runs stuck in extraction for more than 25 minutes
(completed with their real slide count if slides exist, failed otherwise)
and marks runs still queued after six hours as failed. The second case was
added in September 2026 (found, then fixed), and a dead-letter table records
the failures. Finally, the user can retry a failed run, which re-queues it
with a forced re-parse. One setting does not do what it appears to: the
worker's \code{max\_tries = 5} reads like five retries with backoff, and its
comment said so until November, but in the installed Arq~\cite{arq} an
ordinary exception finishes a job on its first try, so a failed parse is
never retried automatically. Embedding failures raise rather than return a
zero vector, which would corrupt similarity search silently. We read the
retry semantics in the source of Arq~0.28.0, the version of the development
environment (\code{requirements.txt}). The production image pins
\code{arq>=0.26,<0.27} (\code{requirements-docker.txt}), and we did not check
whether version~0.26 behaves the same.
```

#### Appendix C, The Provider Layer

```latex
\section{The Provider Layer (Chapter 4)}
\label{sec:provider-strategy}

Every generated artefact depends on a hosted language model. The backend
calls the providers directly, through two ordered chains over the same eight
providers: a \emph{bulk} chain, ordered by capacity, for high-volume work such
as page synthesis, and a \emph{quality} chain, ordered by expected answer
quality, for fewer and harder calls. Both end with OpenAI as a last resort. A
call walks its chain and skips a provider that is unavailable. A rejected key,
a payment error, and a missing model disable a provider until restart, a rate
limit starts a backoff of 90~seconds that doubles up to ten minutes, and every
other failure moves on without penalty. The chain is shallower than it looks:
its eight entries use six credentials, so one revoked key takes out two
entries.

The default mode sends content to providers that the privacy page does not
name for this purpose. The page (\code{legal.json}, section~4) names OpenAI,
Groq, Google, and OpenRouter as AI providers, while the two chains also call
Cloudflare, which the page names only for e-mail forwarding and backups, and
Mistral, which it does not name (\code{orchestrator.py:389}, \code{:393}). The
cost ledger records 100 calls to Cloudflare on 26~August 2026 and 26 to
Cerebras between 2~August and 10~October 2026, while Cerebras was still in the
chains; it records no call to Mistral.

\subsection{From Free Tiers Towards One Paid Provider}
\label{sec:provider-history}

The provider changed many times in ten months: a local model (February 2026),
Gemini, Groq, then Cerebras at the head of a free-tier failover chain (May), a
LiteLLM gateway (May), an OpenAI-compatible provider (June, because the free
vision tiers hit their rate limits almost immediately), the gateway removed
again (August), and an OpenAI-only option with spending caps for the October
launch. The gateway had come with a pipeline generation that never became the
default, so it ended with no live callers while still costing 1\,GB of memory
on a 4\,GB machine. A read-only query of the cost ledger (\code{llm\_calls}) on
11~November 2026 counted 3{,}388 calls in the 30 days from 30~September to
29~October 2026, 90\,\% of them to OpenAI and mostly embeddings. All 2{,}660
OpenAI embedding calls fall on one day, 11~October 2026, while the default mode
at the pin embeds with Gemini (\code{embeddings.py:21--25}), and from
24~October to 10~November only Gemini embedded. Whether the stored vectors now
mix the two models, which are not comparable, we did not check. The repository
does not record why OpenAI-only became the target. The author's account is
that the free tiers were not reliable enough for bulk parsing and the OpenAI
key was the one that worked.

\subsection{The OpenAI-Only Mode: Built, Not Yet Switched On}
\label{sec:openai-only}

The OpenAI-only mode is the author's target and was off at the pin: a probe in
November 2026 found six providers keyed in production.
In OpenAI-only mode, both chains collapse to the single OpenAI entry, and the
API and worker refuse to boot if any other provider's key is present. The
code gives the reason: a misconfigured deployment must not quietly send
student data to a provider the privacy policy does not name, so the mode is
as much a data-protection boundary as a reliability choice. Switching it on
is not a configuration flip: the other keys must be removed, every slide must
be embedded again (the two embedding models' vectors are not comparable), and
the privacy pages must change. The failure classes change meaning with it: a
rate limit only delays calls and never leaves the service without a
provider, while a rejected key or a payment error disables the only provider
until restart, and with it every AI feature. One quality mechanism depends on
the providers being different: generated quiz questions are checked by a
second model that did not write them (Groq's reasoning model in the default
mode), and in OpenAI-only mode that independence holds only if the checking
model differs from the writing one. The trust chapter takes this up.
A read of the API container on 11~November 2026 found
\code{OPENAI\_MODEL}, \code{OPENAI\_BULK\_MODEL}, and \code{OPENAI\_VISION\_MODEL}
empty. All three therefore fall back to the code default \code{gpt-4o-mini}
(\code{orchestrator.py:105--107}), and the cost ledger shows every OpenAI call
of the preceding 30 days on that model, the five vision calls included. The
launch setting in \code{.env.example} (\code{gpt-4.1-mini}) was not in effect.
\code{LLM\_TIMEOUT\_SECONDS} is set to 90 seconds, against a code default of
25 (\cref{tab:constants}).

\subsection{Cost Controls}
\label{sec:cost-controls}

Each user has a monthly cost cap (by default \$2), checked before every call
and enforced for student parses. All users together have a daily ceiling on
OpenAI (by default \$10) that also binds embeddings, and every call is written to
a cost ledger. In the default mode the ledger prices only OpenAI calls and
records every free-tier call at zero. Two limits are weaker than they look:
the per-user cap fails open if Redis is unavailable, and a pre-parse headroom
check never fires while OpenAI is configured, because the registry gives OpenAI no daily request limit and so counts it
as unlimited.
```

#### Appendix C, The Deck-Plan Scorecard

```latex
\section{The Deck-Plan Scorecard (Chapter 4)}
\label{sec:c4-deck-lab}

We measured the deck plan of \cref{sec:c4-deck-plan} on the 25 decks of the corpus before the merge, with a scorecard that compares the old selection of
pages for metadata and quiz generation against the planned one. The plan's
\emph{span}, the fraction of a deck between the first and the last page the
quiz step reads, rose from a mean of 0.17 to 0.84. The sections the quiz
draws on rose from 26 to all 31 eligible sections, and removing boilerplate
saved 14{,}875 words of model input over the corpus. The metadata pass still sees 24\,\% of pages. The scorecard runs without
a model. Span and section coverage are what the plan's page selection aims to raise, so it confirms the implementation
and is not evidence of better quizzes.

Production shows the same shift. Before PR~\#84, all 524 deck-quiz questions
in production sat on the first eleven pages of their deck, 32 of them on the
first page. Since then they reach page 121
(\code{docs/\allowbreak thesis/\allowbreak evidence/\allowbreak deck-quiz-anchors.md}).
This counts where the questions are attached, not whether they are good.

We checked the 60\,\% threshold of the boilerplate afterwards
(\code{docs/\allowbreak thesis/\allowbreak experiments/\allowbreak deck-plan-threshold/}).
Moving it to 50\,\% or 70\,\% changes the boilerplate of three or four of the
25 decks, all but one of them database decks. On the systems decks every
boilerplate line recurs on at least 90\,\% of pages. The lines just below the
threshold include topic headings that recur on many slides, and those above
70\,\% are mostly lines a slide template repeats, such as the course name, the
lecturer's name and the slide number. The threshold changes what the model
reads and which pages it picks, never the page text the learner sees.

Before the plan, the metadata pass read pages 1 to 15; it now reaches page 21 to 127,
depending on the deck, with a median of 50. Without the boilerplate the model reads
about nine fewer words per page.
```

#### Appendix C, The Schema Around the Log

```latex
\section{The Schema Around the Log (Chapter 5)}
\label{sec:data-model}

The event log is one table among many, and the loop reads several of the
others: who owns a Space, who is a member, which pages a Lesson has. The
section serves RQ2 in this respect only: these tables decide whose events
the view aggregates and who may see the result. The
schema is defined only by plain SQL migrations (139 files at
\code{\thesisCommit}). They create 79 tables, one of which is the default
partition of the event table, so 78 logical tables. Thirty-six of them form
the core of the domain. \Cref{fig:er} in \cref{app:figures} shows 19 of them,
for identity, Spaces, content, and parsing; the other 17 serve practice, Luna
sessions, notes, and points. The remaining tables are catalogues, caches,
analytics roll-ups, and operational tables.

\paragraph{A Space is a course.}
The current interface speaks of \emph{Spaces}, but no Space table exists. A
Space is a row in \code{courses}, and membership is a row in
\code{course\_enrollments}. A student's own uploads (the Library of \cref{sec:stakeholders}) are not a
Space row at all: they are lecture rows without a course. The cost of this choice is that
the vocabulary of the schema (professor, course) no longer matches that of
the product.

\paragraph{Schema drift.}
Migrations are not the only source of truth for the deployed database. The
production database has a vector column on \code{slides} that no migration
defines. In August 2026 it was empty in all 5{,}445 rows. Three further tables
exist only in production (probed in October 2026), and production's migration history records two of
the migrations. A read-only probe on 11~November 2026 found two more
differences that bear on \cref{ch:loop}. The event table, which the
migrations partition by month, is a plain table in production. And the
sign-up function of the repository (migration \code{20260615000800}) grants
a role requested at sign-up, student or professor, while both sign-up
functions in production insert the student role only, so that only an
administrator can make an account a professor. The project therefore applies migrations by hand and checks
the outcome against the system catalogue. The repository describes the intended
database, and the running one has to be inspected.
```

#### Appendix C, The Second Fence: Authorisation

```latex
\section{The Second Fence: Authorisation (Chapter 5)}
\label{sec:authorisation}

At \code{\thesisCommit} the 139 migration files contain 253 \code{CREATE
POLICY} statements. This counts statements in the migrations, not the
policies in force in a database, because later migrations drop and replace
earlier ones.

The owner's view limits what it computes. Whether the data under it is
safe depends on who can reach the tables at all, and by which path.
\Cref{fig:trust-boundaries} in \cref{app:figures} shows the two paths.

A browser holds the anonymous key of the database service and can address the
database directly. On that path it meets three boundaries inside the
database: row-level security~\cite{postgresql-rls}, which the migrations
enable on every table, the right to execute a function, and the policies of the file
storage. The backend takes the other path. Its service-role client and
its SQL pool bypass row-level security (\code{core/database.py:5--6,
150--190}), so on most backend routes, and on every route of the loop, the
check is a line of Python that compares the caller with
the owner of the Space or with its members. Two properties of the policies
matter for the loop. Rows that a creator owns are guarded by ownership and
no longer by the professor role (migration \code{20260713000000}). And
permissive policies combine by OR: what a caller sees is the union of all
policies that apply, so one generous policy written for an old screen
widens every later one (\code{20260719020000}). The gap named at the end of
\cref{sec:c5-privacy} is of this kind.

\paragraph{What is tested, and what is not.}
About 24~test files replay every migration into a throwaway PostgreSQL,
switch to the anonymous or the signed-in role, and assert which rows and
functions that role can reach (\code{backend/tests/db/}). The tests that
drive API routes run either on an in-memory fake of the database or on the
administrator's connection. No test exercises row-level security through an
API route. The ownership checks in code and the database policies are each tested. The
place where they meet is not.

\paragraph{A fault at that meeting point.}
At \code{\thesisPreviousCommit} (November 2026) the rule ``ownership, not role'' had a
consequence that nobody intended. A student who owned a Space could call
the analytics routes of the older interface for the Lessons in it. Those
routes checked ownership and not the account type, and one of them returned
members' user ids and the questions they had asked the tutor, word for
word. The older interface showed these pages to professors only. The
backend did not enforce that. Two changes closed it before the pinned
revision. PR~\#176 puts every such route behind a check of the professor
account type, covered by one test over eleven routes
(\code{tests/integration/test\_analytics\_professor\_gate.py}). PR~\#175
changed what the data contains: no route returns a row per student, and a
question appears only once five different people asked it, and never with
an id. The second change is the stronger one, because it holds even when a
check is missing again.

\paragraph{What production permits.}
A read-only probe of the production catalogue on 11~November 2026 read the
policies and function definitions that \cref{tab:deployed} lists. These are
readings of what a policy permits, and we tested no exploit. The anonymous role
was the subject of the audit of October (\cref{sec:hardening}), and the probe
also covered the signed-in role, \code{authenticated}, which every account
holds. Three attackers matter for these rules. The first is any signed-in
account, which every sign-up creates. The second is the owner of a Space, who
can also create further accounts. The third is an owner who also holds the
professor role, which in production only an administrator grants.

% [table tab:deployed: kept in the thesis, Appendix A]
```

#### Appendix C, Hardening as a Sequence

```latex
\section{Hardening as a Sequence (Chapter 5)}
\label{sec:hardening}

The database boundary was not designed once. It was repaired in nine steps
over eleven migrations, each of which documents its own problem in its
header. We summarise the
classes of fault and not the individual migrations.

The first class, from January to June 2026, concerns who may hold a role. Roles
moved to their own table, with a policy that let a user insert their own
row. That policy was removed in May (\code{20260502000003}). Roles were then
set only at sign-up, and the sign-up was opened to any e-mail domain
(\code{20260601000000}, \code{20260615000800}). Opening sign-up to any domain let a professor read across courses. A
further migration narrowed this to their own enrolled students, though not to
their own courses (\cref{tab:deployed}) (\code{20260621000000}). The migration that opened the read
and the one that closed it were committed on the same day, so the history
shows no window of exposure. Twice in this
phase a step opened a hole that a later step closed.

The second class concerns functions that run with the rights of the role
that defined them. In July five functions of this kind were closed. One of them took a user id from its caller,
checked nothing, and was executable by everyone through a default grant. It
was reproduced on a local database, closed, and is guarded by 13~tests
(\code{20260721000001}). The repair was incomplete, because the hosting
service grants execution to the anonymous role directly: a probe of
production on 11~October 2026 found 42 such functions that an anonymous
caller could execute (\code{20261011000000}). That probe and its migration
covered the anonymous role only. On 11~November 2026, 49 such functions were
executable by the signed-in role, and we did not audit whether each checks
its caller (\cref{tab:deployed}).

The third class is drift between repository and production. The storage
bucket for lecture PDFs had been made private in the repository in May.
That migration never ran in production, so until 24~October 2026 anyone,
signed in or not, could list the bucket with the anonymous key and download
every lecture PDF, private student uploads included (\code{20261024010000},
\code{20261024020000}). We did not establish whether anyone did. No
line of code was wrong. The deployed database was not the one the
repository described. A last step in November protects the integrity of
profiles and points (\code{20261101015412}). The sequence has no final
state, and we do not claim one.
```

#### Appendix C, Cost as a Question of Trust

```latex
\section{Cost as a Question of Trust (Chapter 6)}
\label{sec:c6-cost}

A learner trusts the content. The person who runs the system also has to
trust that the system
does not spend without limit and does not keep calling a provider that can no
longer answer. \Cref{sec:provider-strategy} describes the chain of providers
and \cref{sec:cost-controls} the caps. Here the question is whether those limits
hold when providers fail. It belongs to RQ3 because the answer check is
itself a model call: what happens when verification fails depends on what
happens when a provider fails.

In October 2026 we planned a set of property tests, the Provider Chaos Lab:
scripted providers that fail in chosen ways, a frozen clock, and five
invariants written down before the tests. Reading the code for that plan
turned up two defects that were live in production. The daily ceiling on paid
calls was never enforced in the worker, the process that does all parsing,
because the worker never opened the connection to the shared counter. And a
retired model at one provider was never switched off, because that provider's
library reports the HTTP status under another name. A deck of 50 pages made
about 50 calls that could not succeed. Earlier tests had missed the second
defect because they raised a generic error and not the library's own type.

The five invariants are: a provider that answers with a permanent error
receives no further call in the process; cumulative cost stays below the daily
ceiling plus one call, even when every other provider fails; one request makes
at most 64 attempts (eight providers, eight tries); if any provider answers,
its text is returned, and unreadable JSON never reaches the caller as data;
and a failing vision provider is switched off after its first failure. They
are pinned by 11 property tests in four files, on a harness with 10 tests of
its own (21 tests named \code{test\_chaos\_*} under
\code{backend/tests/unit}), and each was checked by breaking the code on purpose and seeing the test fail.
The fixes reached production with PR~\#92.

One measure works after the fact. Every parse writes a receipt: for each page
the route, the prompt and its version, the provider, the model, the tokens and
the cost of each call, and the counts of questions proposed, kept, repaired,
and dropped (migration \code{20261012000000}). The receipt does not prevent a
wrong result. It makes one traceable to the call that produced it.
```

#### Appendix C, The Trust Mechanisms in One Table

```latex
\section{The Trust Mechanisms in One Table (Chapter 6)}
\label{sec:c6-inventory-table}

\begin{table}[htbp]
  \centering
  \small
  \caption{The 26 mechanisms that exist in the code, by what they guard. A
    \emph{verifier} computes, validates, filters, or drops; a \emph{prompt rule}
    only instructs the model; a \emph{harness} measures offline; an
    \emph{input-side} mechanism changes text before a model sees it; a
    \emph{limit} bounds cost or calls. Source:
    \code{docs/thesis/verification-notes/2026-11-09-trust-rq3.md}, section~11.}
  \label{tab:mechanisms}
  \begin{tabular}{@{}p{0.19\textwidth}cp{0.50\textwidth}p{0.17\textwidth}@{}}
    \toprule
    Guards & $n$ & Mechanisms & Kind \\
    \midrule
    Answer keys & 6 & key resolution; structural gates; lexical score (marks only); answer check; repair pinned to its page; shape of options &
      verifiers \\
    Grading & 2 & computed answers for three kinds of task; refusal of trivial
      tasks & verifiers \\
    Output structure & 5 & block validation; screening of generated mini-apps;
      Luna's page and phrase checks; teach-back quotes; links between Lessons &
      verifiers \\
    Citations & 4 & citation filter of each tutor; refusal gate; labelled
      outside knowledge; anchor check of the golden set &
      2 verifiers, 1 prompt rule, 1 harness \\
    Untrusted text & 3 & rewriting of fence delimiters; sanitising of the learner's message;
      single-pass slot filling & input side \\
    Cost and providers & 5 & monthly cap; daily ceiling; switching off dead
      providers; chaos tests; parse receipts & limits and tests \\
    Measurement & 1 & the offline harnesses (probe, scorecard, retrieval grid,
      benchmark) & harness \\
    \bottomrule
  \end{tabular}
\end{table}
```

### The RQ3 pass (16 November): Chapters 1, 6 and 7 rebuilt

Chapter 1 now states three problems, one per research question (RQ3 narrowed to checking the answer keys of generated quiz questions); Figure 1.1 and the five-problem table left. Chapter 6 was refocused on quiz answer keys; Chapter 7 shortened to answers, two lessons, seven limitations and an outlook. Chapter 2 lost the groundedness-regimes paragraph and Figure 2.1, which Chapter 6 no longer describes. The removed text follows verbatim.

#### Chapter 1, Figure 1.1 and Table 1.2

```latex
\begin{figure}[t]
  \centering
  \includegraphics[width=0.78\textwidth]{f1-transformation}%
  \caption{The transformation this thesis addresses. The system keeps one PDF as the reading surface and turns it into independently addressable learning objects. Every capability students use in production builds on one of them.}%
  \label{fig:transformation}%
\end{figure}

\begin{table}[htbp]
  \centering\small
  \caption{The five problems, the mechanism that addresses each, and where
    the thesis examines it.}
  \label{tab:problems}
  \begin{tabular}{@{}p{0.31\textwidth}p{0.41\textwidth}p{0.18\textwidth}@{}}
    \toprule
    \textbf{Problem} & \textbf{Mechanism} & \textbf{Examined in} \\
    \midrule
    The lecturer gets no feedback on the material. &
      An event log, detectors that speak about pages, and an owner's view
      without names. &
      \cref{ch:loop} \\
    A learning session leaves no trace. &
      Reading position, notes, answers, and sessions with Luna persist per page. &
      described, not evaluated \\
    Neither the student nor the lecturer sees progress. &
      The same log feeds the student's own history and the owner's
      aggregated view. &
      owner's side: \cref{ch:loop} \\
    Every upload pays the cost of processing a file again. &
      The system parses a file at most once per uploader, and the text feeds one shared search index. &
      described in \cref{ch:content}, not measured \\
    Static material gives no reason to come back. &
      Practice questions, spaced review, and a ledger of experience points. &
      not evaluated \\
    \bottomrule
  \end{tabular}
\end{table}
```

#### Chapter 2, the groundedness regimes and Figure 2.1

```latex
A system can enforce groundedness at different strengths.
\Cref{fig:groundedness} shows the four that exist in Learnstation, from a gate that refuses before any model call to a prompt that asks the model
to stay with the page. \Cref{ch:trust} describes each of them and how the
system moved between them.

\thesisfigure{f3-grounded-vs-ungrounded}
  {Four groundedness regimes over the same material. The course tutor behind
   the ask bar of a Space refuses before any model call. The system checks Luna's page references and highlighted phrases against the page. Explain
   and Ask in the reading view rely on rules in the prompt for their content, and the tutor of the
   older interface, which has no refusal gate, no longer reaches students. \Cref{ch:trust} introduces each of them.}
  {fig:groundedness}
```

#### Glossary entry

```latex
  \item[refusal gate] The ask bar's rule that refuses before any model call
    when no retrieved page reaches a similarity of 0.65
    (\cref{sec:anti-hallucination}).
```

### Chapter 6 refocused on quiz answer keys (16 November)

RQ3 now asks how reliably the answer keys of quiz questions that a language model generates can be checked before learners see them, and what happens when a check fails (the author's decision of 16 November). Chapter 6, now titled "Checking Generated Quiz Questions", therefore keeps only what bears on quiz keys: the question lifecycle with its figure, grading by computation, a short section on instructions hidden in a page, the three verifiers on the 16 pairs with their table, where nobody checks, and the answer. What left, and why: the scopes of Explain, Ask, Luna and the ask bar, the ask bar's retrieval, its five points of control with their four gaps, the structure checks of Luna and the reading view, and whether the learner sees the source, because none of them checks a quiz key; the refusal-gate re-run of November (27 answerable and 30 unanswerable questions, expectations committed before the run, record in `docs/thesis/experiments/retrieval-rerun/`), because the gate decides whether the ask bar answers, not whether a key is right; the February 2026 history of showing the original slide beside the generated text (`4c23d254`), which concerns prose; the parts of the injection threat model that lie off the quiz path, except the image risk, which stays in 6.3, and the sandbox, which moved into the opening; the inventory paragraph with FActScore and RAGAS; and the old opening and answer, which were written for the wider RQ3. The sentence "This negative result is the reason the next attempt did not use similarity at all" left because no record supports the causal claim; the chapter now says "The next attempt did not use similarity." The exact 95 % intervals stay in the caption of the table of verifiers (21 % for 0 of 16, 22 % for 0 of 15); 6.4.3 points to them, and the answer gives them as about one in five, as Chapter 7 does. Sections that were rewritten rather than cut are kept below in their old wording too, so that every sentence of the chapter at `8dde92d3` survives here. If the supervisor keeps the old RQ3, the old sections 6.1 to 6.3 and the re-run come back from this note.

#### Header, title and opening (old lines 1-35; replaced by the new opening)

```latex
% ---------------------------------------------------------------------------
% OPTION A, CHAPTER 6 (RQ3). Written 2026-11-10 with AI assistance (Claude)
% from the drafted briefs in 05-implementation.tex (grounded tutor,
% anti-hallucination, prompt injection, assessment generation, review) and
% 06-evaluation.tex (citation gap), from docs/thesis/CHAPTER_MATERIAL.md §6
% and the verification note docs/thesis/verification-notes/2026-11-09-trust-rq3.md
% (branch claude/thesis-brief-verification-6573e8). Constants were re-checked
% against the code at the pin \thesisCommit on 2026-11-10. Labels of the moved
% sections are unchanged (sec:tutor, sec:retrieval, sec:anti-hallucination,
% sec:injection, sec:assessment, sec:review, sec:citation-gap,
% fig:tutor-sequence, fig:citation-gap); new labels carry a c6- prefix.
% The author must read, revise and own every sentence before submission.
% ---------------------------------------------------------------------------
% 2026-11-10 (cut to length): F12 and F16 moved to appendix B; the note on
% 24 June and the mechanisms table moved to appendix C.
\chapter{Trusting the Machine}
\label{ch:trust}

This chapter answers RQ3: how a system can check learning content that a
language model writes before learners see it, and what happens when a check
fails. \Cref{ch:content} turned uploads into pages, and \cref{ch:loop} fed back to
the owner what learners do on them. Along the way a model writes three kinds
of text that a learner may take for true: an answer to a question, a quiz
question with its key, and the task behind a graded exercise.

One rule runs through the chapter. Where the system can compute an answer, it computes it and does not ask the model. For the quiz questions of the parse, a second model, meant to differ from the one that wrote them, answers each question without the key.
Everywhere else the checks test only the structure of what a model writes,
and the original page, which a learner sees first, remains the reference for
its meaning. The checks drop what fails them, except three that only mark an item, which we name where they occur.

No check in the system decides whether a sentence of generated prose is true.
By a verifier we mean any step that computes, validates, filters, or drops,
and each verifier below tests something narrower: that a page exists, that a
phrase is on it, that the search retrieved a cited source, or that a second
model reaches the same key. \Cref{sec:c6-missing} lists what is missing.
```

#### 6.1 The Page Stays the Reference (old lines 37-46; cut, one sentence kept in the opening)

```latex
\section{The Page Stays the Reference}
\label{sec:c6-page}

The oldest trust decision in the project is not a verifier. From February 2026 the interface showed the original slide beside the generated text
(commit \code{4c23d254}). We showed the original so that we could test the generated text against its source and judge it, and it stayed as the learner's reference. In the reading view the uploaded page is the first of the three views of a
Lesson, and
the generated explanation and the plain text are one key away
(\code{LessonFacesScreen.tsx:152--163}). A learner who doubts a generated
sentence therefore always has the source in the same place. This costs
nothing at run time and it is the fallback for every mechanism that follows.
```

#### 6.2 Answers Grounded in the Space, with 6.2.1 to 6.2.4 (old lines 48-135; cut)

```latex
\section{Answers Grounded in the Space}
\label{sec:tutor}

A learner can ask in three places, and they form a hierarchy of scopes.
Explain and Ask in the reading view answer about the open page; they see
little beyond that page and search nothing
(\code{v4\_reader\_service.py:728,854}). Luna, in a study session, sees the
pages around the one it teaches and the one the learner reads. It searches the
rest of the Space only in a step that connects Lessons
(\code{luna/context.py:23}, \code{session\_service.py:274}). The ask bar on
the home screen answers about a whole Space and must search it first.

Our aim was that each answer starts from the least material its question
needs, and that retrieval runs only where a question reaches beyond the page.
The reason is that a language model can be distracted by context that does
not bear on the question~\cite{shi2023distracted} and uses information in the
middle of a long context less well~\cite{liu2024lost}. We did not measure
whether the narrow scope gives better answers here, and it has a cost. A
question on one page may depend on an earlier or later page, or on another
Lesson; it then reaches beyond what Explain and Ask see, and what the model
does rests on prompt rules alone (\cref{sec:c6-structure}). In the system as
built, the checks also weaken as the scope narrows. The ask bar has a refusal
gate and a citation check (\cref{sec:anti-hallucination}), while the reading
view checks only the structure of an answer (\cref{sec:c6-structure};
\cref{fig:groundedness}).

\subsection{Retrieval Inside One Space}
\label{sec:retrieval}

The ask bar uses retrieval-augmented generation~\cite{lewis2020rag}. A vector
search and a full-text search run inside the Space, each returning at most 12
pages, and reciprocal rank fusion keeps the best six (\code{ai/retrieval.py}). The SQL query applies the scope as a
restriction to the Space's live Lessons, not as a filter afterwards
(migration \code{20261014000000}).

\subsection{Five Points of Control}
\label{sec:anti-hallucination}


\begin{enumerate}
  \item \emph{Scope.} The Space must be one the caller belongs to or owns
        (\code{v4\_spaces\_service.py}).
  \item \emph{Scoped retrieval,} as above.
  \item \emph{Input sanitising.} The ask bar's route refuses a question of
        more than 600 characters. The code then trims the message and cuts it
        at 2,000 characters. It rewrites the fence markers of the prompt
        (\cref{sec:injection}) and angle brackets so that the message cannot
        reproduce them literally, and it marks phrases such as ``ignore
        previous instructions'' as quoted (\code{tutor.py:71--90}).
  \item \emph{Refusal gate.} If no retrieved page reaches similarity 0.65, the gate returns a fixed ``not covered'' reply before any model call
        (\code{tutor.py:302--347}).
  \item \emph{Citation check.} The reply cites \code{[Source N]}. The check removes a citation whose number is not in the retrieved set from the list of citations (\code{tutor.py:272--299}).
\end{enumerate}

The five points leave four gaps. None of them checks that the cited page supports the content of the answer. None requires that an
answer cites anything. The invalid \texttt{[Source N]} tag leaves the citation list but stays in the text of the reply. The citation check compares against the
retrieved list and not against what fitted into the 10,000-character context,
so a source that the context limit cut off still passes. In the terms of the attribution
literature~\cite{rashkin2023ais,gao2023alce}, the system verifies that a
citation points at retrieved material, not that the material supports the
claim.

\subsection{Luna and the Reading View: Checks on Structure}
\label{sec:c6-structure}

The other two surfaces do not use this retrieval and do not cite. Both check
the shape of what the model writes.

Luna names pages and lights up phrases on them. The validator drops a move to
a page that does not exist, and a phrase survives only if it occurs literally
on that page; 12 unit tests cover these rules (\code{luna/validate.py}). A
check question must have exactly one correct option.

The output of Explain and Ask must parse into a fixed set of blocks, and the
service drops a block that does not (\code{validate\_answer}). Beyond that
they rely on prompt rules. On a factual page the model must use only the
stated facts and say when one is not given. On a conceptual page Explain may
add intuition and hypothetical examples, and Ask must say plainly when the
page does not cover something (\code{v4\_reader\_service.py:615,636,774}).
Nothing verifies that the model follows them.

\subsection{Whether the Learner Sees the Source}
\label{sec:citation-gap}

A citation that the server validates but no screen shows gives the learner
nothing to check. In the current interface the ask bar shows each citation as
a link to its page. Explain and Ask in the reading view cite nothing; their
only source is the open page itself.
```

#### 6.3 Uploaded Text Is Not an Instruction (old lines 137-195; rewritten as 6.3 Instructions Hidden in a Page)

```latex
\section{Uploaded Text Is Not an Instruction}
\label{sec:injection}

Almost every prompt in the system carries text that the operator did not
write. A PDF can contain a sentence that addresses the model and not the
learner, which is indirect prompt
injection~\cite{greshake2023indirect,owasp2025llm}. Three attackers matter.
The \emph{owner} of a Space controls every page its members read, and so every
prompt built from them; any signed-in user can own a Space
(\cref{sec:stakeholders}). A \emph{member} controls their own questions. These
reach the member's own answer and the model that writes the owner's themes,
where a filter drops every theme with a word that only one asker used.
\emph{Any signed-in account} can write to the database directly, where the
database's own rules are the only check (\cref{tab:deployed}). Together
they threaten what members read, how members are graded, what members ask,
and what the system costs, which the spending caps of \cref{sec:constraints}
bound. Against an owner who uploads a false page no check
helps, because every check takes the page as its reference. The checks defend
against the model's errors, not against the person who supplies the
material.

The defence has two layers, and neither is a boundary in the strict sense,
because the model, not a parser, decides what it treats as an instruction.
The first is a rule in the prompt that the page text and the learner's words
are data and never instructions. The second keeps intact the fence that this
rule points at. A prompt fences uploaded text with markers, and a PDF that
contains the same marker could close the fence early. Since PR~\#179 one
function rewrites exactly those markers inside untrusted text into look-alikes
that no fence matches (\code{ai/untrusted.py}). The change applied it wherever
uploaded or learner text enters a prompt of the tutors, Luna, the reading
view, or the parse (commit \code{ca1a6a08}). The prompt that translates a
Lesson into the other language has neither layer and places the text in JSON
(\code{localization\_service.py:148--158}). The rewriting stops a page from
reproducing a marker, not from addressing the model in plain words.
Spotlighting, the related idea, lowers the success of such attacks without
removing them~\cite{hines2024spotlighting}.

The function's own description says that it ``does not make injection
impossible; nothing does'' (\code{ai/untrusted.py}). Against an injected page,
an output check bounds the damage in only three places: Luna's
literal phrase check, the citation check of the ask bar, and the block
validation of the reading view. An injected instruction that makes Explain
write something false in well-formed blocks would pass. Explain and Ask may
also answer with a small app whose code the model writes. There the browser
holds the line: the app runs in a frame without the page's origin, under a
content security policy that allows no network (\code{Sandbox.tsx}). Text
blocks have no such bound. They show images from any address
(\code{Prose.tsx}), and the repository's web server sets no content security
policy, so an injected page might make Ask show an image whose address
carries the learner's question to a third party~\cite{greshake2023indirect}.
We did not test this.

One hole widens the audience. The database policy for new lecture rows checks
that a row names its creator as owner, not that the creator owns the Space it
names (migration \code{20260713000000}; production, November 2026). A
signed-in account that writes to the database directly can therefore add a
Lesson to another owner's Space. The API path checks ownership
(\code{722167b0}). We did not test whether text in such a row reaches a model
prompt.
```

#### 6.4 Questions That Carry a Key, opening (old lines 197-203; moved into the new opening)

```latex
\section{Questions That Carry a Key}
\label{sec:assessment}

A learner can check a wrong sentence in an explanation against the page. A wrong
answer key is worse, because it marks a correct learner wrong and the learner
has no reason to doubt it. Most of the verification effort in the project went
here.
```

#### 6.4.1 From a Generated Question to a Stored One (old lines 205-261; rewritten as 6.1)

```latex
\subsection{From a Generated Question to a Stored One}
\label{sec:c6-lifecycle}

\thesisfigure{f24-question-lifecycle}
  {The life of one quiz question during a parse. Three stages can drop it, one only marks it, and a disputed key gets one
   repair on the same page, and a second dispute drops the question.}
  {fig:question-lifecycle}

During a parse the model writes five to eight multiple-choice questions for
the whole deck from up to ten selected pages (\cref{sec:pipeline}). Each has
four options and names the one page that states its key. The prompt asks for
distractors that the page does not state as true and forbids negated
questions, two common rules of item
writing~\cite{haladyna2002mcq}. \Cref{fig:question-lifecycle} shows what
happens next.

\begin{description}
  \item[Resolve the key.] The model names the correct option as an index, a
        letter, or the option's text. If none of these matches an option, the code drops the question and logs it. The code
        states the reason: a wrong answer key is worse than fewer questions.
  \item[Structural gates.] The gates (\code{parser/quiz\_grounding.py:127}) involve no model. They drop a question if its cited page is missing, out of range, or empty, or if its key does not resolve. A number in the
        key that is not on the page, or a distractor that the page supports
        better than the key, only marks the question, because the switch that would
        make these checks drop it is off (\code{parser/synthesis.py:55--63}).
        Learners still see a marked question, and the pipeline stores the mark with it and counts it in the parse receipt.
  \item[Lexical support.] A score measures how much of the key's wording
        occurs on the cited page. Below 0.5 the pipeline marks the question. It does not drop it, for the reason that \cref{sec:c6-evaluation} measures.
  \item[Answer check.] A second model reads the cited page, the question, and
        the options, without the key, and answers as a careful student would
        (PR~\#166). If it picks another option, finds a second defensible
        option, or finds none, it disputes the key.
  \item[Repair or drop.] The model rewrites a disputed question once against the same page, and the check runs again. A second dispute drops it. A repair may
        not move the question to another page.
\end{description}

Two properties of the answer check are design decisions. First, the check is
meant to run on another model than the one that wrote the question. By
default the small model at the head of the bulk chain, \code{gpt-oss-20b},
writes the question, and the check runs on the head of the quality chain,
the larger reasoning model \code{gpt-oss-120b} (\cref{sec:architecture}).
These are two sizes of one model family from one provider, so the
independence is one of model size, not of family or vendor
(\code{orchestrator.py:260,347,389,393}). Both chains hold the same eight
providers in a different order, so after failovers both calls can land on the
same model. In the OpenAI-only mode, which is off, both chains collapse to one
provider. We chose a different model after a test: when the bulk model of the
time, \code{gpt-4o-mini}, checked the question that started this work
instead, it agreed with its wrong key twice, because it shared the writer's
misreading (\code{parser/\allowbreak synthesis.py:76--79}). That question was
ambiguous, with all its options on its page. The literature also reports that
a model tends to favour text like its
own~\cite{panickssery2024selfpreference}.

Second, the pipeline treats an outage and a dispute differently. If the check
itself fails or returns an unreadable reply, the pipeline keeps the question,
so that a provider outage never empties a quiz. A dispute, by contrast, leads
to the one repair described above.
```

#### 6.4.2 Grading by Computation (old lines 263-291; shortened as 6.2)

```latex
\subsection{Grading by Computation}
\label{sec:c6-grading}

Two features use five kinds of question: the rehearsal, a short mixed test
that a model writes from a Space's pages, and the reading view's checkpoints,
which a model writes for the pages of one idea and which are not the deck quiz
of \cref{sec:c6-lifecycle}. Three of the five kinds are about functional
dependencies in the database course that the corpus comes from: which
dependencies hold on a given table, the closure of a set of attributes, and
which dependencies violate Boyce--Codd normal form (BCNF). For these the model
writes the task but not the verdict. The browser computes the answer from the
question's own data (\code{rehearsal/grade.ts}). For a checkpoint the server
computes it again and records its own verdict, not the browser's
(\code{v4\_rehearsal\_service.py:43--105}, \code{v4\_reader.py:326}). A
finished rehearsal, however, the server stores as the browser reports it
(\code{v4\_rehearsal\_service.py:508}). Before a learner sees a task, the
server refuses one whose computed answer is trivial or empty (PR~\#75). The
model does not get the last word on the answers.

The other two kinds have no computable answer. The code checks a multiple-choice question for shape (exactly one option marked correct) and an ordering question for distinct items, and then grades both against the model's key. Computation
covers exactly the questions that have a formal answer. It is the strongest
verifier in the system and the narrowest. Every question, the deck quiz in
practice included, reaches the browser together with its answer, because the
browser grades first (\code{v4\_practice\_service.py:91}). Grading on the
server protects the verdict that the server records. It does not stop a
member from writing a checkpoint or quiz event with a verdict of their own
through the database interface, which the owner's view of \cref{ch:loop} also
reads (\code{insights/\allowbreak sources/\allowbreak space.py}), and it does
not hide the answer from a learner who reads the network traffic.
```

#### 6.5 Measuring the Verifiers, opening (old lines 293-298; shortened)

```latex
\section{Measuring the Verifiers}
\label{sec:c6-evaluation}

A verifier can fail in two directions. It can drop a good question, which
costs content, or keep a bad one, which costs trust. We measured both for
every verifier of answer keys on the same fixed probe.
```

#### 6.5.1 Method (old lines 300-329; rewritten as 6.4.1)

```latex
\subsection{Method}
\label{sec:c6-method}

The probe is 16 pairs, which the author wrote with AI assistance in October 2026, before any verifier scored them (\code{backend/eval/data/grounding\_probe.py}). Eight pairs
are in English, from a lecture on transactions, and eight in German, from a
lecture on storage management. Both decks are disjoint from the decks on which we fitted any threshold. Each pair holds one correct key that
paraphrases the page and one wrong key that stays on the topic of the page.
The author wrote the correct keys under a rule that forbids copying three words in a row from the page, and the wrong keys are plainly false
(\code{docs/DECK\_LAB\_2026\_10.md}). A
verifier that works on wording will fail the first, and a verifier that works on
topic will fail the second. The expected shape was that the lexical score
drops paraphrases, and that a semantic score repairs this without keeping the
wrong keys.

The three distractors of every question are off the subject, such as plate
tectonics in a question about transactions, as in the calibration set of the
lexical score. This keeps the check for ambiguous options from masking the raw
score (\code{grounding\_probe.py}, rule~5). For the answer check the
distractors make the task easier, because a model that answers without the
key finds only one option on the subject of the page.

For the semantic score we fixed the procedure in writing before the first
embedding request. It fixed the scoring rule, a threshold fitted only on a
separate calibration set of key pairs from other decks, and a single scoring
of the probe. It fixed the acceptance criterion (at most two calibration
errors, at most two good keys dropped, at most one wrong key kept) and what
follows from a pass and from a fail. And it named a risk: the question text
without its options (the stem) could dominate the embedding and raise wrong
keys above the threshold. The threshold itself, 0.774, is the fitted value,
which we did not register in advance.
```

#### 6.5.2 Results, with the old Table 6.1 caption and the refusal-gate re-run (old lines 331-406; rewritten as 6.4.2, re-run cut)

```latex
\subsection{Results}
\label{sec:c6-results}

\begin{table}[htbp]
  \centering
  \small
  \caption{Three verifiers of answer keys on the same 16 pairs: correct keys
    dropped and wrong keys kept. The acceptance criterion for enforcement was at most two good keys dropped
    and at most one wrong key kept. $^{a}$For the answer check, counts are
    over the 31 of 32 calls that returned a verdict, so one of the two cells
    is 0 of 15 and the other 0 of 16; the record of the run does not say
    which. A count of 0 of 16 is compatible with an error rate of up to
    21\,\%, and 0 of 15 with up to 22\,\% (exact 95\,\% intervals). Sources: \code{parser/synthesis.py:55--80}; PR~\#94 and tag
    \code{archive/claude/arc8-semantic-grounding}; PR~\#166.}
  \label{tab:verifiers}
  \begin{tabular}{@{}p{0.33\textwidth}ccp{0.22\textwidth}@{}}
    \toprule
    Verifier & Good dropped & Wrong kept & Consequence \\
    \midrule
    Lexical score, threshold 0.5 & 14 of 16 & 0 of 16 & marks only \\
    Similarity score, fitted threshold 0.774 & 4 of 16 & 8 of 16 &
      criterion failed; not merged \\
    Answer check & 0$^{a}$ & 0$^{a}$ & enforced \\
    \bottomrule
  \end{tabular}
\end{table}

\Cref{tab:verifiers} gives the result. The lexical score never keeps a wrong
key, but it drops 14 of 16 correct paraphrases, among them all eight German
ones. We therefore set it to mark and not to drop, and the constant carries a comment
that forbids enforcing it without a new measurement.

The similarity score failed its acceptance criterion, and it failed in the direction that the procedure had named as its risk.
It dropped 4 good keys and kept 8 of 16 wrong ones, six of them German,
against a limit of one. On the calibration set it made ten errors against a
limit of two. On the probe, similarities fell into a narrow band between
0.70 and 0.91,
because the stem dominates the embedding and a wrong key on the same topic
scores like a right one. The procedure had fixed the consequence in advance: we reverted the wiring into the parse and ruled out tuning the threshold against the same probe. We closed the experiment without a merge (PR~\#94), and its
code and record exist only under an archive tag. This negative result is
the reason the next attempt did not use similarity at all.

The answer check disputed no correct key and accepted no wrong one in the
calls that returned a verdict, with the easy distractors described in
\cref{sec:c6-method}. On the question that started the work, which a careful student
could answer differently from its key, it disputed the key in five of five
runs and accepted a corrected version of the same question in five of five. The run took place in October 2026 with the reasoning model at the head of the quality chain
(PR~\#166). Unlike the similarity score, the answer check faced no acceptance criterion fixed in advance. We built it for that one question and measured it in the same change, on the probe that already existed (commit
\code{461afc40}), so its result is in-sample. Before anyone calls the check validated, a new run should score it once on new pairs from other decks against an acceptance criterion fixed first.

One call of the run returned no verdict, because the provider limited the
rate and the fallback timed out. The script counts such a call as an error
(\code{backend/\allowbreak eval/\allowbreak quiz\_answer\_check.py:101--103}),
and the record of the run does not say which pair it was.
The deployed check
would have kept that question whichever key it carried, so
\cref{tab:verifiers} describes the check when it answers.

We measured the refusal gate separately at the pin, in November 2026, with
expectations committed before the run
(\code{docs/thesis/experiments/retrieval-rerun/}). In one Space of three
Lessons and 201~pages we asked 27 questions that have an answer there and 30
that have none. The author drafted the answerable ones with AI assistance from
the page text and reviewed them. Of the unanswerable ones, ten are far from
the subject, ten come from computer science outside databases, and ten ask
about database topics that the three Lessons do not cover. With the settings
of production the gate let all 27 through and refused all 30. The 27
answerable questions had already passed the gate in September, so this half
replicates a known outcome; the new evidence is the 30 unanswerable ones. Zero
errors in 30 is compatible with a rate of wrongly accepted questions of up to
12\,\%. The similarities of the two groups do not overlap, but the gap is
narrow: no unanswerable question reaches more than 0.634, the weakest
answerable question reaches 0.659, and the threshold of 0.65 lies between
them. A threshold of 0.75 would have refused 13 of the 27 answerable
questions. We had predicted that some of the absent database topics would pass
the gate, but none did.
```

#### 6.5.3 What the Numbers Do Not Show (old lines 408-431; rewritten as 6.4.3)

```latex
\subsection{What the Numbers Do Not Show}
\label{sec:c6-threats}

The probe is small, and the author, who built the system, wrote it, in two
subjects from one university. Sixteen pairs show how a verifier behaves on
these chosen cases and do not estimate an error rate in production.
The wrong keys are on the topic but plainly false, and every distractor is
off the subject, so a keep rate of zero shows that the check rejects such keys
when no other option is plausible. It does not show that the check rejects
subtler errors or chooses well between plausible distractors. Because the
correct keys avoid the page's wording by rule, the lexical result is partly
a product of the probe. The failure that started the answer check, an
ambiguous question whose options all appear on the page, appears in one case.
We measured the answer check once, on one day, with one model at the head of
its chain, and a model behind an API can change without notice. No measurement
covers the prose of Explain, Ask, or Luna. We measured the refusal gate in one Space, with 57 English questions that the author drafted with AI assistance, ten per group of unanswerable questions.
Their wording may suit retrieval better than a student's would, and a margin
of 0.025 on this sample does not show how the threshold behaves on other
material.
A question that passes the gate does not thereby get a correct answer: we did not measure what the model then writes.

The answer check is itself a model call. Unit tests fix what happens when it
fails: a failed or unreadable check keeps the question, and the checker never
sees the key (\code{tests/\allowbreak unit/\allowbreak test\_quiz\_answer\_check.py}).
```

#### 6.6 Where Nobody Checks and 6.6.1 No Human Approval (old lines 433-447; kept with small changes as 6.5 and 6.5.1)

```latex
\section{Where Nobody Checks}
\label{sec:c6-missing}

\subsection{No Human Approval}
\label{sec:review}

No person has to approve generated content before learners see it. The owner
of a Space adds Lessons with no review screen at all, and the members of a
published Space see a new Lesson the moment its parse creates it. Publishing
decides who can find a Space, not what its members see.

This is a consequence of a decision with another purpose. We built the reading view so that a learner can open a page seconds after the upload (\cref{sec:pipeline}).
A real approval step would need a draft state on the Lesson and would delay exactly
that. The automatic checks of this chapter are therefore the only line
between the model and the learner.
```

#### 6.6.2 What the Checks Cover (old lines 449-465; cut, the entailment and translation sentences kept as 6.5.2)

```latex
\subsection{What the Checks Cover}
\label{sec:c6-inventory}

The verifiers guard mainly structure and answer keys, where a check can be exact. Prompt rules guard meaning on every surface, and the answer check guards it for quiz keys only.

There is no entailment check: nothing tests directly whether a page logically
supports a key or a sentence. The answer check tests a key only indirectly,
by whether a second model reaches it, and the lexical module says itself
that it is no such test. There is no detector for invented content in the prose of
Explain, Ask, or Luna, and current surveys treat this as an open
problem~\cite{ji2023hallucination,huang2025hallucination}. Metrics such as
FActScore~\cite{min2023factscore} and the faithfulness score of
RAGAS~\cite{es2024ragas} could estimate how much of that prose its page
supports; we did not run them. Nor does anything check a translation. A quiz
translated into the other language keeps its ids, option count, and key
(\code{localization\_service.py:181--213}), but nothing reads its wording, so
the answer check vouches only for the original language.
```

#### 6.7 Answer to RQ3 (old lines 467-502; replaced)

```latex
\section{Answer to RQ3}
\label{sec:c6-answer}

\emph{How can the quality of LLM-generated learning content be checked
before learners see it?} Only in parts. In this system every check runs
before the content reaches a learner, in three ways of falling strength. By
computation, where the content has a formal answer: code grades three kinds
of task and never uses the model's key. By a second model, for the quiz
questions written during the parse: it answers each question from its cited
page without the key, on another model than the writer's while the provider
chains do not fail over. By structure everywhere else: pages must exist,
phrases must be on the page, citations must point at retrieved sources,
blocks must parse. This weakest kind also covers the multiple-choice and
ordering questions of the checkpoints and the rehearsal, which the system
grades against the model's key. Nothing checks whether generated prose is
true.

We measured how well the checks work for answer keys and the refusal gate
only, with a small probe written before any verifier scored it. On 16 pairs
the lexical score dropped 14 good keys, and the similarity score kept 8 wrong
ones and failed a criterion fixed in advance. The answer check made neither
error in the calls that returned a verdict, on a probe whose distractors are
off the subject. Its result is promising, not proven. On the ask bar, the gate
let through all 27 questions with an answer in one Space and refused all 30
without one, by a narrow margin. The failure of the similarity score is a
result too: it kept a plausible check out of the system.

\emph{What happens when a check fails?} The system drops the item:
a key that it cannot resolve, a question whose key the check disputes twice,
a move to a page that does not exist, a block that does not parse. With no
human approval (\cref{sec:review}), there is nobody to pass it to. On the ask bar, the
gate refuses a question whose retrieved pages all fall below the similarity
threshold, before any model call. When the checker itself is unavailable, the
check fails open: it keeps the question, so that an outage does not empty a
quiz. And where no check exists, for the meaning of generated prose, the
original page remains the first thing a learner sees.
```
