# Retrieval re-run at the pin: results

Run on 2026-11-10 (14:28 and 14:36 UTC) from a clean checkout of `dfc20df6`.
Protocol and expectations: `PROTOCOL.md`, committed before the run in
`d09c05ea`. Raw output: `offtopic_gate.json`, `grid/`. Both runs finished on
the first attempt with zero errors; no question was changed afterwards.
(One earlier start of the gate script stopped before any embedding or
retrieval call, because the settings object requires `SUPABASE_KEY`; the
anon key was supplied and nothing else changed.)

## The gate (production setting: course-scoped hybrid, k = 6, threshold 0.65)

| Group | n | Answered | Refused | Best similarity: min | median | max |
|---|---|---|---|---|---|---|
| Answerable (golden, in the course) | 27 | 27 | 0 | 0.658 | 0.750 | 0.820 |
| A: far off-topic | 10 | 0 | 10 | 0.428 | 0.445 | 0.489 |
| B: computer science, not databases | 10 | 0 | 10 | 0.487 | 0.549 | 0.596 |
| C: database topic absent from the course | 10 | 0 | 10 | 0.553 | 0.607 | 0.634 |

"Best similarity" is the highest dense similarity of any page in the course,
with no cut-off. It is a separate probe and not part of the gate.

## Expectations

| # | Expectation | Result | Verdict |
|---|---|---|---|
| E1 | at most 1 of 27 answerable refused | 0 of 27 refused | met |
| E2 | tier A: at least 9 of 10 refused | 10 of 10 | met |
| E3 | tier B: at least 8 of 10 refused | 10 of 10 | met |
| E4 | tier C, exploratory; predicted that a noticeable share is answered | 0 of 10 answered | prediction wrong |
| E5 | grid accepted; course_hybrid finds the page at least as often as lecture_dense on the paired 27 (k = 5, 8; threshold 0.65) | verdict ACCEPTED; 25 and 26 of 27 against 17 and 17 | met in the registered run; **not met at k = 5 once the harness is corrected** (25 against 26; equal at k = 8, 26 and 26), see the note on lecture_dense |

## What the numbers say

- The gate refused every one of the 30 questions without an answer and none
  of the 27 with one.
- The groups are ordered as one would expect (A < B < C < answerable), and
  they do not overlap. The gap is narrow: the highest unanswerable question
  reaches 0.6336 (off-C05, B+-tree) and the lowest answerable one 0.6585
  (4e69f0bb-s48). The threshold of 0.65 sits inside a gap of 0.025.
- Four answerable questions lie below 0.70. A threshold of 0.75 would have
  refused 13 of the 27 answerable questions (grid, course_hybrid, 0.75).
- For no off-topic question did the full-text search return a hit either
  (`hits` = 0 in every row).
- Grid, course_hybrid, threshold 0.65, 27 questions: the expected page is
  among the hits for 24 (k = 3), 25 (k = 5), 26 (k = 8) and 27 (k = 10);
  MRR 0.85 to 0.87. Production uses k = 6, which the grid does not contain.

## Note on lecture_dense (not an expectation, found in the run)

The lecture-scoped regime returned nothing for all nine questions of lecture
`54357028` (Integrity Constraints), at every threshold including 0.0, while
the course-scoped regime found pages of that lecture with similarities up to
0.80. The harness calls `retrieve_relevant_slides` with the lecture id only.
`match_slides_by_lecture` (migration `20260719020001`) matches
`slide_embeddings.lecture_id` or `pdf_hash`; the course-scoped function joins
on the file hash since migration `20261014000000`. Checked afterwards on 2026-11-10 (read-only):

- The 44 vectors of this lecture are stored under its file hash and carry
  another lecture id ([Inferred] the same file, embedded once under an earlier upload); none carries
  the id `54357028`. The other five golden lectures have all their vectors
  under their own id.
- Production does not call the search the way the harness does. The only
  caller is the chat route of the older lecture room
  (`backend/api/v1/ai_content.py:201` -> `chat_service.process_chat_request`
  -> `tutor.chat_with_lecture`). The chat service reads `pdf_hash` from the
  lecture row and passes both id and hash
  (`backend/services/ai/chat_service.py:38-51, 90-97`), and
  `match_slides_by_lecture` matches either.
- Calling the function for this lecture with the id alone returns 0 rows;
  with id and hash, as production does, it returns 5.
- The v4 app does not use the lecture-scoped search at all; its ask bar goes
  through the course-scoped search measured above.

So the gap is in the harness, not in production: at the pinned revision
`retrieval_grid.py` passes no `pdf_hash` in the lecture_dense regime.

Consequence for the registered run: its lecture_dense numbers (for example
38 of 50 at k = 5, threshold 0.0) are depressed by this one lecture and are
not used as a comparison in the thesis.

### Harness corrected and lecture_dense repeated (after the pin)

The harness now reads `lectures.pdf_hash` for every golden
lecture before a lecture_dense sweep and passes id and hash, as the chat
service does; a failed lookup stops the run (`resolve_pdf_hashes` in
`backend/eval/retrieval_grid.py`, four new unit tests). This is an eval-only
change after the pin; production code is untouched.

The lecture_dense regime was run again the same day with the same golden
set and grid (`grid-harness-fix/`, verdict ACCEPTED, 50 embedding calls,
read-only, 6 of 6 lectures searched by id and file hash). This run is **not
at the pin** and was not pre-registered; it only shows what the correction
changes.

| k | threshold | page found, all 50: before -> after | paired 27: before -> after | course_hybrid, paired 27 (registered run) |
|---|---|---|---|---|
| 3 | 0.65 | 34 -> 43 | 15 -> 24 | 24 |
| 5 | 0.65 | 37 -> 46 | 17 -> 26 | 25 |
| 8 | 0.65 | 37 -> 46 | 17 -> 26 | 26 |
| 10 | 0.65 | 38 -> 47 | 18 -> 27 | 27 |

- All nine questions of lecture `54357028` are now found (k = 5, threshold
  0.65). Every cell gains exactly nine.
- At threshold 0.65 the gate refuses 1 of 50 questions (`37fbaf56-s42`)
  where it refused 10 before.
- E5 has to be read again. With the corrected harness the search inside one
  Lesson finds the page as often as the Space-wide search at k = 3, 8 and
  10, and once more at k = 5 (26 against 25). The registered expectation
  "at least as often at k = 5 and 8" therefore holds at k = 8 and fails by
  one question at k = 5. The two regimes search different spaces: one
  Lesson against the whole Space of 201 pages.
- The thesis text does not compare the two regimes, so nothing in it
  changes. The gate result (E1 to E4) is unaffected; it never used
  lecture_dense.

## Limits

As registered: passing the gate says nothing about the text the model then
writes; keyword absence is not proof of topical absence; one course of 201
pages; 57 English questions written by the developer with AI assistance; ten
questions per tier. In addition, the margin of 0.025 was observed on this
sample and is not an estimate of how the threshold behaves on other material.

## Per question

### Answerable

| Id | Question | Best similarity | Gate |
|---|---|---|---|
| 4e69f0bb-s6 | How is the basic SELECT-FROM-WHERE form expressed in the grammar used for parsing? | 0.820 | answered |
| 54357028-s16 | Besides rejecting or cascading, what third response to a foreign-key violation is available? | 0.801 | answered |
| 58d20720-s8 | When a SQL query is translated into the algebra, what does each operator consume and return? | 0.797 | answered |
| 58d20720-s72 | Why is a union cheaper to compute when duplicate tuples are permitted? | 0.780 | answered |
| 54357028-s20 | How can constraint checking be postponed until the end of a transaction, and what is the default? | 0.777 | answered |
| 4e69f0bb-s18 | What has to stay unchanged when a query plan is rewritten for efficiency? | 0.772 | answered |
| 4e69f0bb-s12 | In the direct translation of a query, which algebra operator does each SQL clause become? | 0.769 | answered |
| 58d20720-s40 | Which operator returns exactly those tuples of the left relation that find no match on the right? | 0.767 | answered |
| 54357028-s12 | Can you show a table definition declaring both a composite primary key and a foreign key? | 0.767 | answered |
| 58d20720-s56 | Which union variant applies when the two relations do not share a schema? | 0.763 | answered |
| 58d20720-s64 | How is a query combining a length condition and a studio condition written as one algebra expression? | 0.762 | answered |
| 54357028-s4 | What makes a set of attributes usable as a key? | 0.760 | answered |
| 54357028-s8 | Which statements can violate a key constraint, and which cannot? | 0.758 | answered |
| 4e69f0bb-s24 | Which selection rewriting rule stops being valid once duplicates are allowed? | 0.750 | answered |
| 4e69f0bb-s30 | Which rewriting turns a cross product followed by a filter into a single operator? | 0.743 | answered |
| 58d20720-s16 | Which operator keeps a relation's schema unchanged but returns only some of its tuples? | 0.742 | answered |
| 4e69f0bb-s54 | Which quantity estimates how many tuples survive an operator relative to its input? | 0.728 | answered |
| 4e69f0bb-s42 | What does proving NP-hardness establish about a problem? | 0.721 | answered |
| 4e69f0bb-s36 | How can you inspect the plan a database chose for a query? | 0.715 | answered |
| 58d20720-s24 | Can you show a worked example of subtracting one relation from another? | 0.712 | answered |
| 58d20720-s32 | Which join variant pairs tuples using an arbitrary boolean predicate instead of equality? | 0.710 | answered |
| 54357028-s32 | What is the trade-off between a database-wide boolean condition and an event-driven action? | 0.705 | answered |
| 58d20720-s48 | Which aggregate function yields the alphabetically first film title? | 0.700 | answered |
| 54357028-s36 | How do attribute-based and tuple-based checks differ in when they are evaluated? | 0.687 | answered |
| 54357028-s28 | Why should a constraint be given an explicit name when it is created? | 0.669 | answered |
| 54357028-s24 | Which clause expresses an arbitrary condition on a single column's values? | 0.662 | answered |
| 4e69f0bb-s48 | In what units can the optimiser express its cost estimates? | 0.658 | answered |

### Tier A

| Id | Question | Best similarity | Gate |
|---|---|---|---|
| off-A08 | How does photosynthesis work? | 0.489 | refused |
| off-A05 | How many players are on a football team? | 0.473 | refused |
| off-A06 | What is the boiling point of water at sea level? | 0.450 | refused |
| off-A02 | How long should I boil an egg? | 0.449 | refused |
| off-A10 | When did the Berlin Wall fall? | 0.447 | refused |
| off-A04 | What causes the seasons on Earth? | 0.443 | refused |
| off-A07 | Who wrote Faust? | 0.437 | refused |
| off-A01 | What is the capital of Australia? | 0.435 | refused |
| off-A09 | What is the tallest mountain in Europe? | 0.432 | refused |
| off-A03 | Who painted the Mona Lisa? | 0.428 | refused |

### Tier B

| Id | Question | Best similarity | Gate |
|---|---|---|---|
| off-B06 | What is a context-free grammar? | 0.596 | refused |
| off-B08 | What does the halting problem say? | 0.588 | refused |
| off-B07 | How does virtual memory use page tables? | 0.567 | refused |
| off-B03 | What is the worst-case time complexity of quicksort? | 0.565 | refused |
| off-B10 | What is the difference between a compiler and an interpreter? | 0.562 | refused |
| off-B09 | How does Dijkstra's algorithm find a shortest path? | 0.535 | refused |
| off-B05 | What is the difference between a process and a thread? | 0.510 | refused |
| off-B04 | How does public-key encryption work? | 0.507 | refused |
| off-B01 | How does the TCP three-way handshake work? | 0.497 | refused |
| off-B02 | What is backpropagation in a neural network? | 0.487 | refused |

### Tier C

| Id | Question | Best similarity | Gate |
|---|---|---|---|
| off-C05 | How is a key inserted into a B+-tree? | 0.634 | refused |
| off-C03 | How does two-phase locking work? | 0.625 | refused |
| off-C04 | How can a database system detect a deadlock? | 0.621 | refused |
| off-C01 | What does atomicity mean in the ACID properties? | 0.613 | refused |
| off-C02 | When is a schedule conflict-serialisable? | 0.611 | refused |
| off-C06 | What is Boyce-Codd normal form? | 0.603 | refused |
| off-C08 | How does write-ahead logging support recovery after a crash? | 0.575 | refused |
| off-C09 | What is a phantom read and which isolation level prevents it? | 0.573 | refused |
| off-C10 | What is a star schema in a data warehouse? | 0.556 | refused |
| off-C07 | What does the CAP theorem state? | 0.553 | refused |
