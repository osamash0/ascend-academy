# Persona study: what the run of 2026-11-09 shows

*Companion to `RESULTS.md` (machine-written by `backend/eval/persona_study.py`). The script, its personas, arms and pre-registered expectations are in that file; this note is the reading. The script ran at `a342dea9`, which this branch never contained; it is archived here as `persona_study.py`, byte-identical. `seed-sweep/PROTOCOL.md` gives a way to run it in isolation, with no `.env`, no database, and no network, in a few seconds. Its docstring says the personas write eight event types; they write five (`slide_view`, `confidence_rating`, `ai_tutor_query`, `slide_back_navigation`, `checkpoint_attempt`).*

*Corrected 15 November 2026: three statements below were wrong and are marked.*

## What it is, and is not

Five scripted personas (steady, struggling, frequent asker, skimmer, overconfident) write the reader's own event types into one Space with one 30-page Lesson. The real engine (`landing_from`, the function behind `GET /v4/spaces/{id}/landing`) turns them into the owner's payload. The themes model is stood in for, as in the story tests. This tests whether the aggregation separates the arms and whether the five-person floor holds. It says nothing about students.

## Pre-registered expectations: 18 of 23 met; the five misses are design facts, not bugs

| Miss | What the engine did | Why, in the code | What it means for chapter 5 |
|---|---|---|---|
| A and H: figures expected non-null, were null | `reading`, `landing`, `cleared` all `null` for 12 and 27 members | Figures are weekly (`figures.py`, eight buckets); a week shows a value only when five people read *in that week*. The personas read on one day each, spread over 55 days, so no week reached five. Arm H had 3/3/2 weeks with a value, its last week none. | The owner's figures answer "this week", not "ever". With a handful of readers per week they stay blank even in a busy Space. State it; arm I (same 27 people, all in the last seven days) shows 27 / 63 % / 79 %. |
| B: a hotspot found with only three strugglers | `confusion_hotspot` on page 10, 13 raters, 3 confused (23 %) | The floor is five *readers of the page* (`space_engine.lesson_insights` → `above_floor`), and the hotspot fires at 20 % confused among at least three raters (`detectors._CONFUSION_FLOOR`, `_MIN_RATINGS`). Nothing requires the confused people themselves to be five. | A finding can describe three people's state among thirteen. The payload never names them and the page has thirteen readers, so the letter of "patterns across at least five people" holds. Whether the spirit does is an open question: should the pattern's *subjects* also be floored? |
| B: a finding named pages 8–12 | same hotspot | same | same |
| C: five askers, no themes | no `confusion_hotspot`, so no themes | Themes are made only for hotspot pages (`v4_landing_service._themes` walks the ranked hotspots), and the askers said "unsure", which is not "confused" for the hotspot rule. Arm J (askers who are also confused on page 10) got themes with five askers. | Themes are a hotspot's explanation, not a free-standing channel. Five people asking about a page that is not a hotspot are heard by no one. Say so in the outlook (Plan 4, questions). |

Everything else behaved as written: the control arm of four members showed reach `few`, no findings, no themes, null figures; four askers got no themes (*corrected: an earlier version said here that three strugglers among thirteen did not light the Lesson; they did, through the hotspot of arm B*); the skimmers produced a leak after page 10 and ten skipped pages; six overconfident readers produced a calibration gap on page 10 and nothing else; the strugglers produced a hotspot on page 10 and a speed bump on page 12 (two turn-backs each from page 13); the realistic mix surfaced the hotspot and the calibration gap and nothing noisy.

## Limits of the study

- Personas are clean, so the arms separate more sharply than real readers would. (*Corrected: an earlier version said the thresholds were tuned for real ratios; they have no recorded source, as chapter 5 says.*) Noise was added to dwell and to correctness, not to behaviour.
- One Lesson, one Space, one seed per arm (20261109 + arm index). (*Corrected: an earlier version said a different seed moves which pages are skipped, not which kinds fire. The seed sweep of 15 November, `seed-sweep/`, shows otherwise for arm A: over 100 seeds page 10 carried the hotspot in 19 and the more specific overpacked finding in 81.*)
- Themes are canned strings; a real model call would cost a few cents and is not needed for the machinery question.
- Nothing was inserted into a database; the SQL read path (`load_space_data`) is covered by `backend/tests/db/test_landing_space_source.py`, not by this run.

## For the thesis

Chapter 5's evaluation reports the table in `RESULTS.md` as is, with the five misses and their reasons, and draws the owner's door from `I-everyone-this-week.json` (above the floor) and `G-control-four-members.json` (below) through the landing lab's fixture seam.
