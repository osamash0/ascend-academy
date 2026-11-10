# Persona study run, 2026-11-09 (seed 20261109)

Engine: `v4_landing_service.landing_from` at the working tree's revision; themes model stood in for (no model call left the machine). 10 arms, 5370 events in all. Expectations met: 21 of 26 (pre-registered and post-hoc together; the table says which arm is post hoc).

This tests the analytics machinery (does the aggregation separate the arms, does the floor hold), not learners; no claim about students follows from it.

## Arms

- **A-strugglers-above-floor**: 6 struggling, 6 steady. six people struggle on pages 8-12: the hard pages must light up.
- **B-strugglers-under-floor**: 3 struggling, 10 steady. three struggle: nothing may be said about them, the Lesson reads calm.
- **C-five-askers**: 5 asker, 5 steady. five askers who read the page: themes may be made.
- **D-four-askers**: 4 asker, 6 steady. four askers: no themes, whatever else is found.
- **E-skimmers**: 8 skimmer, 4 steady. eight skim and stop at page 10: skipped pages and a leak after 10.
- **F-overconfident**: 6 overconfident, 4 steady. six say 'got it' and miss the checkpoint at page 10: a calibration gap.
- **G-control-four-members**: 2 struggling, 1 steady, 1 asker. four members in all: under the floor, everything null.
- **H-everyone**: 6 steady, 6 struggling, 5 asker, 5 skimmer, 5 overconfident. a realistic mix of 27: what rises to the top.
- **I-everyone-this-week** (post hoc): 6 steady, 6 struggling, 5 asker, 5 skimmer, 5 overconfident. the same 27, all reading in the last seven days: the weekly figures get a week with five readers.
- **J-five-confused-askers** (post hoc): 5 confused_asker, 5 steady. five askers who are also confused on page 10: a hotspot with five askers, so themes can be made.

## Findings per arm

| Arm | Members | Reach | Figures (reading / landing / cleared) | Findings (kind: pages) | Themes | Expectations |
|---|---|---|---|---|---|---|
| A-strugglers-above-floor | 12 | enough | None / None / None (weeks with a value: 0/0/0 of 8) | confusion_hotspot: 10; speed_bump: 12 | none | confusion_hotspot: ok, skipped_slide: ok, calibration_gap: ok, figures_null: MISS figures_null found, expected absent, reach_few: ok |
| B-strugglers-under-floor | 13 | enough | None / None / None (weeks with a value: 0/0/0 of 8) | confusion_hotspot: 10 | none | confusion_hotspot: MISS confusion_hotspot found, expected absent, quiet_about_B: MISS expected quiet_about_B, not found |
| C-five-askers | 10 | enough | None / None / None (weeks with a value: 0/0/0 of 8) | none | none | themes: MISS expected themes, not found |
| D-four-askers | 10 | enough | None / None / None (weeks with a value: 0/0/0 of 8) | none | none | themes: ok |
| E-skimmers | 12 | enough | None / None / None (weeks with a value: 0/0/0 of 8) | leaky_bucket: 10; skipped_slide: 2; skipped_slide: 1; skipped_slide: 3; skipped_slide: 5; skipped_slide: 8; skipped_slide: 9; skipped_slide: 6; skipped_slide: 7; skipped_slide: 10; skipped_slide: 4 | none | confusion_hotspot: ok, leaky_bucket: ok, skipped_slide: ok |
| F-overconfident | 10 | enough | None / None / None (weeks with a value: 0/0/0 of 8) | calibration_gap: 10 | none | calibration_gap: ok |
| G-control-four-members | 4 | few | None / None / None (weeks with a value: 0/0/0 of 8) | none | none | confusion_hotspot: ok, confusion_block: ok, speed_bump: ok, leaky_bucket: ok, skipped_slide: ok, calibration_gap: ok, themes: ok, figures_null: ok, reach_few: ok |
| H-everyone | 27 | enough | None / None / None (weeks with a value: 3/3/2 of 8) | confusion_hotspot: 10; calibration_gap: 10 | none | figures_null: MISS figures_null found, expected absent |
| I-everyone-this-week | 27 | enough | 27 / 63 / 79 (weeks with a value: 1/1/1 of 8) | confusion_hotspot: 10; calibration_gap: 10 | none | figures_null: ok |
| J-five-confused-askers | 10 | enough | None / None / None (weeks with a value: 0/0/0 of 8) | confusion_hotspot: 10 | p10 (5 askers) | confusion_hotspot: ok, themes: ok |
