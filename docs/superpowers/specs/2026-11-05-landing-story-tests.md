# How it's landing: story tests

*2026-11-05. The yardstick for Plan 3's engine fixes. Each story is a plain situation and the answer the owner's view must give. The executable versions are in `backend/tests/unit/test_landing_stories.py`, one test per story.*

## Why stories

The engine (`backend/services/insights/`, `backend/services/v4_landing_service.py`) re-homes detectors written for the older professor analytics. Its bugs come from assumptions carried over from there: rows only for pages someone read, tries counted instead of people, counts used where sets were needed. You cannot see them by reading one function. You can see them by asking what happens in a given situation. These stories pin what the view promises. They show which promises fail today, and each Plan 3 fix is checked against them.

## How they run

- **Level.** Stories run at the highest pure level: `landing_from(SpaceData, lang)`, the function that turns a Space's activity into the `Landing` payload. There is no HTTP and no database. Only the theme model call and its cache are stood in for.
- **Two exceptions.** One story goes to the source, `load_space_data` with a fake connection, because that is where the owner's reading is excluded. One goes to `rank`, where a severity tie between kinds is easier to state.
- **Failing stories.** A story that fails today is a strict `xfail` that names its Plan 3 task. When the fix lands, the story passes. Strict xfail then turns the run red until the marker comes off, so no fix can land without its story.
- **Checked against the fixes.** On 2026-11-05, Tasks 3, 4 (askers with text), 4b, 4d and 4e were applied as an out-of-tree monkeypatch, taken from the plan's own code. Under them, the nine stories those tasks cover pass, and all eleven stories that pass today still pass.

Run: `.venv/bin/python -m pytest backend/tests/unit/test_landing_stories.py -q -p no:cacheprovider` (today: 11 passed, 13 xfailed).

## The rules the stories protect

- **R1 Floor.** Nothing is said about a page, a Lesson or a week until 5 different people have read it (`MIN_READERS`). A figure with too little behind it is null, never 0.
- **R2 Owner.** The owner's own reading never changes anything.
- **R3 No one identifiable.** Passive AI questions appear only as themes, never word for word and never with a name.
- **R4 People.** Count people, not tries or events.
- **R5 Drop-off.** A Lesson people abandon is a finding, never "calm". A page people skip and then read past is not a drop-off.
- **R6 Traps first.** Within a band, a page people said had clicked and then missed (`calibration_gap` / `silent_misleader`) leads the ranking. Bands still lead. `quiz_misalignment` is not a trap.
- **R7 One member.** One member's activity never changes what is said about pages they did not touch.

## Floors and privacy

**1. Four people reading closely get Luna's floor line, and nothing else.**
- **Situation:** 4 people read all of Normalization. All 4 are foggy on page 3, and all 4 ask about it.
- **The view must show:** Luna's floor line only. There is no map: every Lesson is `few`, with no help values. There are no findings and no themes, and the model is never called. The landing and cleared figures are null.
- **Rule:** R1.
- **Test:** `test_four_people_reading_closely_get_lunas_floor_line_and_nothing_else`.
- **Status:** PASSES.

**2. A Lesson three people read says nothing, while its neighbour speaks.**
- **Situation:** 10 people read Normalization, with a hotspot on page 3. 3 people read Joins, and all 3 are foggy on page 1.
- **The view must show:** Normalization is drawn with its finding. Joins is `few`, with no help values and no findings.
- **Rule:** R1.
- **Test:** `test_a_lesson_three_people_read_says_nothing_while_its_neighbour_speaks`.
- **Status:** PASSES.

**3. … and does not say how many read it.**
- **Situation:** As in story 2.
- **The view must show:** Nothing about Joins says "3 people". In a small group, a count is who.
- **Rule:** R1, R3.
- **Test:** `test_a_lesson_three_people_read_does_not_say_how_many_read_it`.
- **Status:** **FAILS.** `lessons[].readers` is still on the wire. Fixed by **Plan 3 Task 14**, which waits for the UI session.

**4. A page four people reached says nothing, even if all four were foggy.**
- **Situation:** 10 people read pages 1 to 4. 4 of them go on to page 5, and all 4 are confused and ask about it.
- **The view must show:** No finding names page 5. There are no themes, and the model is never called.
- **Rule:** R1.
- **Test:** `test_a_page_four_people_reached_says_nothing_even_if_all_four_were_foggy`.
- **Status:** PASSES.

**5. One member opening page 1 does not make pages read by four people look like landing.**
- **Situation:** 4 people read all of Normalization, and all 4 are foggy on page 3. A fifth person opens only page 1, which lifts the Lesson over its floor, so it is drawn.
- **The view must show:** Page 1 is landing (5 read it and nobody needed it). Pages 2 to 4 say nothing: their help value is null, not dark.
- **Rule:** R1, R7.
- **Test:** `test_one_member_opening_page_one_does_not_make_pages_four_people_read_look_like_landing`.
- **Status:** **FAILS.** `help_share()` returns `0.0` under the page floor, the same value as a page that is landing. The map draws those pages dark, and spec §8 says a dark cell means landing. **Not in Plan 3.**

**6. The owner's own reading is never read.**
- **Situation:** The owner is enrolled in their own Space (their rows say so) and reads every page.
- **The view must show:** The owner is not among the members, and the events read covers members only.
- **Rule:** R2.
- **Test:** `test_the_owners_own_reading_is_never_read`, run at `load_space_data`.
- **Status:** PASSES.

**7. Nothing the owner is sent names a member or quotes a question.**
- **Situation:** 7 people ask about a hotspot. The model echoes one question word for word next to a real theme.
- **The view must show:** The real theme only. No question text and no member id appear anywhere in the payload.
- **Rule:** R3.
- **Test:** `test_nothing_the_owner_is_sent_names_a_member_or_quotes_a_question`.
- **Status:** PASSES.

**8. "It read easily" is never said when nobody said how the page read.**
- **Situation:** 6 people read page 3, and 5 of them miss its question. Nobody checked in on the page.
- **The view must show:** No "read easily, yet only N% passed" finding.
- **Rule:** R1.
- **Test:** `test_read_easily_is_never_said_when_no_one_said_how_the_page_read`.
- **Status:** **FAILS.** `quiz_misalignment` treats confusion as 0 when there are no ratings. Fixed by **Plan 3 Task 3**.

## Counting people

**9. One member answering ten questions does not outweigh four who missed one.**
- **Situation:** 5 people said page 3 left them unsure. One member gets ten questions right; four others each miss their one.
- **The view must show:** A "question tests something else" finding on page 3 at **20%**. That is one person in five who passed, not 10 of 14 tries.
- **Rule:** R4.
- **Test:** `test_one_member_answering_ten_questions_does_not_outweigh_four_who_missed_one`.
- **Status:** **FAILS.** The share is taken over tries (71%), so no finding appears. Fixed by **Plan 3 Task 3**.

**10. Cleared counts each person once.**
- **Situation:** One member clears ten checkpoint questions. Four others each miss their one.
- **The view must show:** Cleared is **20%**.
- **Rule:** R4.
- **Test:** `test_cleared_counts_each_person_once_however_many_questions_they_answered`.
- **Status:** **FAILS.** Today the figure says 71. Fixed by **Plan 3 Task 3**.

**11. One person turning back twelve times is no speed bump; three people are.**
- **Situation:** Page 2 holds people twice as long as the rest. In the first case, one reader turns back to it from page 3 twelve times. In the second, three readers turn back once each.
- **The view must show:** In the first case, nothing. In the second, a speed bump on page 2 with 3 people.
- **Rule:** R4, R7.
- **Test:** `test_one_person_turning_back_twelve_times_is_no_speed_bump_three_people_are`.
- **Status:** PASSES.

## Drop-off and skipping

**12. Six readers who all stop after page 3 of 30 are a drop-off.**
- **Situation:** 6 people read pages 1 to 3 of a 30-page Lesson. Nobody reads on.
- **The view must show:** A drop-off finding after page 3. The Lesson is not "calm".
- **Rule:** R5.
- **Test:** `test_six_readers_who_all_stop_after_page_three_of_thirty_are_a_drop_off`.
- **Status:** **FAILS.** There are rows only for pages someone read, so a fall to zero readers is never compared, and the Lesson reads "calm". Fixed by **Plan 3 Task 4d**.

**13. A skipped page does not hide a real drop-off later.**
- **Situation:** Readers per page are 10, 10, 10, 10, 3, 9, 9, 9, 6.
- **The view must show:** One drop-off finding, after page 8 (33%). Page 5 was skipped, not left.
- **Rule:** R5.
- **Test:** `test_a_skipped_page_does_not_hide_a_real_drop_off_later`.
- **Status:** **FAILS.** The detector keeps only the worst drop (into page 5), `kept()` throws it away, and the real drop after page 8 is never looked at. Fixed by **Plan 3 Task 4d**.

**14. A page most people skip and then read past is not a drop-off.**
- **Situation:** Readers per page are 10, 10, 10, 2, 10.
- **The view must show:** No drop-off finding.
- **Rule:** R5.
- **Test:** `test_a_page_most_people_skip_and_then_read_on_is_not_a_drop_off`.
- **Status:** PASSES. It must keep passing after Task 4d.

**15. One member jumping to the last page does not hide that everyone else stopped.**
- **Situation:** 7 people read pages 1 to 3 of 30. Six stop there; one jumps to page 30.
- **The view must show:** A drop-off finding after page 3.
- **Rule:** R5, R7.
- **Test:** `test_one_member_jumping_to_the_last_page_does_not_hide_that_everyone_else_stopped`.
- **Status:** **FAILS.** There are no rows for pages 4 to 29, and the one reader on page 30 makes `_drop_persists()` throw the drop away. Fixed by **Plan 3 Task 4d**.

## Ranking

**16. A trap leads its band, even against a louder hotspot on more readers.**
- **Situation:** In Transactions, 6 people said page 2 clicked and then all missed its checkpoint. In Normalization, 10 people knew they were stuck on page 3 and asked. Both findings are `act`.
- **The view must show:** The door opens on Transactions page 2: it is `insights[0]`, Luna's line, and **Open page 2**.
- **Rule:** R6.
- **Test:** `test_a_trap_leads_its_band_even_against_a_louder_hotspot_on_more_readers`.
- **Status:** **FAILS.** Ranking goes by severity × readers, so the hotspot leads. Fixed by **Plan 3 Task 4b**.

**17. A trap never jumps a band.**
- **Situation:** 5 people said Transactions page 2 clicked, and 3 missed it (`watch`). Normalization page 3 is `act`.
- **The view must show:** The door opens on Normalization page 3.
- **Rule:** R6.
- **Test:** `test_a_trap_never_jumps_a_band`.
- **Status:** PASSES.

**18. A question that tests something else is not a trap.**
- **Situation:** In one band, a hotspot sits beside a page that read easily but whose question few passed.
- **The view must show:** The hotspot first.
- **Rule:** R6.
- **Test:** `test_a_question_that_tests_something_else_is_not_a_trap`, run at `rank`.
- **Status:** PASSES.

## Figures

**19. A week fewer than five people read is a dash, not a count.**
- **Situation:** In the first case, 3 people read in each of the last two weeks. In the second, 8 read last week and 2 this week.
- **The view must show:** In the first case, the reading figure is a dash with no bars. In the second, this week is a dash and last week shows 8.
- **Rule:** R1.
- **Test:** `test_a_week_fewer_than_five_people_read_is_a_dash_not_a_count`.
- **Status:** **FAILS.** Reading is a raw weekly count at any size (3, then 2). Fixed by **Plan 3 Task 4e**.

**20. A week in which no page reached five readers has no landing figure.**
- **Situation:** 6 members each read in a different week. The Space is past its floor, but no page ever had five readers in one week.
- **The view must show:** Landing is a dash every week, never 0%.
- **Rule:** R1.
- **Test:** `test_a_week_in_which_no_page_reached_five_readers_has_no_landing_figure`.
- **Status:** PASSES.

## Themes

**21. Themes need five people who read the page and asked.**
- **Situation:** On a hotspot, 4 readers ask. A fifth person who never opened the page asks too.
- **The view must show:** No themes, and the model is never called.
- **Rule:** R1, R3.
- **Test:** `test_themes_need_five_people_who_read_the_page_and_asked`.
- **Status:** PASSES.

**22. An Ask opened and left empty is not a voice in the themes.**
- **Situation:** 4 readers ask in words. A fifth opens Ask and writes nothing.
- **The view must show:** No themes, and the model is never called. Four people's words are under the floor.
- **Rule:** R1, R3.
- **Test:** `test_an_ask_opened_and_left_empty_is_not_a_voice_in_the_themes`.
- **Status:** **FAILS.** Askers are counted from Asks opened, not from people who wrote. Fixed by **Plan 3 Task 4**.

**23. A name planted in a short theme never reaches the owner.**
- **Situation:** 7 people ask on a hotspot, and one signs "Anna here". The model answers "Anna's joins".
- **The view must show:** No theme carries the name.
- **Rule:** R3.
- **Test:** `test_a_name_planted_in_a_short_theme_never_reaches_the_owner`.
- **Status:** **FAILS.** A theme of fewer than four words is never checked against the questions. Fixed by **Plan 3 Task 4f.2**.

**24. When the askers change, the owner is not shown themes from the old ones.**
- **Situation:** Five people asked and got themes. One has aged out of the window, and someone new asked. There are still five askers.
- **The view must show:** Themes made afresh from the new five.
- **Rule:** R3.
- **Test:** `test_when_the_askers_change_the_owner_is_not_shown_themes_from_the_old_ones`.
- **Status:** **FAILS.** The cache key holds the number of askers, not who they are. Fixed by **Plan 3 Task 4f.1**.

## DB-level and write-path stories, not drafted here

These need a real database or the reader's write path. They belong in `backend/tests/db/` (throwaway Postgres only) or in the reading-service tests:

- **One member cannot crowd everyone else out of the read.**
  - **Situation:** One member writes 200 000 events, and every other member's older events fall out of the read.
  - **The view must show:** The same door as before.
  - **Fix:** Plan 3 Task 4c, a per-member cap in `_EVENTS_SQL`. A fake-connection unit test can check that the SQL carries the cap; the story itself is DB-level.
- **A member cannot move their events in time.**
  - **Situation:** A member inserts an event with `created_at` 40 days ago.
  - **The view must show:** The event counts in the week it was written.
  - **Fix:** Plan 3 Task 4c, a `BEFORE INSERT` trigger.
- **A forged `lectureId` cannot wipe the owner's cached view and re-run their metered themes.**
  - **Fix:** Plan 3 Task 2, the cache-invalidation trigger.
- **A first try before the 56-day window is not counted again inside it.**
  - **Fix:** Plan 3 Task 4f.4.
  - This is source-level: the window cuts the earlier try before the engine sees it. If both tries are given to `landing_from`, today's code already de-duplicates them.
- **A page flipped past in under two seconds still counts its readers toward the floor.**
  - **Fix:** Plan 3 Task 4f.3. This is on the write path (`v4_reading_service.MIN_SECONDS_TO_COUNT`): the event is never written today.

## Open questions for Abi

1. **What does a drawn Lesson show for a page under the floor?** (Story 5.)
   - Today these pages are dark. That covers a page 4 people read and all found foggy, and every page after the point where people stopped. Spec §8 says a dark cell means landing.
   - The story asks for null ("too few to say"), which needs `help: (number | null)[]` on the wire and a third look for the cell.
   - The other choice is to keep 0 and accept that dark means "nothing to say yet". The spec's sentence would then need to change.
2. **Normalising help over the Space vs. R7.** `help_index` divides every page by the Space's most-needed page. So one member asking on Joins page 2 can dim Normalization page 3, a page they never touched. The spec asks for this normalisation (B4), and R7 forbids its effect. No story is written until one of them gives way.
3. **The light of a Lesson that one person lifts over its floor.** In story 5, the Lesson becomes `calm` when the fifth reader opens page 1. Should a Lesson whose only page above the floor is page 1 count as "landing" at all?

## Noted, not a story

`landing_from` trusts its input: if the owner's events were ever in `SpaceData.events`, they would be counted. Today only `load_space_data` keeps them out (by its SQL and by `members - {owner_id}`), and story 6 pins that. A filter by `data.members` inside `lesson_facts` would be cheap defence in depth.

## Summary

There are 24 stories in six groups. 11 pass today. 13 fail today: 12 are covered by Plan 3 (Tasks 3, 4, 4b, 4d, 4e, 4f.1, 4f.2 and 14), and one is covered by nothing in Plan 3 (story 5: pages under the floor are drawn as landing). Five more stories need a database or the write path and are listed above, not drafted.
