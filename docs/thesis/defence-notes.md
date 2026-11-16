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
  exposed v4's blindness it routed 88 of 143 pages to vision [correction, 16 November:
  an offline check in v5's first commit, not the version that served; the thesis no longer
  cites it, see "Chapter 4 rewritten (16 November)" below]. Pipeline v3 with
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

### Chapter 2 ordered by research question (16 November)

Chapter 2 now has one section per research question, followed by the related systems: Recovering Content from Documents (RQ1), Feeding Data Back Without Exposing Learners (RQ2), Checking What a Language Model Writes (RQ3), and Related Systems. The pass follows the review of 15 November (Package F; drafts D1 and D2 and actions ch2-01 to ch2-17 in `results.json`, part ch2), its verification (`verify.json`), and the author's decisions of 16 November. Besides what the review proposed, the retrieval and attribution paragraph of draft D1 left too, because no remaining chapter uses it. The chapter shrinks from about 1,360 words of text and a table of 227 words to about 1,090 words and a table of 174 words. In the base build it filled PDF pages 12 to 15, the last one holding only the table; the new text should fill about three pages (an estimate at about 480 words per page; we did not build). Every passage of `02-background.tex` that was cut or rewritten follows verbatim, each with its reason. The second paragraph of Related Systems (Learn Your Way and Slide2Text) is unchanged and therefore not repeated. The groundedness-regimes paragraph and Figure 2.1 left in an earlier pass; their text is under "The RQ3 pass (16 November)", and the old Chapter 6 sections that described each regime are under "Chapter 6 refocused on quiz answer keys (16 November)".

#### What the cut sources say (for oral questions)

These summaries restate the cut passages below, so that an answer in the oral defence does not need the old PDF.
- Spacing: practice spread over several sessions helps memory more than the same amount of practice in one session (Cepeda et al. 2006; review by Dunlosky et al. 2013). It motivated Luna's spaced practice cards, which a variant of SM-2 schedules and which the thesis does not evaluate; the new Chapter 3 no longer names SM-2.
- AI tutors: a tutor built on a language model beat in-class active learning in one controlled study (Kestin et al. 2025). Students who practised with an unrestricted chat model did worse once they lost access to it, and a version with guardrails largely avoided that harm (Bastani et al. 2025). We read both as support for an assistant that stays with the material, and as a warning against claiming a learning effect without measuring it.
- Gamification: points and badges show small positive effects on average, and the effects depend on the context (Sailer and Homner 2020).
- Document understanding: LayoutLM learns from text and position together (Xu et al. 2020); DocLayNet is a human-annotated dataset of page layouts for training layout models (Pfitzmann et al. 2022).
- Retrieval and attribution: retrieval-augmented generation retrieves passages and then lets the model answer from them (Lewis et al. 2020; survey by Gao et al. 2023), commonly by comparing dense vectors (Karpukhin et al. 2020), which Learnstation stores with pgvector. Attribution separates whether a citation points at a source from whether the source supports the sentence (Rashkin et al. 2023); models asked to cite often fail the second (Gao et al. 2023, ALCE); FActScore (Min et al. 2023) and RAGAS (Es et al. 2024) measure that gap. The thesis used "grounded" for an answer restricted to retrieved material and "verified" only where a separate step checked it.
- Prompt injection: direct injection (Perez and Ribeiro 2022) left the thesis. Indirect injection (Greshake et al. 2023), the OWASP list and spotlighting (Hines et al. 2024) stay in Chapter 6.3.
- Privacy: ℓ-diversity (Machanavajjhala et al. 2007) and differential privacy (Dwork 2006) stay in Chapter 5 (Privacy by Design) and Chapter 7 (Outlook).
- Augmented reading: Paper Plain adds plain-language summaries and guiding questions to medical papers (August et al. 2023).

With this pass, 17 keys are cited nowhere in the current chapters, so biblatex no longer prints them: august2023paperplain, bastani2025guardrails, cepeda2006distributed, dunlosky2013techniques, es2024ragas, gao2023alce, gao2023ragsurvey, karpukhin2020dpr, kestin2025aitutoring, lewis2020rag, min2023factscore, perez2022ignore, pfitzmann2022doclaynet, pgvector, rashkin2023ais, sailer2020gamification, xu2020layoutlm. They stay in `references.bib`. Keys that left Chapter 2 but are still cited elsewhere: greshake2023indirect, owasp2025llm, hines2024spotlighting (Chapter 6), machanavajjhala2007ldiversity (Chapter 5), dwork2006dp (Chapters 5 and 7). No key is new in Chapter 2: the threshold rule (fcsm2005spwp22, hundepool2026handbook) stays in Chapter 5 (Aggregation, The Floor) together with ritchie2022ten and seastrom2010nces, and Chapter 2 points there.

#### Header comment (old lines 1-13; replaced)

The provenance comment described the chapter of 10 November and the earlier removal of figure F2. The new comment describes this pass, the labels kept and dropped, and where the cut text went.

```latex
% ---------------------------------------------------------------------------
% OPTION A, CHAPTER 2. Written 2026-11-10 with AI assistance (Claude) from
% docs/thesis/OUTLINE_BRIEF.md (chapter 2, candidate sources) and
% CHAPTER_MATERIAL.md on branch claude/thesis-brief-verification-6573e8.
% Eleven sources were added to references.bib on 2026-11-10 with metadata
% from Crossref, arXiv and CEUR-WS. Of the two preprints in the comparison
% table, Slide2Text (arXiv:2503.17710) was read in full; for Learn Your Way
% (arXiv:2509.13348) the abstract and the study design were read, not every
% section. The table compares what the papers describe; nothing was run.
% Figure F2 (positioning) is no longer used: it was drawn from this system's
% own capabilities, not from a literature search.
% The author must read, revise and own every sentence before submission.
% ---------------------------------------------------------------------------
```

#### Opening (old lines 17-20; rewritten)

The opening followed the path of a page through five topics, two of which left the chapter. It now names one section per research question (rewrite R1, action ch2-09), so that an examiner sees at once which literature serves which question.

```latex
This chapter gives the background that the three main chapters rely on and
places Learnstation among related systems. It follows the path of a page:
how software recovers text from a PDF, what a language model adds and where it fails, how a system ties answers to a source, what the learning sciences say about practice, and how a system can return data about learners without exposing them.
The chapter ends with a comparison of the two systems closest to ours.
```

#### 2.1, first paragraph (old lines 25-38; rewritten)

The sentence on LayoutLM and DocLayNet left (action ch2-08), because no other chapter uses that history. The first sentence no longer restates what a PDF records, which Chapter 1 now says. The paragraph now defines OCR, born-digital and text layer in one clause each (vision model keeps its definition in Chapter 1), and the OmniDocBench sentence says what that benchmark compares (pages of nine kinds, slides among them, against annotated reference text), so that the hedged gap at the end of the section is visibly true.

```latex
A PDF describes where glyphs and images sit on a page. It does not
say which glyphs form a heading, which a table, or in which order a human
reads them. Document understanding is the field that recovers this structure.
Models such as LayoutLM learn from text and position
together~\cite{xu2020layoutlm}, trained on human-annotated page
layouts~\cite{pfitzmann2022doclaynet}, and Nougat transcribes pages directly
from the image~\cite{blecher2023nougat}. Open-source
toolkits such as Docling~\cite{auer2024docling} and
MinerU~\cite{wang2024mineru} package layout analysis, table recognition, and
optical character recognition into one converter, and benchmarks such as
OmniDocBench compare converters across document
types~\cite{ouyang2025omnidocbench}. A simpler path reads the text layer that
a born-digital PDF already carries, for which we use
PyMuPDF~\cite{pymupdf}.
```

#### 2.1, second paragraph (old lines 40-47; rewritten)

Four changes. "For all of these" left as an overgeneralisation. Dinh et al.'s task is now explicit (a model answers course questions), so the difference from Chapter 4, which measures a reader's preference, shows before Chapter 7 discusses it (Polish 2.1 #1). The novelty claim is hedged as what we found (Polish 2.1 #2): OmniDocBench, cited in the same section, does compare converters on slide pages, only not by a reader's preference or by cost. And "at the cost a small server can bear" became "what each method costs per page", because the benchmark measured time and memory on an 8 GB Mac, not on a server, and the verification removed the same overclaim from the abstract.

```latex
Lecture slides are a hard case for all of these. A slide holds little text, and much of its meaning is in a figure,
an arrow, or the position of two boxes. SlideVQA shows that questions about slide decks can need more than one slide and its visual content~\cite{tanaka2023slidevqa}. Dinh et al.\ compare ways to give a
language model access to university course material and find that passing
retrieved slides as images works better than passing their extracted
text~\cite{dinh2025slides}.
None of the works above compares extractors on lecture slides by a reader's
preference, or at the cost a small server can bear. \Cref{ch:content} does
both, with the author as the only judge.
```

#### 2.2 Language Models and Their Failure Modes (old lines 49-70; merged into the new 2.3, prompt injection cut)

The hallucination paragraph and the model-as-judge sentences moved into the new section "Checking What a Language Model Writes" (label sec:llms kept). There it relies on Chapter 1's definition of a language model and defines prompt in one clause, and the unsupported comparison "more than elsewhere" left (action ch2-10). The prompt-injection sentences left (action ch2-03): Chapter 6.3 treats instructions hidden in a page on the quiz path with the same sources and explains OWASP there (Polish 2.1 #3). perez2022ignore is no longer cited.

```latex
\section{Language Models and Their Failure Modes}
\label{sec:llms}

A large language model produces fluent text for any prompt, whether or not
the text is true. The literature calls a fluent and unsupported statement a
hallucination and treats it as a property of the technique and not a rare
fault~\cite{ji2023hallucination,huang2025hallucination}. For learning
material this matters more than elsewhere, because a learner reads the material to
learn what they do not yet know and so has the least basis to notice an error.

Two further failure modes shape \cref{ch:trust}. The first concerns the use
of a model to judge the output of a model. Such judges agree with human
raters about as often as humans agree with each other, above 80\,\% in one
study, but they carry biases of their own~\cite{zheng2023judging}, and a
model tends to rate its own output more favourably than that of
others~\cite{panickssery2024selfpreference}. The second is prompt injection.
When a model reads a document, instructions hidden in the document compete
with the instructions of the
application~\cite{greshake2023indirect,perez2022ignore,owasp2025llm}. Marking untrusted text as data, called
spotlighting, lowers the success of such attacks without removing
them~\cite{hines2024spotlighting}. Every uploaded PDF is untrusted text in
this sense.
```

#### 2.3 Retrieval and Groundedness (old lines 72-84; cut)

Cut whole, with the definitions of grounded and verified. After Chapter 6 was refocused on quiz answer keys, no chapter uses retrieval-augmented generation, attribution, or the distinction between grounded and verified (verification, examiner 1, on draft D1). Chapter 6 defines embeddings where its similarity score uses them (6.4.1, Method). Chapters 4 and 7 still say that a text is "grounded in" a page, in the everyday sense, which needs no definition. If the supervisor keeps the old RQ3 and the ask-bar sections of Chapter 6 come back, this section comes back with them.

```latex
\section{Retrieval and Groundedness}
\label{sec:rag}

Retrieval-augmented generation answers a question in two steps. It first
retrieves passages from a corpus and then lets the model write an answer from
them~\cite{lewis2020rag,gao2023ragsurvey}. Retrieval commonly compares dense vectors of question and passage~\cite{karpukhin2020dpr}, in some systems combined with keyword search. We store the vectors in PostgreSQL with the
pgvector extension~\cite{pgvector}.

Retrieval makes an answer checkable, and it does not make it correct. Work on
attribution separates two questions: whether a citation points at a source,
and whether the source supports the sentence that cites
it~\cite{rashkin2023ais}. Models that a prompt asks to cite often fail the second~\cite{gao2023alce}, and metrics such as FActScore~\cite{min2023factscore} and RAGAS~\cite{es2024ragas} measure that gap. We use the word \emph{grounded} for an answer that a system restricts to retrieved material and the word \emph{verified} only where a
separate step has checked the content.
```

#### 2.4 What the Learning Sciences Ask For (old lines 86-108; cut except two sentences)

Kept, in the new 2.3: the testing effect (roediger2006testing), now named as the result that motivates the quiz questions, and the sentence that software can generate questions but that judging their quality is hard (vancampenhout2021transforming, kurdi2020aqg). Cut: spacing (cepeda2006distributed, dunlosky2013techniques), the two trials of AI tutors (kestin2025aitutoring, bastani2025guardrails), gamification (sailer2020gamification), and the clause that these results motivate features the thesis does not evaluate, which invited the question "why is this here?" (Polish 2.4 #1). Chapter 1's scope already says that the thesis makes no claim about what students learn. SM-2 (Polish 2.4 #3) had already left Chapter 2 in an earlier pass.

```latex
\section{What the Learning Sciences Ask For}
\label{sec:learning-science}

Results from the learning sciences explain why the assistant stays close to
the page (\cref{ch:trust}); they also motivate the practice features of
\cref{ch:system}, which this thesis does not evaluate. Retrieving something
from memory strengthens it more than reading it again, and practice spread
over time beats the same practice in one
block~\cite{roediger2006testing,cepeda2006distributed,dunlosky2013techniques}.
Automatically generated questions can bring such practice into
textbooks~\cite{vancampenhout2021transforming}, although judging their
quality is hard~\cite{kurdi2020aqg}.

The evidence on AI tutors is mixed. A tutor built on a language model beat
active learning in class in one controlled
study~\cite{kestin2025aitutoring}. In another, students who practised with an
unrestricted chat model did worse once they lost access to it, and a version
with guardrails largely avoided that harm~\cite{bastani2025guardrails}. We
read these results as support for a design in which the assistant stays with
the material and makes the learner do something, and as a warning against
claiming a learning effect without measuring it. Game elements such as points
and badges, which the system also has, show small positive effects on average
and depend on the context~\cite{sailer2020gamification}.
```

#### 2.5 Feeding Data Back Without Exposing Learners (old lines 110-129; rewritten)

Clow's cycle, k-anonymity and the stricter standard of five people stay. The sentence with the standard is unchanged, because Chapters 5 and 7 measure the owner's view against it. Four changes. The person who acts is the owner of a Space, not the lecturer of a course (action ch2-07). k-anonymity now names the attributes that could identify a person. The sentences on ℓ-diversity and differential privacy left, because Chapter 5 (Privacy by Design) explains both with the same sources where the owner's view meets them; Chapter 2 points there. And a pointer was added to Chapter 5 (Aggregation, The Floor), which sets the floor of five against the threshold rule of statistical agencies with the four sources the author read. Chapter 2 does not repeat those sources: next to the standard of five they would read as its derivation, and Chapter 5 already says that the five is a judgement, below the ten that is most common for results about students. Chapter 2 does not name Clow's cycle "the loop", as action ch2-07 proposed, because Chapter 5 introduces the loop where it uses the term, and two definitions could drift apart.

```latex
\section{Feeding Data Back Without Exposing Learners}
\label{sec:analytics-privacy}

Learning analytics collects traces of what learners do and returns them to
someone who can act on them, and Clow describes this as a cycle that is only
complete when the action reaches the learners again~\cite{clow2012cycle}.
The person who can act on a confusing page is the lecturer who made it. The
traces are personal data, however, and in a course of twenty the lecturer
knows every learner. A classic technical measure is a
minimum group size: under $k$-anonymity a released record must be
indistinguishable from at least $k-1$ others~\cite{sweeney2002kanonymity}.
A minimum group size has known limits. It does not protect a value that
every member of the group shares, which $\ell$-diversity
addresses~\cite{machanavajjhala2007ldiversity}, and it says nothing about
what two releases reveal together. Differential privacy limits what any number of releases reveals about one
person, at a privacy cost that adds up over releases~\cite{dwork2006dp}.
RQ2 asks for a view that shows no individual learner. As a stricter
standard, we call a view privacy-preserving in this thesis if no statement it
releases is about fewer than five people, and \cref{ch:loop} measures the
remaining risk of the owner's view against it.
```

#### 2.6 Related Systems, first paragraph (old lines 131-143; rewritten)

Intelligent textbooks now point to Chapter 1, which says what they are, and keep the one new point, that machine learning now does steps that once required authors. Paper Plain (august2023paperplain) left: one source is enough for the line of augmented reading (action ch2-16), and the running text of the section names no system beyond the two in Table 2.1. The Semantic Reader citation stays, without the project's name.

```latex
\section{Related Systems}
\label{sec:positioning}

Intelligent textbooks are the closest tradition. Brusilovsky et al.\ describe
their return: textbooks that model their content, embed practice, and record
use, now with machine learning for the steps that once required
authors~\cite{brusilovsky2022return}. A second line augments the reading
surface of a document without changing the document. Paper Plain adds plain
language summaries and guiding questions to medical
papers~\cite{august2023paperplain}. The Semantic Reader project builds such augmented reading interfaces for
scientific papers in general~\cite{lo2024semanticreader}. Learnstation
shares the principle of this line: the original stays visible, and the
generated layer sits on top of it.
```

#### Table 2.1 (old lines 156-200; four rows)

The table had seven rows and floated onto a page of its own, which stayed about two-thirds empty. It now has four rows (draft D2, action ch2-05): Input and Output merged as "From what to what", "Checks on generated content", "Feedback to the owner" and "Evaluation". "Relation to the source" and "Personalisation" left, because the text states both; with them went the cell on the ask bar's refusal, which Chapter 6 no longer describes. The cells are ragged right. Two Learnstation cells became more precise: the checks now say that a second model checks the deck quiz and that code computes the keys of three kinds of database task (Chapter 6, table of question checks), and the evaluation names the routing study and the 16 fixed pairs. The Slide2Text evaluation cell lost "no results reported", which "planned" already implies.

```latex
\begin{table}[htbp]
  \centering\small
  \caption{Learnstation and the two closest systems, compared on what their
    publications describe. We ran no system for this comparison.}
  \label{tab:related}
  \begin{tabular}{@{}p{0.16\textwidth}p{0.245\textwidth}p{0.245\textwidth}p{0.245\textwidth}@{}}
    \toprule
     & \textbf{Learn Your Way}~\cite{learnlm2025textbook}
     & \textbf{Slide2Text}~\cite{zhou2025slide2text}
     & \textbf{Learnstation} \\
    \midrule
    Input &
      Textbook material &
      PowerPoint files (text, notes, images by OCR) &
      Any lecture PDF: slides, scripts, exercise sheets \\
    Output &
      Several representations of the same content &
      A textbook with chapters, cases, and exercises &
      The original page, a text of it, questions, and a search index \\
    Relation to the source &
      Generated from the source, content integrity as a stated goal &
      Source enriched with retrieved external papers and web results &
      Original page stays the default view; answers cite pages; the ask bar
      refuses outside the material \\
    Checks on generated content &
      Ratings by pedagogical experts &
      A review by several models and an expert panel, described as a
      framework &
      Computed answer keys, and a check by a second model \\
    Personalisation &
      Yes, of the content itself &
      Language, style, and difficulty chosen by the user &
      None of the content; only the schedule of practice \\
    Feedback to the owner &
      None described &
      None described &
      Patterns per page from five readers on, no names \\
    Evaluation &
      Controlled trial with 60~students &
      One case study on a deck of 39~slides; a controlled study is planned,
      no results reported &
      Blind benchmark, scripted readers, a probe of 16~pairs; no learners \\
    \bottomrule
  \end{tabular}
\end{table}
```

#### Closing paragraph (old lines 202-208; rewritten)

Rewritten as one contribution statement in the authors' voice (rewrite R6, action ch2-06), from the author's note in Polish.md: tools that explain and re-present material already do it well, so the thesis does not try to contribute there. "As far as their publications describe", "unless the check itself is unavailable" and the last sentence stay. No product such as NotebookLM is named, because the supervisor has not yet answered whether products may be named.

```latex
The comparison shows where this thesis stands. Both related systems aim at
the individual learner and personalise the content. As far as
the publications describe, neither has a path back to the owner of the material and neither rejects a
generated item automatically. Learnstation makes the opposite trade: every
learner gets the same content, the owner gets a view of how people read it, and a check runs on generated quiz questions before a learner sees them, unless the
check itself is unavailable. What Learn Your
Way has and this thesis lacks is evidence from real learners.
```

### Defence notes, Chapter 3 (rewrite of November 2026)

These notes keep, word for word, every passage of `thesis/chapters/03-system.tex` (the version of 16 November 2026, before this rewrite) that the new chapter removed or rewrote, so that nothing is lost for the oral defence. Each block says what left and why, and where the content now lives. Line numbers refer to the old file. Code references are to the pin, dfc20df6, unless a commit is named. The reading-view figure (old lines 31-44) and the labels ch:system, sec:vision, sec:stakeholders, sec:architecture, sec:stack and sec:constraints are unchanged and not repeated here.

#### Header comment of the file (old lines 1-13)

The comment at the top of the file described how the chapter was assembled on 10 November and cut later that day. A new comment now describes this rewrite and what it removed. The old comment is kept here for the record; it never printed.

```latex
% ---------------------------------------------------------------------------
% OPTION A, CHAPTER 3. Assembled 2026-11-10 with AI assistance (Claude).
% Sections 3.5 and 3.6 (architecture, deployment) are the author's drafted
% text from the former design chapter (chapters/superseded/04-design.tex.txt),
% moved here with one cross-reference re-pointed. The other sections are new,
% written from docs/thesis/OUTLINE_BRIEF.md (chapter 3), CHAPTER_MATERIAL.md,
% BRIEF_VERIFICATION.md and docs/timeline/ on branch
% claude/thesis-brief-verification-6573e8. The use-case and domain diagrams
% (F4, F5) moved to appendix B.
% The author must read, revise and own every sentence before submission.
% ---------------------------------------------------------------------------
% 2026-11-10 (cut to length): deployment, the readiness signal and the
% decisions table moved to appendix C; a summary paragraph stays here.
```

#### Chapter opening (old lines 17-18)

Rewritten (ch3-01). The old opening promised a description of the system as a whole; the new one says that the chapter gives what Chapters 4 to 6 need, which is what the review asked for (Polish 3.1 #5: Chapter 3 wrote about things outside RQ1 to RQ3).

```latex
This chapter describes the system as a whole, so that the three chapters
that follow can each go deep into one part. It answers no research question.
```

#### 3.1, first paragraph (the move from the course to the page) (old lines 23-29)

Rewritten (ch3-01, rewrite 1; Polish 3.1 #1). The new paragraph gives the author's reason for the move, in the authors' voice: a platform open to any learner can grow without waiting for a lecturer to upload and review every file. It also makes "adds everything else" concrete as a title and a summary for each page and a short quiz for the deck. It does not say that the system writes the text of a page, because at the pin text pages keep their extracted text and the model writes only the title and the summary (unified_orchestrator.py:1161-1164; fact check of 15 November). "In the system that production has served" became "anyone who signs up", because uploads to the Library need an account with the student type (v4_spaces.py:180-182), which every sign-up gets in production (tab:deployed).

```latex
Learnstation started in January 2026 as a platform for lecturers: a
professor creates a course, uploads slides, and students work through
lectures, quizzes, and a dashboard. Over the year the centre moved from the
course to the page. In the system that production has served since the end
of October 2026, anyone can upload a PDF and read it at once, and the system adds everything else to the pages while the learner reads them
(\code{docs/\allowbreak superpowers/\allowbreak specs/\allowbreak 2026-10-26-library-and-spaces-design.md}).
\Cref{fig:reading-view} shows the reading view on one page.
```

#### 3.1, "We therefore built the interface twice" (old lines 46-56)

Rewritten (ch3-07; voice review, reason site 1). "We recorded how we did this and not why ... As we recall" is the voice the author did not want, and it was not accurate: the design brief records the scope ("a rebuild of the product's vocabulary and structure", docs/design-v4/UI-SESSION-BRIEF.md:10) and the rule (build in a new namespace, do not touch the old product, :33), and docs/design-v4/01-foundations.md:26-33 puts roles inside a Space ("no global professor or student account type"). The new text states these facts side by side and does not claim that they caused the choice, because the causal "so" still needs the author's confirmation. The sentence on nine generations of the parsing pipeline left, because Chapter 4 and tab:lineage tell that history; the clause that v4 is unrelated to the pipeline versions stays, now pointing to tab:lineage.

```latex
We therefore built the interface twice. The second interface, which the
repository calls v4, is a new part of the frontend beside the first one, not a
refactoring of it (\code{docs/design-v4/UI-SESSION-BRIEF.md}, PR~\#55). We
recorded how we did this and not why we ruled out refactoring. As we recall,
the first interface assumed a university, with professors and courses, while
the second had to work for any material and any group. We call the screens of
the first interface, one per course, lecture, and professor, the \emph{older
interface} below. They still exist in the code but no longer receive
learners. The backend changed more often: \cref{tab:lineage} in
\cref{app:detail} lists nine generations of the parsing pipeline in ten
months, whose numbers are unrelated to the v4 of the interface.
```

#### 3.1, the five principles (old lines 58-68)

Removed. The outline for the new Chapter 3 lists the move to the learner, the second interface and the older interface for 3.1, and the page budget (3.5 to 4 pages with both figures) left no room. Each principle is stated where it is used: "Read first" is Chapter 4's demand that a learner should not wait and Chapter 1's first aim; "The original page is the reference" is in Chapter 1's aims and Fig. 3.1; "Deterministic first, AI second" is shown by the routing rule and the deck plan (Chapter 4) and by grading by computation (sec:c6-grading); "Parse once" is told precisely in sec:idempotency, including the nuance of Polish 3.1 #2 (reuse is automatic for one uploader, a forced re-parse is possible in the course manager, LectureUpload.tsx:629-649, and two uploaders of the same file each pay one parse); "The server decides" is in sec:c6-grading with its one exception, the rehearsal. Useful for an oral question on the design principles.

```latex
Five principles hold across the current system.
\begin{description}
  \item[Read first.] A learner can open an uploaded file before any AI step has finished. No feature may delay the learner.
  \item[The original page is the reference.] The page as the author made it
    is the default view. Generated text is one switch away and never
    replaces it.
  \item[Deterministic first, AI second.] Code decides what code can decide: page hashes, the plan of a deck, the route of a page, the grading
    of a computable answer.
  \item[Parse once.] The system processes a file once per uploader and reuses the result for every learner who reads it.
  \item[The server decides.] The server computes points, progress, and grades, and the browser displays them, except the result of a rehearsal (\cref{sec:c6-grading}).
\end{description}
```

#### 3.2, "Vocabulary and Roles": the vocabulary paragraph (old lines 70-80)

Removed (Polish 3.1 #3: "quite confusing"). The paragraph packed four things into one: a pointer to the vocabulary, what a page and an idea are, who "lecturer" and "the author" are, and the old words in the database. Table 1.1 (tab:vocabulary) defines page, idea and Library; Chapter 1's Method and the glossary define "the author"; the glossary defines "lecturer". The new 3.2 points to tab:vocabulary and keeps one sentence on the old database words (a Space is stored as a course, a Lesson as a lecture, a page as a slide). The section is now titled "Spaces, Roles, and Questions"; its label sec:stakeholders stays.

```latex
\section{Vocabulary and Roles}
\label{sec:stakeholders}

The system uses a small vocabulary on purpose
(\code{docs/V4\_GLOSSARY.md}), and \cref{tab:vocabulary} defines it. A page
is one page of the uploaded document, whether it was a slide or a sheet of
paper, and a model groups the ideas when a Lesson is first read. Where this
thesis means the person who wrote the material, it says \emph{lecturer}, and
\emph{the author} always means the writer of this thesis. The words course,
lecture, and slide belong to the older interface and to the database, which
still stores a Space as a course.
```

#### 3.2, the roles paragraph (old lines 82-91)

Rewritten. Kept: the two roles in the code (v4_spaces_service.py:139-142), creating, publishing and joining a Space, the self-enrolment policy (now cited as migration 20260604000000, lines 21-27, together with tab:deployed, so that Chapter 5's padding argument has its precondition here), and the three account types. Changed: "Any signed-in user" became "Every account that signs up", because the create and publish routes admit the student and professor types only (require_creator, auth_middleware.py:263; v4_spaces.py:59-91), and every sign-up gets one of them (ch3-22). Removed: the pointer to sec:c5-privacy for the place where account type and Space ownership conflicted; Chapter 5 tells it in its place.

```latex
In the code a Space knows two roles: the \emph{owner}, who created it, and
the \emph{member}, who joined it
(\code{backend/services/v4\_spaces\_service.py:139--142}). Any signed-in
user can create a Space and publish it, and can
join a published one. The database policy also lets a student account enrol
in one that is not published (\cref{tab:deployed}). The account types of the
older interface (student, professor, admin) still exist and still guard the
older interface. \Cref{sec:c5-privacy} names one place
where the two permission schemes, account type and Space ownership,
conflicted.
```

#### 3.2, "From an upload to a Lesson" (old lines 93-98)

Rewritten (ch3-13; Polish 3.1 #4: "then why would I create a space?"). "a private Space of their own" mixed up the Library and a Space. The phrase came from the code, which stores a learner's own uploads as a "personal Space" (v4_personal; v4_spaces_service.py:174-175). The new text says what a Space is for: reading with others, while the owner sees how the material lands (01-foundations.md:29: the owner "sees analytics"; :33: what others call a professor is an owner whose Space has 200 members). The course-manager fact stays (SpaceManageScreen.tsx:127, which sends a live Space to /professor/courses/:id; App.tsx:801-803 admits professor and student accounts; world.ts:180 is the only hand-off from the current interface to an old route).

```latex
\paragraph{From an upload to a Lesson.}
In the current interface a learner's upload lands in their Library, a private
Space of their own, and opens at once. A shared Space gets its Lessons from
its owner, at the pin through the course manager of the older interface
(\code{SpaceManageScreen.tsx:127}); members join a published Space and read
them.
```

#### 3.2, "Four kinds of question" (old lines 100-109)

Rewritten (ch3-14). "Kinds" became "places", because Chapter 6 uses "kinds of question" for task types (functional dependencies, closure, BCNF, multiple choice, ordering). The grading sentence left, because sec:c6-grading has it; the check-in sentence left, because tab:vocabulary has it. The new text adds that the system keeps Luna's practice questions as review cards for later review (luna/store.py:204-228; they are written after a study session's wrap-up, luna/session_service.py:396-426) and points to Chapter 6 for the checks, the deck quiz above all.

```latex
\paragraph{Four kinds of question.}
Learners meet questions in four places, all written by a model. The
\emph{deck quiz}, five to eight multiple-choice questions per Lesson, is
written during the parse, each tied to a page, and learners practise it under
Practice. A \emph{checkpoint} is written for the pages of one idea when a
learner reaches its end. A \emph{rehearsal} is a short mixed test from a
Space's Lessons, and in a study session Luna writes three to six practice
questions. The server grades the deck quiz and the checkpoints and stores a
finished rehearsal as the browser grades it (\cref{sec:c6-grading}). The check-in is not a question but the learner's
own, optional judgement.
```

#### Section "What Is Built and What Is Switched On" (label sec:built-vs-deployed) (old lines 111-135)

Removed (ch3-11; Polish 3.3 #1, #3, #4). The thesis no longer describes the switched-off features, so an inventory of them qualified nothing, and nothing outside Chapter 3 cited the label. Facts for an oral question: at the pin backend/core/config.py:106-213 has twelve feature flags, all off by default (review_engine, exam_mode, global_search, student_uploads, v4_reader, v4, luna_sessions, course_brain, studio_pages, study_guide, ask_luna, llm_prompt_logging), and production switches on four. The sentence on Luna's cards cited wozniak1990sm2, which no other chapter cites. Production at 2e146f51 (the pin plus #170, #181 and #182) is now stated once, in Section 1.4.

```latex
\section{What Is Built and What Is Switched On}
\label{sec:built-vs-deployed}

A description of this system has to separate what exists in the code from
what a learner can reach. Twelve backend flags, all off by default, guard the features, and production switches on four: the current interface, its reading view, sessions with Luna,
and uploads by students.


With these four flags a learner can upload a PDF, read it in the three views
of the reading view, and let Explain explain a page. The learner can ask a
question about a page or about a whole Space and get an answer with links to
pages. A model writes checkpoint questions for the pages of one idea while
the learner reads, and the learner answers them. The learner can also run a
practice session with Luna, whose cards a variant of SM-2~\cite{wozniak1990sm2} schedules, take
notes, and see a history of earned points. An owner can publish a Space. The view of how people read it entered the main branch two days after the pinned revision
(\cref{ch:loop}).

The review engine of the older interface, an exam mode, generated study
guides, and a global search page exist in the code, and a learner cannot reach them in the current interface. We do not count them as delivered.

The thesis describes the pin, \code{\thesisCommit}. Since November 2026
production runs the main branch at \code{2e146f51}: the pin plus three later
merges that change the code, a change to the home screen (PR~\#170), the owner's view of
\cref{ch:loop} (PR~\#181), and the backend of a fourth view of a page, which a
flag keeps off (PR~\#182).
```

#### 3.3, the component figure and its old caption (old lines 137-143)

Caption changed; the figure stays in the body, as the author decided (ch3-02). The new caption says what the figure shows: five containers on one virtual machine, the managed services of Supabase, and the providers of language models, which the API and the worker call directly. The old caption's detail that the API and the worker are built from one Dockerfile is visible in the figure itself (the box "one Dockerfile").

```latex
\section{Architecture}
\label{sec:architecture}

\thesisfigure{f6-components}
  {Component view of the deployed system. The API and the worker, built from
   one Dockerfile, call the LLM providers directly.}
  {fig:components}
```

#### 3.3, the parts paragraph (old lines 145-152)

Rewritten. "LLM synthesis" became "parsing with its model calls", and 3.1 names what the model writes, because the fact check found that the model does not write the text of text pages. "Embedding" left Chapter 3: the embeddings are computed inside the parse job (unified_orchestrator.py:1033-1043), and the new Chapter 4 defines the word at its first use. The technologies and their citations (React, FastAPI, Arq) moved to 3.4, next to the reasons for choosing them, so that each is named once. The two Redis instances and the five containers are one sentence with its source (docker-compose.prod.yml: redis, redis-queue, api, frontend, worker). The worker also runs the generation of review cards and two analytics roll-ups (arq_worker.py:322-339), summed up as maintenance.

```latex
The system consists of three runtime parts and a set of managed services
(\cref{fig:components}). A single-page application written in React and
TypeScript runs in the browser. A FastAPI application~\cite{fastapi} serves the
HTTP API. A separate worker process, built on the Arq job queue~\cite{arq}, runs
everything that takes longer than a request should: parsing, LLM synthesis,
embedding, localisation, and scheduled maintenance. Supabase~\cite{supabase}
provides the PostgreSQL database, authentication, and object storage. Two Redis
instances serve as cache and as job broker.
```

#### 3.3, "No gateway on the LLM path" (old lines 154-165)

Kept in substance: one module calls the providers directly, the bulk chain ordered by capacity and the quality chain ordered by expected answer quality, both ending with OpenAI (orchestrator.py:389, 393 at the pin), and the removal with its recorded reasons (68a091e0, 25 August: no live callers, 1 GB and 0.75 vCPU of a 4 GB / 2 vCPU machine, and a health check on which api and worker waited at start-up; the remnants were swept in 7830d49a in September). Failover is now defined in one clause. Removed for length: the sentence naming the August revision (0be0081, whose docker-compose.prod.yml still lists the litellm service) and the clause "the backend README still describes it" (backend/README.md:123 at the pin), which Chapter 7 no longer uses as its example of documentation drift.

```latex
\paragraph{No gateway on the LLM path.}
The backend calls every LLM provider directly from one module
(\code{backend/\allowbreak services/\allowbreak ai/\allowbreak orchestrator.py}), where failover, rate limiting,
and cost accounting live, through two ordered chains of providers: a
\emph{bulk chain}, ordered by capacity, for high-volume work such as page
synthesis, and a \emph{quality chain}, ordered by expected answer quality,
for fewer and harder calls. Both end with OpenAI. A LiteLLM gateway that no
code path used was still in the production stack at the revision of August
2026 (\code{\thesisEarlierCommit}). We removed it in August and September,
because it had no live callers, took 1\,GB of the 4\,GB machine, and its
health check could block start-up (\code{68a091e0}); the backend README still
describes it.
```

#### 3.3, "Two database paths" (old lines 167-172)

Rewritten into "Two ways into the database" (ch3-12; Polish 3.4 #2: "explain this all to me"). The new text orders the facts by the two ways in: through the backend, and from the browser. Kept: Supabase's web interface with a privileged key that bypasses row-level security or a normal key that obeys it, the direct pool, and older routes on the web interface (core/database.py:4-8, 148-190). Removed detail: the pool is optional at start-up (without DATABASE_URL the backend logs a warning and skips it, core/database.py:162-164) but not in practice, because the ingestion pipeline writes its runs, lectures, slides and quiz questions through it and every service of the current interface uses it.

```latex
\paragraph{Two database paths.}
The backend reaches PostgreSQL in two ways. The first is Supabase's web interface to the
database, used with one of two keys: a privileged key that bypasses
row-level security, or a normal key that obeys it. The second is a direct
connection pool. The pool is optional at start-up but not in practice: the ingestion pipeline writes its runs, lectures, slides, and quiz questions
through it, and every service of the current interface uses it. Older routes still use the web interface.
```

#### 3.3, the security consequence of the two paths (old lines 174-180)

Kept in substance, with code anchors instead of a pointer to the deleted appendix section (examiner 2): the pool and the privileged key bypass row-level security, so routes check in code whether the caller may act, for example course ownership before an upload (api/v1/upload.py:101-127, whose docstring says the lecture is written over asyncpg, which bypasses RLS, so this check is the only thing that stops a caller from attaching a lecture to somebody else's course). The corrected description of the browser's direct path (the database's own rules: row-level security, the right to call a function, the rules of the file storage; definer functions skip row-level security; tab:deployed) is kept word for word.

```latex
The two paths have a security consequence that shapes the rest of the design.
Writes through the pool and with the privileged key bypass row-level
security~\cite{postgresql-rls}, so for those routes application code enforces authorisation, for example by an explicit course-ownership check before it accepts an upload. On the path from the browser, the database's own rules are the only
check: row-level security, the right to call a function, and the rules of the
file storage. A function that runs with the rights of the role that defined it
skips row-level security and must check its caller itself
(\cref{tab:deployed}).
```

#### 3.3, "Browser to backend" (old lines 182-186)

Rewritten with the corrections of the verification. The current interface writes the language setting to the profile directly (useLanguagePreference.ts:97-99, the one exception that boundary.test.ts allows by name), and the app shell reads the profile and the account type from Supabase at sign-in (src/lib/auth.tsx:89-122). For an oral question: the shell also reads Luna's look and the badges directly (src/features/avatar/useAvatar.ts:60-63, 94-97) and joins a Supabase Realtime presence channel for every signed-in user (src/features/social/store.tsx:32). The check therefore replaced "all its data except sign-in, the account type, and the language setting" with one statement about the sealed screens and one about the app around them. Kept: the bearer token, now cited at core/auth_middleware.py:71, and the boundary test (boundary.test.ts, added in 7c83180e, August). Not added, because the record lacks it: why live data goes through FastAPI and not straight to Supabase (Polish 3.4 #3). The record has only the reason for the boundary itself: the interface was first built on mock data, so that wiring it later would swap the data source and not rewrite screens (UI-SESSION-BRIEF.md:78).

```latex
\paragraph{Browser to backend.}
The browser talks to Supabase directly only for authentication, for reading the
user's role, and in the remaining screens of the older interface. All data of the current interface goes through the FastAPI backend, which receives the user's
Supabase session token as a bearer token. A test enforces this boundary: no
module of the v4 feature folder may import the Supabase client.
```

#### 3.3, "Deployment" (old lines 188-193)

Removed in the check, after a rewrite: Package E keeps only what Chapters 4 to 6 use, action ch3-01 lists "Deployment" among what goes, and Section 1.4 places the hosting infrastructure outside the thesis. The rewrite stated four facts, each with its source: five containers on one virtual machine (still in the parts paragraph of 3.3, docker-compose.prod.yml); manual deploys over SSH (docs/runbooks/deploy-main-to-prod.md: no deploy automation); the encrypted nightly dump and the external monitor (docs/runbooks/monitoring-and-backups.md: the dump is age-encrypted before it goes to Cloudflare R2, and Better Stack alerts by e-mail when a check-in reports a problem or stops arriving); and the proxy configured only on the server (deploy-main-to-prod.md: host nginx terminates TLS and proxies to 127.0.0.1:3000 from a site file in /etc/nginx, which the repository does not hold). First the rewritten paragraph, verbatim, then the old one:

```latex
\paragraph{Deployment.}
Deploys are manual, over SSH (\code{deploy-main-to-prod.md}). Each night the
server encrypts a dump of the database before copying it off the machine,
and an external monitor alerts the author when the server stops reporting
that it is well (\code{monitoring-and-backups.md}). The proxy in front of
the containers is configured only on the server, so the deployed system
cannot be rebuilt from the repository alone (\code{deploy-main-to-prod.md}).
```

```latex
\paragraph{Deployment.}
Production runs these components in five containers on one virtual machine.
Deploys are manual, the nightly database dump is encrypted before it leaves
the server, and an external monitor alerts when a heartbeat goes silent. The
host's proxy configuration exists only on the server, so the deployed system
cannot be rebuilt from the repository alone.
```

#### 3.4, Technology Choices (old lines 195-211)

Kept, with two changes from the verification. First, "in this way PyMuPDF replaced pypdf" applied the author's general method of uploading and fixing to one change without a record; PR #4 (squash commit ac71c1a4, whose message repeats that of 227267e7) states only that it rewrote the parsing backend "to use PyMuPDF for better text extraction". The new text says "without a recorded comparison". Second, the co-developer's commit 8fac2fc3 (June: a Redis client in backend/core/redis.py and a Redis cache for sign-in tokens) is named, so that the paragraph does not imply that the co-developer had no part in Redis. The roles of nginx moved into the sentence of 6ce7b5f1, and the citations of FastAPI and Arq moved here from 3.3. Open: whether the later choices were discussed with the co-developer, and the author's reason for nginx.

```latex
\section{Technology Choices}
\label{sec:stack}

Before we started, we discussed the stack together. The co-developer
researched and chose the first one, React, Vite, TypeScript, Tailwind,
Supabase, and a FastAPI service, and it came with the first commit in January
(\code{184e5742}). The later choices were the author's own. In May the author
added Redis, the Arq job queue, and nginx (\code{6ce7b5f1}): parsing a deck
takes longer than an HTTP request should last, so it runs as a job, and nginx
serves the built interface and forwards its API calls to the backend. In July
the author split Redis into two instances, because a cache may drop entries
while a queue must never lose a job (\code{43a86927}). We did not choose the
text extractor by comparing libraries. We uploaded decks, looked at the
titles, the page text, and the quiz that came out, and fixed what failed; in
this way PyMuPDF replaced pypdf in April for better text extraction
(PR~\#4). The benchmark of \cref{ch:content} was the first measured comparison
that this extractor faced.
```

#### 3.5, Constraints (old lines 213-223)

Kept, with the qualifier the verification asked for: when Redis is unavailable, the per-user check lets the call through (ai/cost.py:113-128), so that a metering outage never breaks a model call (ai/cost.py:22-25). For an oral question: the per-user cap applies to model calls that name a user, such as Explain, Ask, Luna and rehearsals, and by default to parses of students' uploads (core/config.py:190-207; orchestrator.py:1483-1510); the OpenAI ceiling is shared by all workers through Redis. The machine size now stands once, here.

```latex
\section{Constraints}
\label{sec:constraints}

Three constraints shaped the design. The system
runs on one virtual machine with two virtual CPUs and 4\,GB of memory.
Model calls run on free or low-cost quotas, which is why the provider chains
have a fallback and spending is capped: each user has a monthly cap of \$2 by
default, and all users together a daily ceiling on OpenAI of \$10
(\code{core/\allowbreak config.py:187--195}). The
database is a managed PostgreSQL on a free tier without point-in-time
recovery.
```

#### 3.5, the July sign-ups (old lines 225-230)

Removed (author's decision: Section 1.4 states the July sign-ups, with five accounts, 12 events and no page read). Constraints now ends with one sentence that points to sec:scope.

```latex
One more condition is not a constraint and still shapes every evaluation in
this thesis. In July 2026 the platform was announced by e-mail to the
participants of the Database Systems course (\cref{sec:scope}). Five people signed up with
university addresses and looked around, but none used it enough to give us
data to evaluate or feedback to learn from. The evaluations therefore work on
material and not on people.
```

#### Not adopted from the review draft "Chapter 3 at minimal size"

The chapter title "Learnstation at a Glance" (the author kept "System Overview"); the move of the component figure to an appendix (the author kept it in the body); the three labels stacked on 3.3 (sec:stack and sec:constraints keep sections of their own); the pointers to sec:provider-strategy, sec:cost-controls and sec:authorisation, whose sections no longer exist (verification); "the model calls that write each page's text" (fact check: text pages keep their extracted text); "row-level security ... is the only check" on the browser's path (examiner 2: function rights and storage rules also decide, and definer functions skip row-level security); "In this way PyMuPDF replaced pypdf ... because it extracted the text better" (fact check: no record links the change to the upload-and-fix method); and the July sentences (Section 1.4 holds them). The draft's sentence "The owner need not have written the material; where we mean the writer, we say lecturer" and its remark that learners answer the deck quiz under Practice also stayed out, for length; the glossary defines "lecturer".

### Chapter 4 rewritten (16 November): what left the chapter, verbatim

Chapter 4 was rewritten on 16 November 2026 from the reviewed drafts of 15 November (results.json, part ch4: rewrites R1 to R6, drafts 'Answer to RQ1', 'Parse once, fail visibly' and 'Planning the Deck Without a Model'), their verification (verify.json) and the author's decisions of 16 November. It gained Section 4.2, How the Pipeline Developed, written only from commits, PR texts, commit messages and code at the pin. Every paragraph of the chapter at 8cb8dec1 that changed or left is kept below in its old wording, so that every sentence survives here; each entry says what left and why. Section names below are those of the chapter; the old numbering had no Section 4.2 on the history, so old 4.2 to 4.4 are now 4.3 to 4.5. Paragraphs not listed are unchanged: 'The input makes three demands on the design.', the yardstick sentence, the drawn-diagram paragraph of the routing rule, the opening of the evaluation, the routing study's Setup and its figure, the benchmark's Design paragraph on pre-registration, the duels, the figure, the Result and its three qualifications.

#### The old header comment of the file

The comment block at the top of the file described the cuts of 9 and 10 November. A new comment now records today's rewrite, its sources, and the labels it keeps. The old block is kept here so that the history of the file stays readable.

```latex
% ---------------------------------------------------------------------------
% OPTION A, CHAPTER 4 (RQ1). Re-cut 2026-11-09 from the drafted "System
% Design" chapter (04-design.tex: ingestion pipeline, provider strategy) and
% the benchmark subsection of the drafted "Evaluation" chapter, both written
% 2026-11-05/06 at the final pin dfc20df6 with AI assistance (Claude) from
% facts verified against the code. New prose in this file (requirements,
% lineage, deck plan, routing study, benchmark results, Deck Lab, LlamaParse,
% answer to RQ1) was written 2026-11-09 from docs/thesis/CHAPTER_MATERIAL.md
% and BRIEF_VERIFICATION.md §8; every number there carries a source. The
% author must read, revise and own every sentence before submission.
% Labels of the moved sections are unchanged so that other chapters' \cref
% still resolve.
% ---------------------------------------------------------------------------
% 2026-11-10 (cut to length): the lineage table, the idempotency layers,
% failure handling, the provider detail and the hosted-parser trial moved to
% appendix C; summaries stay here.
\chapter{From PDF to Structured Pages}
\label{ch:content}
```

#### Chapter opening

The opening now also names the new Section 4.2, How the Pipeline Developed. The old sentences are kept here.

```latex
This chapter answers RQ1. It describes the pipeline at the pin and two pieces
of evidence: a routing study on 1{,}593 pages and a pre-registered blind
benchmark of eleven extraction methods.
```

#### The Input and What It Demands: what the input is

Chapter 1 now defines the deck (Section 1.1), and Table 1.1 defines Lesson and page, so the chapter no longer defines them again. One sentence stays and points to the table.

```latex
The input is a lecture PDF: the slides a lecturer exports and shares, which
this thesis calls a \emph{deck}. A deck is one PDF of slides, usually for one
lecture session. Inside the system it becomes a Lesson, and each of its pages
a page.
```

#### The Input and What It Demands: the corpus paragraph

Two sentences changed; the rest is the author's version of 16 November, unchanged. The sentence that defines heterogeneous moved into the first demand, where rewrite R2 makes it concrete (Polish 4.1 item 2). 'All are born-digital, and scanned documents are outside the corpus' became 'All are born-digital, exported from a program and not scanned', which defines the term in one clause; scanned documents stay outside the corpus.

```latex
The prototype was built for the Database Systems course at the University of
Marburg, and its eleven decks, ten in English and one German introduction,
are part of the corpus. To see whether the pipeline also works on other
slides, we added fourteen German decks of a second Marburg course, System
Software and Computer Communication (\emph{Systemsoftware und
Rechnerkommunikation}). Together they form the corpus of this
chapter: 25 decks with 1{,}593 pages. The benchmark adds one
software-engineering deck and two exercise sheets. All are born-digital, and
scanned documents are outside the corpus. \emph{Heterogeneous} here means the
mix of page types within such decks. Pages from both courses were used to
calibrate the routing rule, so the second course is not an independent test
of it (\cref{sec:c4-routing-study}).
```

#### The Input and What It Demands: the three demands

The first demand follows rewrite R2 and Polish 4.1 item 2 ('i dont get this'): it now leads with the point, defines the text layer and a figure, and says 'most pages' instead of 'almost every page', because the threshold sweep finds only 3 of the 54 boilerplate lines of the database decks on 90 % of the pages or more (verification, facts). 'Embedded image' became 'figure', because the 421 count pages with a figure block after logos and backgrounds are removed (routing-labels record). The sentences 'A method that reads only the text layer reads the footer with the same confidence as the content. It reads a drawn diagram as a handful of loose labels.' left in this wording; their content stays in the rewritten demand. In the third demand, 'through their rate limits' became 'because they accept only a few calls per minute or per day' (action ch4-05). The second demand is unchanged.

```latex
\begin{description}
  \item[Pages are heterogeneous.] A deck mixes dense text, bullet lists with
    formulas, diagrams drawn with lines, and pictures
    (\cref{fig:page-types}). 421 of the 1{,}593 pages contain at least one
    embedded image. The systems
    decks carry a footer and a page number on almost every page, and the database
    decks carry a course name. A method that reads only the text layer reads
    the footer with the same confidence as the content. It reads a drawn
    diagram as a handful of loose labels.
  \item[A learner should not wait.] The learner should start on a deck at once,
    as with any PDF, while the system prepares everything else in the
    background. Preparing a deck can take minutes: in one measured run of
    October 2026, an 82-page deck took about twelve minutes from upload to a
    complete reading view
    (\code{docs/\allowbreak thesis/\allowbreak evidence/\allowbreak reader-timing.md}).
    The pipeline therefore runs behind the learner's reading, not in front of it.
  \item[Model calls cost money and fail.] The free tiers of hosted models
    stopped bulk parsing within minutes through their rate limits
    (commit \code{a12666cd}). A self-hosted model on a university GPU
    server would have needed time and experience that we did not have, and
    its cost would have been harder to compare, so we chose a paid API. With
    a provider that charges per token, every call has a price, which makes
    the number of model calls per deck a design variable. It also frames the
    central comparison of this chapter: whether a page is best read by a text
    extractor, by a vision model, or by both.
\end{description}
```

#### Figure 4.1 in two rows

Set in one row, as action ch4-06 asks, with short labels and a shorter caption. The caption sentence on drawings left, because the routing section states it ('The rule counts embedded images only ...'). The old figure code is kept here in case the one-row panels turn out too small in the build; the review's fallback is two rows at 0.3 of the text width.

```latex
\begin{figure}[htbp]
  \centering
  \begin{tabular}{@{}p{0.48\textwidth}@{\hspace{0.04\textwidth}}p{0.48\textwidth}@{}}
    \includegraphics[width=0.48\textwidth]{f26-page-types-a} &
    \includegraphics[width=0.48\textwidth]{f26-page-types-b} \\
    \small (a) Dense text: 1{,}345 characters, read as text. &
    \small (b) Bullets and formulas: 641 characters, read as text. \\[6pt]
    \includegraphics[width=0.48\textwidth]{f26-page-types-c} &
    \includegraphics[width=0.48\textwidth]{f26-page-types-d} \\
    \small (c) A diagram drawn with lines: 63 characters of labels, read as
    text. &
    \small (d) A plot with a running footer: 32 characters, 97 with the
    footer; the image covers 45\,\% of the page, so it goes to vision. \\
  \end{tabular}
  \caption{Four pages of the corpus, drawn from their real layout: each line
    of text is a bar, bullets are dots, lines with formula symbols are
    hatched, a footer is dashed, and an embedded image is a crossed box. The
    content of the slides is not shown, and character counts leave footers
    out. The routing rule does not count a
    drawing as a figure, so page~(c) is read as text, while an image page with
    this little text goes to vision. Script:
    \code{docs/\allowbreak thesis/\allowbreak experiments/\allowbreak page-types/}.}
  \label{fig:page-types}
\end{figure}
```

#### The heading of the pipeline section, with both labels

The label sec:c4-lineage moved to the new Section 4.2, How the Pipeline Developed; sec:pipeline stays on The Pipeline as Built.

```latex
\section{The Pipeline as Built}
\label{sec:pipeline}
\label{sec:c4-lineage}
```

#### The Pipeline as Built: the opening paragraph

'The last of nine generations' left, because the new Section 4.2 tells five versions, and the lineage table in the appendix lists the later rebuilds of v5 as rows. The sentences that 'lecture' and 'slide' name database rows and that PyMuPDF extracts the text left (action ch4-08): the chapter no longer uses the row names, and the job steps now name PyMuPDF. The pointer to the pipeline figure stays, now saying that the figure uses the terms of the code (Polish 4.3 items 1 and 2).

```latex
One pipeline is in use: pipeline v5, the last of nine generations
(\cref{tab:lineage} in \cref{app:detail}), kept in
\code{backend/\allowbreak services/\allowbreak parser/\allowbreak unified\_orchestrator.py}.
PyMuPDF~\cite{pymupdf} extracts the text. In this chapter \emph{lecture} and
\emph{slide} name the database rows that hold a Lesson and its pages, and
\cref{fig:pipeline} in \cref{app:figures} shows the path from an upload to a
readable page.
```

#### The Pipeline as Built: What reliable means here

Rewritten as 'What we mean by reliable' (rewrite R3, Polish 4.3 item 3). 'A transformation that learners depend on must also be reliable' and 'The subsections below describe the mechanisms' left. The second count left: 'Of the 23 parses since September, 21 completed and two exceeded the job timeout (\cref{sec:async}).' The two timeouts stay in the subsection on asynchronous processing, and the September count is in docs/thesis/evidence/parse-runs.md. The upload limits, the end-to-end test and the 115 production parses stay.

```latex
\paragraph{What reliable means here.} A transformation that learners depend on
must also be reliable. We mean two properties of the design: every accepted
upload ends either as a readable Lesson or as a visible failure, and the same
work is not done twice for one uploader. The subsections below describe the
mechanisms. Tests at the pin check each one, for example with a full run
against a real database (\code{test\_unified\_pipeline\_e2e.py}). The API
refuses an upload that breaks a limit before it queues a job: more than
50\,MB or 300 pages, more uploads than a student's monthly quota (five by
default, 30 in production), or a queue that already holds 50 jobs
(\code{core/\allowbreak config.py:90,101,134}, \code{upload\_service.py:13}). In production, 115 parses ran on
pipeline v5 between June and November 2026, our own uploads included: 99
completed, 16 failed, and none was left unfinished
(\code{docs/\allowbreak thesis/\allowbreak evidence/\allowbreak parse-runs.md}).
Of the 23 parses since September, 21 completed and two exceeded the job
timeout (\cref{sec:async}). These counts show that failures surfaced as
failures. They are too few, and the load too light, to measure reliability
under real use.
```

#### Asynchronous Processing, Page by Page: the first paragraph

'Parsing a deck takes minutes, longer than an HTTP request should live, so' left in this wording: Section 4.1 already says that preparing a deck takes minutes, and Chapter 3 and the v3 paragraph of Section 4.2 say that parsing runs as a job. The 900-second timeout, the two November decks and 'We did not measure where the limit lies' stay. The line range of arq_worker.py became 52--56, because line 51 is blank at the pin.

```latex
Parsing a deck takes minutes, longer than an HTTP request should live, so the
API hands the work to a durable queue and returns, and a worker takes the job.
A job that runs longer than 900~seconds is cancelled, and its run ends as
failed with a message to the user (\code{arq\_worker.py:51--56,362}). In
November 2026 this happened to two decks of 78 and 104 pages, although decks
of 82 to 136 pages had finished in October, so the page count alone does not
predict it. We did not measure where the limit lies.
```

#### Asynchronous Processing, Page by Page: the fixed sequence

Rewritten after rewrite R4, Polish 4.3.2 item 2 ('does user understand slide synthesis?') and Polish, Figure 1.1, item 2 ('why we chose 8 slide per call'). The paragraph now defines synthesis (a title and a short summary for each page; a page keeps its own text unless it has none), the parse receipt (the text-model calls with their tokens and cost; vision and embedding calls are not metered, unified_orchestrator.py:546--547) and embeddings, and uses the decided wording on eight pages per call. 'writes optional page summaries' left, because a flag that is off in production (FEATURE_STUDIO_PAGES) gates that step. 'creates the lecture row ... inserts every slide' became 'creates the Lesson ... stores each page'. 'The worker writes all content, and the browser never writes parse output' left; the v5 paragraph of Section 4.2 says that the server writes every Lesson, page and question. 'on the uploader's device' stays, as the verification asked.

```latex
Inside one job the pipeline runs a fixed sequence: it extracts the text of
every page, plans the deck (\cref{sec:c4-deck-plan}), generates the Lesson's
metadata, synthesises the pages, writes optional page summaries, generates the
deck quiz, writes a parse receipt, translates, and waits for the embeddings.
It creates the lecture row before it synthesises any page and inserts every
slide as soon as it is ready, which makes early reading possible. On the
uploader's device the reading view opens the file itself at once, so a learner
reads the lecturer's own pages while the generated ones arrive, and it shows
the generated pages as soon as the first exist, long before the parse ends
(\code{useEarlyReading.ts}). The worker writes all content, and the browser
never writes parse output.
```

#### Planning the Deck Without a Model

Rewritten after draft D4 (action ch4-12) and the verification (examiner 1, B9). The section now names the three things the plan does, defines deterministic and boilerplate, and gives the page budgets that Chapter 6 relies on: up to ten pages for the quiz and up to fifteen for the title and summary (synthesis.py:176, deck_plan.py:250--259). 'The threshold was chosen, not derived' became 'We chose the 60 % without measuring it', followed by the check at 50 and 70 % from the former scorecard. The renumbering fault stays, now with the first 15 and first 10 pages from the docstring of deck_plan.py (lines 3--4), as the verification asked. 'Before this step, the metadata and quiz steps' became 'Before the plan, ... the title step ... and the quiz step'.

```latex
Before any model call, a deterministic step plans the deck
(\code{deck\_plan.py}). It finds boilerplate, lines that recur on at least
60\,\% of the pages, such as a course name in the header; the threshold was
chosen, not derived. It gives each page one of eight roles by simple rules,
such as title, section start, agenda, or summary. It then groups the pages
into sections and selects the pages that the metadata and quiz steps read. The
model sees the text without the boilerplate, while the stored slide keeps the
original. A line of real content that recurs as often is hidden from the model
too. Because the step makes no model call, we can test it thoroughly,
including with property-based tests.

Before this step, the metadata and quiz steps read only the first pages of a
deck, and a quiz question could point at the wrong page, because a filter
renumbered the pages it kept. In production, all 524 deck-quiz questions
written before the plan sat on the first eleven pages of their decks; since
the plan they reach page 121
(\code{docs/\allowbreak thesis/\allowbreak evidence/\allowbreak deck-quiz-anchors.md}).
```

#### Routing: Text versus Vision, the rule

Rewritten as three cases (rewrite R5, action ch4-14). The definition of a running footer stays, with the reason that the code itself gives, that footers are never summarised (page_blocks.py:186), as the verification asked instead of a reason in our voice. The sentence that contrasts the footer with the boilerplate of the deck plan left (ch4-14): 'Unlike the boilerplate of the deck plan, which compares the pages of a deck, the footer is judged on each page alone, and neither changes the text that the learner sees.' The last sentence changed, because the code flags every page without text for review, not only those whose vision call fails (unified_orchestrator.py:434--457), and keeps the raw text when the call fails (lines 275--278).

```latex
One function decides how the pipeline reads each page. It measures the PDF
page itself, so the decision does not depend on which parser supplied the
text. It counts the page's own text without running footers, and the share of
the page that embedded images cover. A running footer is a text block that
starts in the bottom tenth of the page in smaller type than the page's body
text, which also covers a small source line at the foot of a slide
(\code{page\_blocks.py:22--23,185}). Unlike the boilerplate of the deck plan,
which compares the pages of a deck, the footer is judged on each page alone,
and neither changes the text that the learner sees.

A page with fewer than 25 characters of text has nothing to read but the
picture, such as a scan or a photo, and goes to a vision model. A page with
fewer than 150 characters whose embedded images cover at least 5\,\% of it
depends on its image and also goes to vision: it keeps its own text as
content, and the vision model supplies title and summary. Every other page is
read as text. If a vision call fails for a page without text, the pipeline
keeps the raw text and flags the page for review.
```

#### Routing: Text versus Vision, the threshold the rule replaced

Deleted (action ch4-14). Section 4.2 now tells when the 25-character threshold came in, and the routing study reports the comparison in full: 87 of 1,593 pages, 75 of them carried by a figure.

```latex
This rule replaced a single threshold in November 2026: until then a page went
to vision only if it had fewer than 25 characters of raw extracted text. The
study in \cref{sec:c4-routing-study} shows that the old rule sent no page with
an image to vision, and that the new rule sends 87 of the 1{,}593 pages, 75 of
them pages with an image.
```

#### Parse Once: Idempotency (a subsection until now), and Failures

Cut to one paragraph, 'Parse once, fail visibly', at the end of the subsection on asynchronous processing, which keeps the label sec:idempotency (draft D3, action ch4-09). It keeps the hash as identity, the unique key, the lock and the replay, the Redis caveat, the reason from the docstring why a parse is not shared (unified_orchestrator.py:785--791), the second uploader's case, failure, sweep and retry. What left: the subsection heading; the count 'nine mechanisms in four layers ..., eight of them active' (the mechanisms are in docs/thesis/defence-notes.md under 'Appendix C, The Nine Idempotency Mechanisms'); the explicit 'Without Redis, two simultaneous jobs of one uploader can both parse', now 'as long as Redis, which holds the lock, is reachable'; the sentence on the project's 'parse once' principle with the bytes stored once and the shared embeddings; and the pointer 'The final chapter names sharing as future work' (the outlook of Chapter 7 still names it). 'the second job waits behind the shared lock and fails after six hours' became: the second job finds the lock held, its run stays queued, and the sweep fails it after six hours (arq_worker.py:67,72), as Appendix C.3 described it.

```latex
\subsection{Parse Once: Idempotency}
\label{sec:idempotency}

The pipeline is content-addressed: a file's SHA-256 hash is its identity, and
nine mechanisms in four layers use it to avoid doing the same work twice,
eight of them active in the code. Three carry the guarantee: a unique key on
hash, pipeline version, and user for each parse, a lock on the hash while the
worker parses, and the replay of a finished run. While Redis, which holds the
lock, is reachable, they give at most one parse per uploader and pipeline
version, unless someone forces a re-parse. Without Redis, two simultaneous jobs of one uploader can both parse.

This is the precise content of the project's ``parse once'' principle. The
system stores the bytes once and keys the retrieval index by hash, so everyone
who uploads a document shares its embeddings. The parsed lecture is not
shared: two students who upload the same deck each get, and each pay for, one
parse. The orchestrator's docstring declares sharing out of scope for a
technical reason: the embeddings are attached to a Lesson through the file's
hash, so a shared parse would silently move them to whichever owner parsed
last (\code{unified\_orchestrator.py:785--791}). The final chapter names
sharing as future work. If a second
user uploads identical bytes while the first user's parse runs, the second job
waits behind the shared lock and fails after six hours.

\paragraph{Failures.}
A failed job finalises the pages it has written and marks its run as failed, a
sweep resolves runs that are stuck, and the user can retry.
```

#### The Routing Study: Why

Rewritten in our voice (action ch4-15, Polish 4.2 item 2). 'No recorded rationale' and 'survived three pipeline generations' left: the threshold entered v5 in June (commit bd03f1d5), and Section 4.2 now counts five versions, not nine generations.

```latex
\paragraph{Why.} The 25-character threshold had no recorded rationale: it entered the code in June 2026 without a reason for its value, and it survived three pipeline
generations. Before replacing it, the author asked what it did on real decks.
```

#### The Routing Study: Result

'figure block' became 'figure' (action ch4-23), because Section 4.1 now defines a figure. Nothing else changed.

```latex
\paragraph{Result.} No page in the corpus has between 15 and 39 raw
characters, so any threshold in that range routes the same 12 pages to vision:
the eleven empty closing photo pages of the database decks and one summary
page. None is teaching content. Of the 421 pages that contain a figure block,
none reached a vision model, because a page number and a footer alone exceed
25 characters. The systems decks never reached vision at all, their minimum
being 76 raw characters. The threshold therefore selected empty pages, not pages with a figure.

To decide what a page with a figure needs, the author labelled the hard case:
all 55 pages with at least one figure block and 25 to 150 raw characters,
answering for each whether a text model could explain the page from its text
alone. The author labelled 53, all as needing the image, and left two
unlabelled. The rule in the code at the pin sends 87 pages of the corpus to
vision: the 12 pages without text and 75 pages carried by a figure
(\cref{fig:routing}). It catches 52 of the 53 labelled pages and both
unlabelled ones; the one miss is a page whose figure covers less than 5\,\% of
it. Routing every page under 150 characters would have cost 149 vision calls,
not 87, and caught all 53.
```

#### The Routing Study: what this does and does not show

Only a pointer to Section 1.4 was added to the last sentence, where the thesis says what production runs. Nothing left; the old paragraph is kept here so that the record of changes is complete.

```latex
\paragraph{What this does and does not show.} The author made the labels on a
sample chosen to be the hard case and then shaped the rule to catch them, so
the 52 of 53 is a fit on the rule's calibration set and not an accuracy. Of
the 75 pages carried by a figure that the rule routes to vision, 21 lie outside
the labelled sample. The study establishes that the old rule routed no page
with a figure to vision on 1{,}593 real pages, and that the new rule routes
the pages carried by a figure at one vision call each. The labels contain no
page that the author judged readable from its text, so the study cannot
estimate how many of the 87 vision calls are unnecessary. And \enquote{needs
the image} is the author's judgement: we ran no text model on the pages to see
whether its explanation fails. Production did not yet run the new rule at the
pin and has run it since November 2026.
```

#### The Text Extraction Benchmark: Why

'Before the benchmark, nobody had measured the choice of extractor' left, because Chapter 1 (Section 1.2) and Chapter 7 say it. The three kinds of method are now defined in one clause each: layout engine, Markdown, vision model.

```latex
\paragraph{Why.} The current extraction is PyMuPDF's plain text layer, and
every later step reads what it produces: the synthesis, the quiz, and the
retrieval index. The question was whether a layout-aware tool, a converter to
Markdown, or a vision model transcribing the page image would give a learner
better text, and what each costs. Before the benchmark, nobody had measured
the choice of extractor.
```

#### The Text Extraction Benchmark: the methods and the test set

The four comparisons are now named here in one sentence (action ch4-16), moved from the Procedure paragraph. 'The set includes no scanned page' left, because the Threats paragraph says it ('hold no scan').

```latex
The author judged eleven methods: ten challengers against \emph{current}, the
production extraction, which anchors the scale at 1000. The challengers were
two Markdown converters, pymupdf4llm~\cite{pymupdf4llm} and
MarkItDown~\cite{markitdown}; four layout engines,
Docling~\cite{auer2024docling}, MinerU~\cite{wang2024mineru},
Marker~\cite{marker}, and OpenDataLoader~\cite{opendataloader}; the browser
engine pdf.js~\cite{pdfjs}; a PaddleOCR vision-language
model~\cite{paddleocr} in a 4-bit build; and two vision models that
transcribe the page image, \code{gpt-4.1-mini} and the larger
\code{gpt-6.1-sol}, which we chose for its capability per dollar. The test set
is 24 born-digital pages from five PDFs of three courses in two languages,
drawn per source by a stated rule and a seeded random draw. The author
assigned each page one of five types, such as lists, diagram, or dense text.
The set includes no scanned page.
```

#### The Text Extraction Benchmark: the ratings

Rewritten after R6, in our voice. 'Every vote enters the fit, hidden repeats included' stays as 'All 283 votes enter the fit, the 13 hidden repeats included', as the verification asked. The bootstrap is defined in a clause. 'Its intervals are therefore likely too narrow, and we read H1 as a statement about this judge on these pages' moved, the first half staying here and the second going to the H1 paragraph, after H1 is defined.

```latex
Ratings come from a Bradley--Terry model~\cite{bradley1952rank}, in which each
method has a strength and its expected score against another is its share of
the two strengths. Minorisation-maximisation~\cite{hunter2004mm} fits the
strengths with a weak prior, and a bootstrap~\cite{efron1993bootstrap} of
1{,}000 resamples gives their intervals. Points are $1000 + 400 \log_{10}$ of
the strength ratio to the anchor, so 400 points above the anchor means a ratio
of 10:1 in expected score. Every vote enters the fit, hidden repeats included.
A vote of ``same'' or ``both unusable'' counts as half a win for each side, so
the scale measures preference and not usability. Such draws are 142 of the 283
votes, so a ratio on this scale is not the chance of winning a duel. The
bootstrap treats single votes as independent, although the 283 votes concern
24 pages and the first round set the schedule of the second. Its intervals are
therefore likely too narrow, and we read H1 as a statement about this judge on
these pages
(\code{backend/\allowbreak eval/\allowbreak parser\_bench/\allowbreak ranking.py}).
```

#### The Text Extraction Benchmark: H1

The Bonferroni correction is defined in a clause, and the sentence on reading H1 moved here from the ratings paragraph. Nothing left.

```latex
A challenger passes if the lower end of its bootstrap interval,
Bonferroni-corrected~\cite{dunn1961multiple} for the $k = 10$ challengers, lies
above 1000. The hypothesis H1, that the judge rates at least one method above
current, holds if any challenger passes. The test is on these bounds and not on
rank. The frozen protocol worded H1 for layout-aware tools and four
challengers, and the deviations extended it to every method added later, the
vision models among them.
```

#### The Text Extraction Benchmark: Procedure

The list of the four comparisons moved to the Design paragraph. 'Within a comparison a first round followed the seeded schedule, and a pre-registered second round could add duels among the leaders' left, because the Design paragraph states the pre-registered second round (action ch4-16). The judging months, the hidden repeats, the side bias and the pooling stay.

```latex
\paragraph{Procedure.} The benchmark ran in four \emph{comparisons}, each a
batch of duels among a fixed set of methods. The first held the five fast
methods: current, pymupdf4llm, MarkItDown, pdf.js, and OpenDataLoader. The
second added the two vision models, the third the three heavy local engines,
Docling, MinerU, and Marker, which processed only a 60-page excerpt of the
five PDFs, and the fourth the PaddleOCR build. Within a comparison a first
round followed the seeded schedule, and a pre-registered second round could
add duels among the leaders. The author judged all four in late October and
early November 2026, 283 votes in all. Hidden repeats agreed in 12 of 13 cases
(exact 95\,\% interval 64 to 100\,\%), and the author retracted no vote. Of
the 141 decisive votes, 86 chose the output on the right-hand side (binomial
test, $p = 0.011$). The balanced schedule keeps this from favouring a method,
but it shows that something other than content moved decisions. We pool all
four comparisons on one scale.
```

#### The Text Extraction Benchmark: where the methods differ

The method-by-method footer counts left (action ch4-17); one contrast sentence stays, as the verification asked: the methods that strip the footer do not lead, while the vision models copy it on 8 and 18 pages. Left verbatim: 'So do pdf.js and MarkItDown, and pymupdf4llm and Docling on 20 and 14 pages, while OpenDataLoader, Marker, and MinerU strip it on all but at most four.' OCR is now defined in a clause.

```latex
\paragraph{Where the methods differ.} Automatic checks over the same 24 pages
explain part of the ranking. The current extraction carries the running footer
into the content on 23 of the 24 pages. So do pdf.js and MarkItDown, and
pymupdf4llm and Docling on 20 and 14 pages, while OpenDataLoader, Marker, and
MinerU strip it on all but at most four. The vision models copy it on 8 and 18
pages, the stronger more often, because the prompt asks for everything that the
page prints. pymupdf4llm runs its own OCR pass on pages it judges image-heavy,
which is part of why it scores well and which production would have to switch
off.
```

#### The Text Extraction Benchmark: Cost

'Measured on an 8 GB Mac' and a reference to the protocol were added, because the benchmark measured time and memory on an M1 Mac with 8 GB, and the protocol calls the speeds relative, not production figures (PROTOCOL.md:178). Nothing left.

```latex
\paragraph{Cost.} The current extraction takes at most 0.06 seconds per page
at about 62\,MB of memory, and pymupdf4llm, with its OCR pass on, under a
second at about 390\,MB. The heavy engines take 1.2 to 5.8 seconds per page
and 0.9 to 3\,GB of memory, not counting what they allocate on the GPU, and
each needs a model download of 0.5 to 1.7\,GB. On the 4\,GB production
machine, which also runs the API, the worker, and two Redis instances, they are
not an option. The two vision models together cost \$0.21 for the 24 pages at
list prices, under a cent per page, at 1.8 to 5.7 seconds per page, and the
page leaves the server; the fee is paid per page and per uploader.
Production's OpenAI vision calls use neither model:
they run on the code default \code{gpt-4o-mini}, because the model variables
were never set. The benchmark therefore describes the
vision path with \code{gpt-4.1-mini} set, not the path as deployed.
```

#### The Text Extraction Benchmark: Threats

'The protocol names them before the result' became 'We named these in the protocol before the result'. 'over the golden set' left, because the chapter does not define the golden set. Every threat stays.

```latex
\paragraph{Threats.} The protocol names them before the result. The judge is
the author of the product. The automatic checks use PyMuPDF's own text layer as
reference, which favours two of the methods. The 24 pages come from one
university and hold no scan, duels within a comparison are not independent,
later comparisons were less blind, and the heavy engines saw a 60-page excerpt.
We corrected for none of this. Two further threats are not in the protocol.
First, methods that emit headings, lists, and tables gain typography in the
benchmark's viewer that plain text does not, so the benchmark measures which
rendered output a reader prefers. Second, the real consumers of the text are
models, for synthesis, quiz, and retrieval, and we did not measure whether the
preference carries over to them; a retrieval run per extractor over the golden
set would test it. No second rater judged any subset either, so how far the
result depends on the one judge is unknown.
```

#### Answer to RQ1

Replaced by the halved answer (draft D2, action ch4-18) with the fixes of the verification. The new answer keeps the routing numbers with the caveat that they are a fit, not an accuracy; the benchmark ratios with their cost; the memory of the heavy engines, 0.9 to 3 GB, against the 4 GB machine; the construct limit; one reliability sentence (design, tests, 115 parses with 16 visible failures, no load test, fault injection only in the provider layer); and a pointer to the outlook. What left: the four-part description with 'Identity by content', which was not measured and is not part of RQ1; the repeated benchmark detail, '31 of its 39 duels' and the footer on 23 of 24 pages, which the benchmark section keeps; the yardstick paragraph, whose three marks the new text answers (the routing study, reading at once, cost not measured); 'whether the new routing rule improves what learners read', which the routing study's limits cover; and the sentence on the open production decision between pymupdf4llm and vision, which the outlook of Chapter 7 carries.

```latex
How can heterogeneous lecture PDFs be transformed into structured pages that a
learner can read at once? Our answer has four parts. The routing study
evaluates the third. The scorecard confirms the implementation of the second,
and production shows that the deck quiz now reaches beyond the first pages. We
describe the first and the fourth without a measurement.

\begin{description}
  \item[Identity by content.] A SHA-256 hash names the bytes. The system
    stores one object per hash, keeps one run per document, version, and
    uploader, and replays a finished run instead of repeating it. A lock keeps
    concurrent duplicates out while Redis, which holds the lock, is reachable.
  \item[Decide before generating.] A deterministic plan assigns roles and
    sections, strips boilerplate from the model's input, and selects the pages
    that the deck-level steps read, with no model call.
  \item[Route by what the page holds.] One rule, measured on the page without
    its footer, sends pages without text and pages carried by a figure to a
    vision model and everything else to text. On 1{,}593 real pages this means
    87 vision calls, where the old rule made 12, all on pages without teaching
    text.
  \item[Write as you go.] The worker, not the browser, writes every page the
    moment it exists, and the reading view opens on the original PDF at once.
\end{description}

How do text extraction methods compare in the quality of their text and their
cost? On 24 pages from five PDFs of three courses, the author, judging blind,
preferred the transcription of the stronger vision model to the current
extraction at more than 10:1 in expected score on the fitted scale, and that of
the smaller one at about 9:1. Both cost under a cent a page. The author
preferred pymupdf4llm at about 4.5:1 without a fee, at under a second more per
page, measured with its OCR pass on, which production would switch off. The
heavy layout engines rank lower and need gigabytes of memory that the
production machine does not have. In the first comparison the author judged the
current extraction unusable together with its opponent in 31 of its 39 duels,
and its footer on 23 of 24 pages is one visible reason. The judge chose between
rendered outputs; whether synthesis, quiz, and retrieval do better on the
preferred text, we did not measure. We did not change the production parser on
this basis at the pin.

The yardstick of \cref{sec:c4-requirements} had three marks. The routing rule and its study answer how the pipeline handles a page with a figure. The design answers how soon a learner reads, because the reading view opens on the original page at once; we did not measure the time until the generated text of a page arrives. We did not measure what a deck costs: the benchmark prices the vision transcription per page, and we did not evaluate the cost ledger of production.

The reliability of \cref{sec:pipeline} rests on its design, on tests of
each mechanism, and on 115 production parses under light load. We ran no load
test, and fault injection covers only the provider layer
(\code{tests/\allowbreak unit/\allowbreak test\_chaos\_*.py}), not the database, the storage, or the worker.

We did not measure three things: whether the text generated for a page is
grounded in that page, whether the new routing rule improves what learners
read, and whether any extraction method improves learning. The final chapter
takes up these limits and the open production decision between pymupdf4llm
and vision.
```

#### The sources behind the new Section 4.2, claim by claim

Section 4.2 uses only commits, PR texts, commit messages and code; every claim was read at the commit it cites on 16 November. This list is for the oral defence. The workbench's re-run counts are not cited in the thesis, because their scripts are not in the repository.

| Claim in 4.2 | Source | Kind |
|---|---|---|
| A form with title, content, summary and one question per slide, before any parser | `184e5742` (`src/pages/LectureUpload.tsx`, first migration) | code |
| The first parser read each page with pypdf | `be25cc1d` (`file_parse_service.py`: `PdfReader`, `extract_text`, "Slide N") | code |
| A model wrote a rewrite, a summary and a question for every page at upload, three calls per page | `4c23d254` (subject "AI Slide Enhancement with Ollama, Dual-View Slide Viewer, and Quiz Fixes") | code and message |
| A fourth call for the title from March | `10296bef` ("Use AI to generate meaningful slide titles instead of Slide N") | code and message |
| The four calls merged into one per page at the end of March, by the co-developer | `76aa4b42` (`file_parse_service.py`: `process_slide_batch` replaces the four calls) | code |
| The original page beside the generated text | `4c23d254` ("Dual-View Slide Viewer") | message |
| The co-developer's filter kept non-teaching pages from the model, because they wasted tokens and produced useless questions; it reads the slide text | `bfbe6c09` (`content_filter.py`; `project_docs/implementation_plan_slides_filtering_v2`, section Problem) | code and plan in the commit |
| PyMuPDF replaced pypdf in April; with a vision model available, every page went to it as an image | `227267e7`, PR #4 (merge `ac71c1a4`) | code and message |
| v2 measured each page and routed it by rules before any model call | `7ffb0cd2` (`slide_classifier.py`, `file_parse_service.py`) | code |
| Rule 2 of v2 skips a page that the filter marked as metadata, so the filter decides first | `a801c31f` (`slide_classifier.py`, rule list) | code |
| v3: Arq job queue on Redis | `6ce7b5f1` (`workers/arq_worker.py`, `parser/stage1..5`) | code |
| v3: five stages, progress per page, resume after a crash | `6ce7b5f1` (`backend/services/parser/orchestrator.py` docstring: "wires all five stages together", "Idempotency / resume contract"); the design note `122460ec` (goal 2, principle P1) planned eight stages | code |
| v3 never served: Docling "adds 30+ min to build", the image runs version 2 | `requirements-docker.txt` at `6ce7b5f1` | code |
| v4 is a port of a Node.js version; its prompt asks for a professor's continuous lecture | `6ce7b5f1` (`parser/v4_orchestrator.py` docstring and `analyze_slide` prompt) | code |
| v4 sent 142 of 143 pages of a PowerPoint lecture to text in an offline check | message of `4f19bd1e` | message |
| v5 built in one day in June; the server writes lectures, slides and quiz questions; a vision-capable model | `4f19bd1e` (message: "fixes the two things v4 could not do") | message |
| One call per page by the end of that day, because a batch timeout blanked eight slides at once; 25-character threshold | `bd03f1d5` (message; `_MIN_TEXT_FOR_SYNTH = 25`) | code and message |
| The filter of v1 left the path with that rewrite | `bd03f1d5` calls neither `parse_pdf_stream` nor the filter (checked per commit) | code |
| v5 the only path since July | `a65b0f9d` (message: "exactly ONE pipeline (unified/v5) is reachable") | message |
| Groups of text pages again in July, because one call per page was "an ~8x cost multiple on the dominant cost driver"; per-page fallback for a failed group | `49994d51` | message and code |
| v4's functions for the deck's title, a page and the deck quiz moved into a shared module that v5 calls | `a65b0f9d` (message) | message |
| 25-character threshold set in June (routing study, Why) | `bd03f1d5` | code |

Eight pages per call: 12 pages per call before May 2026 (the chunker that `35fc8b50` replaced); 5 per call with one page of overlap on 3 May, so that the model can resolve references such as "this method" across a group boundary without a bigger call (`35fc8b50`; comment at `orchestrator.py:145--148` at the pin); 8 per call on 7 May (`6bfb51e6`, no reason recorded). The author's account: "we tried a lot of things and 8 was good". At the pin the groups of v5 do not overlap; the summary of the last page of a group goes to the next group as context (`unified_orchestrator.py:1058--1060,1214--1215`).

#### Checked but not used in the thesis text

- The workbench's re-run counts (the 30-page test file: 23 pages skipped by the filter, 1, 2 or 24, 3 and 10 pages with their image; the 143-page lecture: 89 skipped plus 28 to the judge, 108, 58 and 74 to vision). Their scripts are not in the repository, so the thesis does not cite them.
- "Unified routes 88 to VISION" in the message of `4f19bd1e`: an offline check of v5's first version, not of the version that served. Not cited, so that the 88 is not read as the served v5.
- The supervisor's suggestion of the on-demand button (February): confirmed by the author on 16 November and added to the v1 paragraph of Section 4.2. The buttons are in `be25cc1d` ("AI Generate" beside a slide's summary and its question in the lecturer's form, calling a local Ollama model); the suggestion itself is the author's account.
- The claims marked "memory" in the workbench: that the local model was too slow, that Gemini's free tier ran out on a full Database Systems lecture, that Groq and Cerebras were chosen for their free token allowance, that AI moved into the upload to test the whole chain and spare uploaders the buttons.
- "99/143 PowerPoint pages misclassified as decorative by v2" (CHANGELOG.md at `a4fc5abc`): a claim in our release notes with no measurement behind it.
- The generator-aware router of v3 (`parser/classifier.py` at `6ce7b5f1`): most PowerPoint pages with a picture or a drawing went to a vision model, without the filter's verdict. A drafted sentence on it, and the lesson that v2 and v3 show that a new check helps only once the old one leaves the path, were cut for length; both are true of the code.
- The free vision tier refused calls on the day v5 was built, so a paid OpenAI vision model followed (`a12666cd`); Section 4.1 cites the commit for the free tiers, so 4.2 does not repeat it.
- The deck plan (PR #84), the reading view that opens at once (PRs #139 and #145, October) and the routing rule (PR #178, November) rebuilt v5 from the inside; the appendix table lists them.

#### A code fact for the defence, not in the thesis

The prompt for a group of text pages (`ai/prompts.py:99--140` at the pin) also asks for rewritten content and one multiple-choice question per page. The pipeline keeps only the title and the summary and pins the page text to the raw text (`unified_orchestrator.py:409--417,1159--1165`), so the tokens of the rewritten content and of these questions are paid for and discarded.

### Defence notes, Chapter 5 (Learner Events and the Owner's View)

Written in November 2026 with AI assistance (Claude) during the rewrite of Chapter 5 for the first draft (Package H of the review on focus, length and voice of November 2026, actions C5-06 to C5-23, and the fixes of its verification). Each section below quotes, verbatim, a passage of the chapter as it stood before this rewrite (chapters/05-loop.tex of the preview-3 base), and says in one paragraph what left the thesis and why. Line numbers refer to that old file. Nothing here is new evidence; every fact was already in the thesis.

#### Header comment of the chapter file (old lines 1–17)

The provenance comment of the earlier pass and its cut-to-length note left the file. They described sources and moves of an earlier pass; the new header names today's sources (Package H of the review of November 2026, its verification, and the author's decisions). The comment is not thesis text and is kept here only for the record.

```latex
% ---------------------------------------------------------------------------
% OPTION A, CHAPTER 5 (RQ2). Written 2026-11-10 with AI assistance (Claude)
% from docs/thesis/CHAPTER_MATERIAL.md §5.1--5.9, the verification note
% docs/thesis/verification-notes/2026-11-09-analytics-rq2.md and the persona
% study in docs/thesis/experiments/persona-study/ (RESULTS.md, NOTES.md), all
% on branch claude/thesis-brief-verification-6573e8. Every number carries a
% source there. The engine is described at the pin \thesisCommit; the owner's
% view and the persona study are at 2e146f51, three days after the pin, and
% the text says so wherever it matters. Added 2026-11-10: sec:data-model (the
% author's drafted text from the former design chapter, shortened; the two ER
% diagrams moved to appendix B) and sec:authorisation with sec:hardening
% (written from the evidence briefs of the former implementation chapter,
% now in chapters/superseded/05-implementation.tex.txt).
% The author must read, revise and own every sentence before submission.
% ---------------------------------------------------------------------------
% 2026-11-10 (cut to length): schema notes and the hardening sequence moved
% to appendix C, F14 to appendix B.
```

#### Chapter opening (old lines 21–31)

Left: the full restatement of RQ2 (the chapter now opens as Chapter 4 does, with "This chapter answers RQ2"); "entered the main branch two days later", which names a day count where the new text uses months only; and "we mark these changes where they matter", because the changes of PR #181 are now listed once in the opening (C5-11) and the scattered remarks are gone. The verification required the list to include the speed bump (five people who turned back, where two sufficed at the pin); the new opening states it, together with the null below the floor, the reach word, and the rule that a finding carries no count of one to four people. The real-usage numbers (readers.md) stay, reworded. New: the loop is defined in the author's words, and the owner is pointed to Table 1.1 instead of being defined again (Polish.md, abstract comments 4, 6 and 7), and an event is defined at its first use (C5-23).

```latex
This chapter answers RQ2: how a system can model learner interaction events, aggregate them, and feed them back to the owner of the material without showing any individual learner, and what such a view can tell an owner about their material.

We describe the event log and the aggregation engine at the pin. The screen
that shows the result to an owner entered the main branch two days later
(PR~\#181, November 2026) and changed what the engine sends; we mark these
changes where they matter. The evaluation ran on that later revision,
\code{2e146f51}. The deployed system has almost no readers. In the 56~days
before our count in November 2026, members read in four Spaces; the busiest
had six readers, and only one page reached five, our own accounts possibly
among them (\code{docs/\allowbreak thesis/\allowbreak evidence/\allowbreak readers.md}).
The evidence is therefore a study with scripted readers.
```

#### Section 5.1, the loop as built (old lines 36–60)

Left: the narration of the loop as a cycle that starts with a PDF (the opening now defines the loop once); the long walk through the five stages of Figure 5.1, now one sentence; "At every stage after storage this loop speaks about pages and never about people", which makes the software speak and states an absolute that arm B contradicts (a hotspot can rest on three people), replaced by "After the log, no stage passes on a name or a list of members"; and the forward pointer "Two older paths outside it do not" (C5-11). The caption now says "loop" instead of "feedback loop". The figure itself is unchanged and still carries the labels that C5-19 asks to correct.

```latex
The loop starts with a PDF. Its owner uploads it to a Space, and learners
read it. What they do returns to the owner as facts about pages, the owner
decides whether to change a page, and a changed PDF goes back to the
learners, so that the cycle starts again. This is the cycle of learning analytics that Clow describes,
which closes only when an action reaches the learners
again~\cite{clow2012cycle}.

The system builds the first part: it records, aggregates, and shows. The
decision belongs to the owner and lies outside the software. Returning a
changed page works today only as a new upload: the owner uploads the revised
PDF as a new Lesson, the system has no versions of a Lesson, and the events
of the old Lesson do not carry over to the new one.

\thesisfigure{f23-loop}
  {The feedback loop in five stages. The engine applies the floor of five readers when it aggregates events, and no name leaves the last stage.}
  {fig:loop}

\Cref{fig:loop} shows the part that the system builds, as the path of one
interaction. The reading view \emph{records} it through one function, which
\emph{governs} it: the function rejects an event of an unknown type or with an
unknown field. One log \emph{stores} the event. When an owner asks, the engine
\emph{aggregates} the log of the Space's members, and the owner's view
\emph{shows} the result as one sentence, three numbers, and a map of pages. At
every stage after storage this loop speaks about pages and never about people.
Two older paths outside it do not, and \cref{sec:c5-privacy} names them.
```

#### Section 5.2.1, first paragraphs (old lines 65–83)

Left: the subsection title "One Log, Seventeen Governed Types"; with Storage dissolved, Section 5.2 has no subsections, and "governed" survives only where Figure 5.1 names the stage, with its meaning in plain words (C5-22, Polish.md abstract comment 5). Left also: the wording "who, when, an event type, and a JSON payload" (replaced by the definition of an event, C5-23, which now stands at its first use in the opening, and by a description of the event row at the start of 5.2), "The backend does not store an event that fails either check", "A row that a member inserts directly ... meets only the first" (now in the paragraph on direct inserts), "the function logs the failure", and the counting sentence on eight, seventeen and six (the table shows these; the text keeps one pointer).

```latex
\subsection{One Log, Seventeen Governed Types}

All interaction data lives in one table, \code{learning\_events}: who, when,
an event type, and a JSON payload. Two checks restrict the type. In the
database a check constraint lists the 17 allowed types. In the backend each
type has a Pydantic model in one registry, and every model forbids unknown
fields (\code{schemas/learning\_events.py}). The backend does not store an
event that fails either check. A row that a member inserts directly through
the database interface meets only the first.

All writes of the reading view go through one function
(\code{event\_repo.py:64--91}). It validates the payload and inserts the row
inside a savepoint. If the database rejects the row, the function logs the
failure and drops the event, and the learner's request, for example turning a
page, still succeeds. The design loses an event rather than fail a reader.

\Cref{tab:events} lists the types. The reading view writes eight of the
seventeen, and the others belong to the older interface or to backend jobs. The
engine reads six.
```

#### Caption of Table 5.1 (old lines 88–90)

Only the word "governed" left the caption ("The 17 governed event types" became "The 17 event types"), because the review found the word unexplained jargon. The table body is unchanged.

```latex
  \caption{The 17 governed event types. \enquote{View} marks the types the reading view writes, \enquote{engine} the types the aggregation reads.
    Sources: \code{schemas/learning\_events.py:76--282};
    \code{insights/sources/space.py:39--46}.}
```

#### Section 5.2.1, the two decisions about content (old lines 112–114)

Left: "The table shows two decisions about content" (the second decision is not in the table) and "the answer the AI gives" (C5-23: "the model's answer"). The two decisions stay, and the new text names the principle they apply, data minimisation under Article 5(1)(c) of the GDPR (C5-23; the IT-security lens looks for it by name).

```latex
The table shows two decisions about content. The system never stores the answer the AI gives to a question, only the question. And
nothing from a private study session with the assistant becomes an event at
all (\code{insights/sources/space.py:38}).
```

#### Section 5.2.2, Storage (old lines 116–137)

The subsection was dissolved (C5-09), because half of it explained how a script that never ran would work. Left: the partition mechanics of the retention script, migration 20260721010000 (the declared monthly partitioning), "We therefore cannot claim that the system deletes old events", the clause on what the existing protection limits, and the policy that lets a member delete their own rows (migration 20260731010000). Moved: the real user id and the retention not in force, with event-table.md, to the opening of 5.5; the guards against forged events to 5.2. The verification required the trigger to be marked "at the pin", because migration 20261105010000 is applied by hand and no record shows it in production. New in 5.2: why members can insert rows directly (the older interface writes from the browser) and that such a row can carry a verdict of the member's own choosing, which the engine reads; this matches Chapter 6.

```latex
\subsection{Storage}
\label{sec:c5-events-storage}

A retention script in the code would delete old events, but \emph{it has
never run}. No scheduler starts it, and it works by dropping old monthly
partitions, which production does not have: the migrations declare the table
partitioned by month (migration \code{20260721010000}), but a read-only probe
of the production catalogue in November 2026 found a plain table
(\code{docs/\allowbreak thesis/\allowbreak evidence/\allowbreak event-table.md}).
We therefore cannot claim that the system deletes old events. Events also
carry the real user id without a pseudonym; the protection that exists limits
who may read the log and what leaves the aggregation.

A member can insert events for themselves directly, through the database
interface that the browser holds, and a database policy also lets a member
delete their own rows (migration \code{20260731010000}). Such a row passes the
type constraint but not the Pydantic models, so its payload may hold fields
that the backend would refuse. Three guards keep one member from distorting
what the owner sees. A trigger rejects a client timestamp more than
300~seconds away from the server's clock, the engine reads at most 5{,}000
events per member, and it reads only the payload keys it needs (PRs~\#142
and~\#175).
```

#### Section 5.3.1, from rows to page facts (old lines 144–175)

Left: "which is what makes the study ... possible" (merged into one sentence), the side clause that the reading view records Still foggy on the first page of an idea (the appendix on the scripted readers keeps it), "A request for help shows that a page was hard for some readers, but not that every reader who asked needed help" (merged into the proxy sentence), "The map, the share that is null below the floor, and the landing number all use it; no finding rests on a request for help alone" (replaced: the detectors use their own rules, so no finding rests on this signal at all), and the separate paragraph on three kinds of signal, folded into one sentence (C5-20). New: the older "Unsure" check-in also counts as reaching for help (C5-13, verified at space_facts.py:72–75), and the code reference for the owner's exclusion moved here from 5.5.

```latex
Apart from the themes at the end of this section, the engine is a pure
function. Its input is one value that holds the members of the Space, its
Lessons, the events, and the current time, among other things
(\code{insights/\allowbreak sources/\allowbreak space.py:67--82}). Its output
is the payload that the owner's screen draws. Nothing in between touches the
database, which is what makes the study in \cref{sec:c5-evaluation} possible.

The input has bounds. Members are the enrolled users without the owner, and
events are the six types of \cref{tab:events} from the last 56~days, at most
200{,}000 in all. From them the engine builds a small set of facts for every
page: who read it, who opened Explain, who asked, who rated it and how, who
turned back to it, and who answered its checkpoint right or wrong at the first
try.

From these facts it forms one signal per page. A reader \emph{reached for
help} if they opened Explain, asked a question, checked in with \emph{Still
foggy}, which the reading view records on the first page of an idea, or with
\emph{unsure}, which only the older interface offers, or turned
back to the page (\code{insights/\allowbreak space\_facts.py:72--75}). The
signal is a proxy, not a measured need. A request for help shows that a page
was hard for some readers, but not that every reader who asked needed help:
some ask out of interest, and some who struggle never ask. A reader may also
turn back to revise. Because any one of the four counts, the signal errs
towards flagging a page rather than missing one, and no study with real
readers has checked it. The map, the share that is \code{null} below the
floor, and the landing number all use it; no finding rests on a request for
help alone.

The engine thus reads three kinds of signal: what readers do, what they say in
the check-in, and what they get right in checkpoints and quizzes. Each is a
proxy. The findings that combine kinds, such as a confident check-in followed
by a missed checkpoint, are the ones that no single signal could give.
```

#### Section 5.3.2, the floor (old lines 177–194)

Left: "says nothing" (the software does not speak; the new text says what is shown and withheld), "This distinction entered after the pin; at the pin such a page reported 0, which the screen would have drawn as 'everything is fine'" and "This too entered after the pin, which still sent the count" (C5-11; the opening lists the changes of PR #181 once), and the figure pointer. New: the origin of the floor (the roadmap of July 2026, the mock-exam summary, the Space engine from October 2026) and the four sources the author read, with the honest conclusion that five is a judgement within established practice and below the ten most common for results about students.

```latex
\subsection{The Floor}

One constant, the floor of five, governs what the view may say. A page that
fewer than five members other than the owner have viewed says nothing
(\code{insights/\allowbreak space\_engine.py:25}); the members who viewed it
are the page's \emph{readers}. \enquote{Nothing} is not zero. The share of
readers who reached for help on such a page is \code{null}, and the screen
draws a faint outline instead of a dim cell, which would read as \enquote{few
reached for help}. This distinction entered after the pin; at the pin such a
page reported 0, which the screen would have drawn as \enquote{everything is
fine}.

The same rule holds for the whole Space. Instead of a count of its readers,
the payload carries one of three words, its \emph{reach}: \code{none},
\code{few} for fewer than five, or \code{enough}. This too entered after the
pin, which still sent the count. Counts appear only from five readers on: the
weekly number of members who read and, for a page with a finding, the number
of people who opened Explain or asked (\cref{fig:door}).
```

#### Section 5.3.3, eleven detectors, with the three-column Table 5.2 (old lines 196–249)

Left: the title "Eleven Detectors" (now "Detectors and Findings"); "the only one that speaks about individual students" (talking software; the caption now says "the only detector about individual students"); the sentence on shares that need five contributors and the minimum of three ratings that never binds (C5-08: the caption carries the floor rules); "We recorded no source for the detectors' thresholds ..." (C5-17, replaced by the author's decision: the thresholds date from June 2026, the 20 % values were chosen by judgement, no source gives them, and the study did not tune them; the floor of five now has its own paragraph in 5.3.2); the three-column table, whose third column repeated "shown from 5 raters" (C5-08), including the row note "since PR #181; at the pin from 2", which now sits in the opening, and the rows for the silent misleader and the silent strugglers, now in the caption; and the dwell paragraph (C5-20), whose two points are now clauses in the overpacked and skipped-page rows. The calibration paragraph was cut to two sentences. The misalignment row now states the rule exactly (under 15 % Still foggy and no long dwell, detectors.py:288–305), where the old row said "without any sign of confusion".

```latex
\subsection{Eleven Detectors}

A detector is a rule over the facts of one Lesson that produces a finding: a
kind, a page, and a severity. \Cref{tab:detectors} gives each rule in one line.
We wrote the detectors for the older professor dashboard, and the Space engine
reuses ten of the eleven; the one it skips is the only one that speaks about
individual students. Nine kinds of finding can reach the owner's screen. The
Space engine uses a share of ratings, tries, or checkpoint pairs only once
five of the page's readers have contributed to it, so a detector's own minimum
of three ratings never binds there
(\code{insights/\allowbreak space\_engine.py:38--46}).

We recorded no source for the detectors' thresholds, which date from June 2026
(commit \code{0b2aa58e}), and none for the floor of five, set in October 2026
(commit \code{01951949}). Neither was calibrated against real readers. Both
were chosen before the study, so the study did not tune them.

\begin{table}[t]
  \centering
  \small
  \caption{The eleven detectors. Thresholds are the constants in
    \code{insights/detectors.py}; \enquote{Owner's view} names what the Space engine adds (\code{insights/landing\_map.py}).}
  \label{tab:detectors}
  \begin{tabular}{@{}lp{0.44\textwidth}p{0.24\textwidth}@{}}
    \toprule
    Finding & Fires when & Owner's view \\
    \midrule
    confusion hotspot & at least 3 ratings on a page, 20\,\% or more \emph{Still foggy} & shown from 5 raters \\
    overpacked & 5 views, 30\,\% \emph{Still foggy}, dwell 1.5 times the Lesson's median, plus questions or a wide spread of dwell & shown from 5 raters \\
    confusion block & two or more neighbouring pages, each 25\,\% \emph{Still foggy} & shown from 5 raters \\
    leaky bucket & the worst page-to-page loss of readers still in the Lesson (who read the page or any later one) is 20\,\% or more & shown \\
    skipped page & 5 views, median dwell under 5 seconds & shown \\
    speed bump & readers return from the next page; long dwell, little confusion & shown from 5 people who turned back (since PR~\#181; at the pin from 2) \\
    calibration gap & 35\,\% or more of those who said \emph{Clicked} miss the linked checkpoint & shown from 5 such people \\
    quiz misalignment & pass rate under 50\,\% without any sign of confusion & shown from 5 raters \\
    healthy & confusion of 25\,\% or more, yet 75\,\% pass: readers worked through it & shown from 5 raters \\
    silent misleader & 60\,\% \emph{Clicked}, yet under 50\,\% pass, too few linked pairs & computed, not sent \\
    silent strugglers & individual students with low progress and no questions & not run \\
    \bottomrule
  \end{tabular}
\end{table}

Dwell time is ambiguous: a long stay may mean a hard page or a reader who
stepped away, a short one a page that was skipped, already known, or only a
title. The rule for an overpacked page therefore also requires confusion,
while the rule for a skipped page reads dwell alone. Because the engine does
not know a page's role, it reports a title page that readers pass quickly as
skipped.

A reader who checks in with \emph{Clicked} and then misses the checkpoint has
judged their own understanding too optimistically. Such overconfidence led
students to stop studying too early and to retain
less~\cite{dunlosky2012overconfidence}, which is why the engine reports a
calibration gap. We did not measure retention.
```

#### Section 5.3.4, the three numbers (old lines 253–261)

Only the clause "where a week is the seven days counted back from the moment the owner opens the view" was shortened to "counted back from the moment the owner opens the view". The themes paragraph that follows is unchanged, as the verification required.

```latex
Beside the findings the engine computes three numbers, one value for each of
the last eight weeks, where a week is the seven days counted back from the
moment the owner opens the view (\code{insights/figures.py}). The first is how
many members read anything. The second is the share of \emph{landing} pages
among the pages that at least five members read in that week; a page lands
when fewer than 20\,\% of its readers reached for help. The third is the
average share of right first tries per member who tried a checkpoint. A
number has a value in a week only if at least five members read, or tried, in
it.
```

#### Section 5.4, what the owner sees, with the two-screenshot Figure 5.2 (old lines 280–302)

Left: the lower screenshot (f22-door-below-floor) and the two-part caption (C5-07), because it showed only one sentence and a footer; the sentence is now quoted in the text. Left also: "The assistant says one sentence" (Luna is named), the long walk from top to bottom, "The last line tells the owner" and "The sentence says whether anyone has read yet" (talking software). New: one real finding quoted from the screen (C5-18), so that the text shows what an insight looks like. The upper screenshot is now 0.7 of the text width instead of the full width, to save space; the merge must update the figure count and figures/MANIFEST.md, since f22 is no longer used.

```latex
Only the owner reaches the view. The server answers a member with 403 and
anyone else with 404 (\code{domain/authorization.py:47--62}).

\begin{figure}[htbp]
  \centering
  \includegraphics[width=\textwidth]{f21-door-above-floor}\\[6pt]
  \includegraphics[width=\textwidth]{f22-door-below-floor}
  \caption{The owner's view, drawn by the real screen from two payloads of the study with scripted readers (\cref{sec:c5-evaluation}), with the navigation bar cropped.
    Top: arm~I, 27~members who all read in the last week. Bottom: arm~G, the
    control, with four members. The same sentence would appear for four real readers.}
  \label{fig:door}
\end{figure}

\Cref{fig:door} shows the screen above and below the floor. From top to bottom
it holds four things. The assistant says one sentence that names the Lesson to
look at, with one button that opens the page. Three numbers follow, each the value of the current week with its eight
weeks as bars. The screen leaves a week without a value empty and does not draw it as zero. Then comes the map: one cell per page, brighter where more readers
reached for help, a faint outline where fewer than five have read. A cell with a finding carries a label and opens that page, and the finding stands below as one
sentence. The last line tells the owner that the view never counts their own reading.

Below the floor the screen shows the assistant's one sentence and the closing
line, and no number and no map. The sentence says whether anyone has read
yet, not how many.
```

#### Section 5.5, privacy by design (old lines 307–377)

Left: "it limits what leaves them" (reworded); the long pseudonym history, including "the simplest and safest protection by design that we saw" and "code that one setting turns on is one mistake away from showing individuals" (kept in short form as the reason: no wrong setting can show individuals again); the bullet "The owner is not in the data" (C5-12; 5.3.1 and 5.4 say it, and the code reference moved to 5.3.1); the bullet "Names among members are opt-in" with PR #146 (C5-12; the setting now appears in the get_user_profile sentence); "The view keeps this promise within the limits below" (reworded); and "the database policies guard the tables themselves". Changed by the verification: the professor policy now says that it reaches a member's events in other Spaces, excludes only the reading view's questions, and that in production only an administrator grants the role (tab:deployed); get_user_profile now lists what it returns and that, by the policies at the pin, any owner could put a name to every member (read in the code, untested); the PRs #184 and #185 still "limit" the two paths, as the verification asked, where the review draft had said they "close" them; the padding attack names its precondition (any account can join any Space, published or not, migration 20260604000000); and the analytics fault is split into one sentence per PR, with production carrying it until November 2026. The storage facts from 5.2.2 open the section.

```latex
The General Data Protection Regulation asks for data protection by design and
by default~\cite{gdpr2016}. The system does not anonymise the stored events;
it limits what leaves them.

\begin{description}
  \item[No output about a person.] The owner's view has no list of members,
    no per-person progress, and no name. An earlier version showed individuals
    under pseudonyms (PR~\#142). Pseudonymised data
    remain personal data~\cite[Recital~26]{gdpr2016}. In November 2026 we
    therefore decided that the view shows no person at all, the simplest and
    safest protection by design that we saw. PR~\#175 removed the pseudonyms
    together with the switch that kept them off, because code that one setting
    turns on is one mistake away from showing individuals.
  \item[A minimum count per page.] The view says something about a page only
    if at least five members have read it, and uses a share only once five of
    those readers contributed to it. The rule borrows the minimum group
    size of $k$-anonymity~\cite{sweeney2002kanonymity}, but it is a threshold
    on released statistics, not a property of released records, and only the
    engine's code enforces it. \Cref{sec:c5-findings} shows where it is
    weaker than it sounds.
  \item[The owner is not in the data.] The engine removes the owner's own
    events before it counts anything (\code{sources/space.py:107--112}).
  \item[Names among members are opt-in.] Whether other members of a Space see
    a member's name is a profile setting that is off by default (PR~\#146).
  \item[Export and erasure.] A user can download their data and delete their
    account, and deletion takes the events with the account.
\end{description}

The sentence that a member sees when joining a Space and the privacy page both
promise \enquote{patterns across at least five people, never by name}
(\code{v4Spaces.json:491}, \code{legal.json:35}). The view keeps this promise
within the limits below and those of \cref{sec:c5-findings}.

\paragraph{Two paths around the view.}
The view reads the log through the backend and checks ownership in code, and
the database policies guard the tables
themselves (\cref{tab:deployed}). Two older paths bypass the view. A policy of the older dashboard
lets an account with the professor role read the event rows, with user ids,
of every member of any course it owns; no screen uses it. And a function that
every signed-in account may call, \code{get\_user\_profile}, returns the
name, picture, and institution that a user has entered for any user id,
whatever that user's visibility setting. Both held in production in November
2026. Migrations that limit the policy to the professor's own Lessons and
make the function honour the setting are prepared (PRs~\#184 and~\#185) and
not yet applied. \code{get\_user\_profile} is one of 49 functions that run
with the rights of the role that defined them, skip row-level security, and
could be called by every signed-in account in production in November 2026;
we did not audit whether each checks its caller (\cref{tab:deployed}). A
third path, the analytics routes of the older interface, let a student who
owned a Space read members' user ids and their questions word for word.
PR~\#176 limits these routes to professor accounts, with a test over eleven
routes, and PR~\#175 removed rows per member and questions in members' own
words from what they return, which holds even if a check is missing again.
Production carried the fault until both were deployed in November 2026.

\paragraph{Whom the floor protects against.}
The floor guards members against an owner who reads the view as built, not
against one who sets out to identify a member. The system allows each of
three ways around it; we tried none. \emph{Padding:} the floor counts
accounts, and in production any new account may enrol in any course and
write its own events, so four extra accounts lift a page with one real reader
above the floor. \emph{Differencing:} the engine recomputes the view over a
moving window of 56~days whenever its five-minute cache has expired, so comparing the view before and after one known
member read a page reveals that member's part. \emph{Homogeneity:} a share
of 100\,\% says that every reader reached for help, a value that a minimum
group size does not protect and that $\ell$-diversity
addresses~\cite{machanavajjhala2007ldiversity}. Differential privacy would
bound what any one person changes in a released statistic, also over
repeated releases~\cite{dwork2006dp}; the view adds no noise. The floor
therefore protects against accidental exposure in a small group, not against
an owner who wants to find out about one member.
```

#### Section 5.6.1, method (old lines 385–413)

Left: "With almost no real reading" (the opening says it), "and stay silent when it should" (talking software; now "withhold what it should"), "Because the engine is a pure function apart from the themes, the study needs no server" (5.3.1 says it), the steady reader's "20 to 60 seconds" (the appendix table keeps the values), "They went into the script in the same commit as the results, so their order rests on our word, not on a record" (C5-16 and Polish.md 1.5 comment 1: said once, plainly), and the sentence on the sweep, reworded. New: definitions of scripted reader, persona, arm, and seed (C5-16, voice rule 11).

```latex
With almost no real reading, we asked a narrower question that the code can
answer: given readers who behave in known ways, does the owner's view say what
it should, and stay silent when it should? Synthetic learner data has been
proposed for building and testing learning-analytics software without the
privacy risks of real data~\cite{berg2016synthetic}; here it also stands in
for data that did not arrive. Because the engine is a pure function apart from
the themes, the study needs no server. A script builds one Space with one
Lesson of 30~pages, writes the events of scripted readers straight into the
engine's input, and calls the function behind the owner's route
(\code{backend/eval/persona\_study.py} at \code{a342dea9}, whose engine is
identical to \code{2e146f51}). Fixed strings replace the summarising model. We
chose the personas' behaviours and values ourselves; they come from no data,
and \cref{sec:c5-personas-detail} lists them with the seeds.

Five personas behave in known ways. A \emph{steady} reader reads every page
for 20 to 60~seconds, checks in with \emph{Clicked}, and clears
checkpoints. A \emph{struggling} reader dwells three times as long on pages 8
to 12, asks there, checks in with \emph{Still foggy}, misses first tries, and
turns back from page~13. An \emph{asker} asks on every third page, a
\emph{skimmer} spends under five seconds per page and stops at page~10, and
an \emph{overconfident} reader checks in with \emph{Clicked} everywhere and misses
the checkpoint on page~10. Eight arms mix these personas. Before the first
run we wrote down 23 expectations: which findings must appear in which arm,
and which must not. They went into the script in the same commit as the
results, so their order rests on our word, not on a
record. Two further arms, added after the result to explain misses, are
marked post hoc and do not count. After the result, a sweep over 100 seeds
under a protocol committed beforehand showed which results depend on the
random draw.
```

#### Section 5.6.2, results paragraphs (old lines 446–469)

Left: "The count therefore measures mostly silence" (C5-15: replaced by the split from mute_engine.out.txt, 5 of 8 expectations to show something and 13 of 15 to withhold something, against 1 and 15 for an engine that reports nothing); the arm A clause "(Table 5.2)"; the control-arm ending "only the member count and the floor, which the screen does not show. The lower half of Figure 5.2 is that screen" (C5-07: the screen is now quoted in 5.4); the 26 unit tests written as plain sentences (tests/unit/test_landing_stories.py); and the list of what the database tests check (event schema, row-level security, erasure, the read path, the owner gate). The verification required the tests sentence to keep both counts, that the tests check the database the migrations describe and not production, and that no test exercises row-level security through an API route; all three stay. New: the one finding that no persona was built to cause, a calibration gap in four seeds of arm C and one of arm A (C5-14).

```latex
\Cref{tab:persona} gives the published run: the engine met 18 of the 23
expectations, nine of them in the control arm~G. An engine that never reports
a finding or a theme meets 16 of the 23 (\code{mute\_engine.py}). Over 100
seeds, ours met 16 to 19, with a median of 17 (\cref{tab:sweep}). The count
therefore measures mostly silence, and the published run was a good draw.

In arms A, E, and F the planted findings held at every seed. Struggling readers produced a
finding on page~10 and a speed bump on page~12 (arm~A), skimmers a leak and
skipped pages (arm~E), and overconfident readers a calibration gap (arm~F). On
page~10 that finding was the hotspot in 19 seeds and the more specific
overpacked page in the other 81; the overpacked page pre-empts the hotspot
when the page's reading time also runs long (\cref{tab:detectors}). In the
control arm, with four members, the payload held no finding, no theme, and no
reading figure at any seed, only the member count and the floor, which the
screen does not show. The lower half of \cref{fig:door} is that screen.

Tests without readers fix the same rules at the same revision: 141 unit tests
of the engine, 26 of them written as plain sentences
(\code{tests/unit/test\_landing\_stories.py}), and 62 database tests. The
database tests replay every migration into an empty Postgres and check the
event schema, row-level security, erasure, the read path, and the owner gate.
They test the database that the migrations describe, not production
(\cref{sec:c5-events-storage}), and no test exercises row-level security
through an API route.
```

#### Section 5.6.3, the misses (old lines 479–504)

Left: the heading "The numbers speak about this week" (talking software; now "The numbers cover the current week"); "said Still foggy" (people check in); "at least five of whom rated it" (all thirteen checked in, NOTES.md: 13 raters, 3 confused); "The view names nobody and sends no count of three" (talking software); "(since PR #181)" and "We froze the code at the pin, so we report this as a limit and name the stricter rule ... as the change to make" (C5-11: the opening carries the revision; the verified plainer wording is "We did not change the engine after the study"); and the one-sentence reason in the themes paragraph, which now adds that the askers checked in with Unsure, which the hotspot rule does not count (NOTES.md).

```latex
\paragraph{The numbers speak about this week.}
In arms A and H all three numbers were empty although 12 and 27 members had
read. The view shows the current week, and the scripted readers read on
single days spread over eight weeks, so in neither arm did the current week
reach five readers. Arm~I places the same 27 readers in one week, and the
numbers appear. A Space with fewer than five readers per week shows no
numbers even when the map is full.

\paragraph{The floor counts readers, not the people a finding is about.}
In arm~B three of thirteen members said \emph{Still foggy} on page~10, and the
view reported a hotspot at every seed, because these check-ins are not random.
The page had thirteen readers, at least five of whom rated it, so it was above
the floor, and three of thirteen are 23\,\%, above the hotspot rule of
20\,\%. The view names nobody and sends no count of three, so the promise
holds by its letter. It does not hold in the stronger sense that five people
stand behind a pattern: an owner who knows the group may guess who the three
are. With one struggler fewer, two of twelve are 17\,\% and the hotspot
vanishes, so one person can switch a finding on or off. Only the speed bump
counts the people a finding is about (since PR~\#181). We froze the code at
the pin, so we report this as a limit and name the stricter rule, five people
behind each finding, as the change to make.

\paragraph{Themes explain a hotspot and nothing else.}
In arm~C five members asked about the same pages and no themes appeared,
because the engine makes themes only for hotspot pages. Five people who ask
about a page that is not a hotspot reach no one.
```

#### Section 5.6.4, limits (old lines 508–521)

Left: the two separate sentences on personas that sit far from the thresholds ("a skimmer always stays under the rule of five seconds, and a struggling reader is always confused on the hard pages"), merged into one (C5-20), and "the study says nothing about what real themes might reveal" (talking software; now "shows nothing").

```latex
The study tests whether the aggregation separates known behaviours and
whether the floor holds. It verifies that the engine implements the rules of
\cref{tab:detectors}; it does not validate that the rules describe real
reading, Boehm's distinction between building the product right and building
the right product~\cite{boehm1984verifying}. Most personas sit far from the
thresholds: a skimmer always stays under the rule of five seconds, and a
struggling reader is always confused on the hard pages. In arm~A, however,
the reading time of page~10 sits near the line between the hotspot and the
overpacked page, and the random draw decides between them. There is one
Lesson and one Space. Fixed strings replaced the model that writes
themes, so the study says nothing about what real themes might reveal. We
wrote both the engine and the study, so expectations and code can share a
misreading. And we did not observe whether an owner changes a page after
seeing a finding, the step that closes the loop.
```

#### Section 5.7, answer to RQ2 (old lines 526–564)

The answer was halved (C5-10), because it restated 5.5, 5.6.3 and Chapter 7. Left: "One governed event log"; "rows that members insert directly still meet the database's type constraint"; "and a word replaces the size of the group"; "It therefore shows no individual learner: no name, no list, and no count of one to four people"; "two can carry a confusion block or a calibration gap; five people behind each finding would close this gap"; "The floor protects against accidental exposure, not against an owner who pads the Space with accounts or compares views over time" (the answer keeps padding and differencing in one clause); "In the mixed arm of 27 only the hotspot and the calibration gap rose ... such as five skimmers among 27"; "Whether real owners read the view that way, we did not observe" (voice rule 8; the new last sentence puts the subject first); "It says nothing about a group under five" (talking software); and the paragraph "Decide and return" (5.1 says it). The verification required the answer to keep the quiet-week numbers and the themes only on hotspots; both stay.

```latex
\paragraph{Model.} One governed event log with seventeen types models
learner interaction. The reading view writes it through one function that
checks every event and never fails a reader's request, and rows that members
insert directly still meet the database's type constraint.

\paragraph{Aggregate.} A pure function over the last 56~days turns a Space's
events into facts per page, from three kinds of signal: what readers do, what
they say, and what they get right. A floor of five readers decides what may be
said. Below it a value is \code{null}, not zero, and a word replaces the size
of the group.

\paragraph{Feed back.} The owner's view limits the output, not the storage. It
makes no statement about a person and none about a page that fewer than five
people have read, and the owner is absent from their own numbers. It therefore
shows no individual learner: no name, no list, and no count of one to four
people. Against the stricter standard of \cref{sec:analytics-privacy} it falls
short for the findings that are shares of a page's raters. One confused rater
among five can carry a hotspot, and two can carry a confusion block or a
calibration gap; five people behind each finding would close this gap
(\cref{sec:c5-findings}). The floor protects against accidental exposure, not
against an owner who pads the Space with accounts or compares views over time.
Two older paths around the view stay open until the prepared fixes are applied
(\cref{sec:c5-privacy}).

\paragraph{What the view can tell.} Without showing any individual learner,
the view tells an owner which page confuses readers, where readers leave,
which pages they skip, where they turn back, and where they feel sure and
are wrong. In the study with scripted readers it reported each of these
behaviours at every one of 100 seeds when the behaviour had an arm of its
own, and stayed silent below the floor. In the mixed arm of 27 only the
hotspot and the calibration gap rose, so a behaviour that few of a page's
readers share, such as five skimmers among 27, stays below the rules. Whether
real owners read the view that way, we did not observe. It says nothing about a group under five,
shows no weekly numbers in a quiet week, and reports themes only where a page
is already a hotspot.

\paragraph{Decide and return.} This step belongs to the owner. A changed page
returns to learners only as a new upload, and a member cannot yet send a
question to the owner.
```
