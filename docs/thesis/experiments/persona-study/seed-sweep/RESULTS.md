# Seed sweep of the study with scripted readers: results

*Machine-written by `seed_sweep.py`; protocol in `PROTOCOL.md`. 100 seed bases, 10 arms each, script sha256 `68af0d90bdb4`, Python 3.13.1.*

Seed base j = 0 reproduces the published run (18 of 23 met): **yes**.

## The 23 pre-registered expectations: seeds in which each held

| Expectation | Arm | Rule | Held in |
|---|---|---|---|
| confusion_hotspot | A-strugglers-above-floor | must | 19 of 100 |
| confusion_hotspot | B-strugglers-under-floor | must not | 0 of 100 |
| confusion_hotspot | E-skimmers | must not | 100 of 100 |
| confusion_hotspot | G-control-four-members | must not | 100 of 100 |
| confusion_block | G-control-four-members | must not | 100 of 100 |
| speed_bump | G-control-four-members | must not | 100 of 100 |
| leaky_bucket | E-skimmers | must | 100 of 100 |
| leaky_bucket | G-control-four-members | must not | 100 of 100 |
| skipped_slide | A-strugglers-above-floor | must not | 100 of 100 |
| skipped_slide | E-skimmers | must | 100 of 100 |
| skipped_slide | G-control-four-members | must not | 100 of 100 |
| calibration_gap | A-strugglers-above-floor | must not | 99 of 100 |
| calibration_gap | F-overconfident | must | 100 of 100 |
| calibration_gap | G-control-four-members | must not | 100 of 100 |
| themes | C-five-askers | must | 0 of 100 |
| themes | D-four-askers | must not | 100 of 100 |
| themes | G-control-four-members | must not | 100 of 100 |
| figures_null | A-strugglers-above-floor | must not | 1 of 100 |
| figures_null | G-control-four-members | must | 100 of 100 |
| figures_null | H-everyone | must not | 17 of 100 |
| reach_few | A-strugglers-above-floor | must not | 100 of 100 |
| reach_few | G-control-four-members | must | 100 of 100 |
| quiet_about_B | B-strugglers-under-floor | must | 0 of 100 |

## Expectations met per seed (of 23)

Minimum 16, median 17.0, maximum 19. The engine that reports nothing meets 16 of 23 at every seed (`../mute_engine.out.txt`).

| Met | Seeds |
|---|---|
| 16 | 1 |
| 17 | 65 |
| 18 | 31 |
| 19 | 3 |

## What each arm showed

| Arm | Finding kinds (seeds in which each appeared) | Page 10 (seeds) | Weekly numbers had a value | Themes made | Reach `few` |
|---|---|---|---|---|---|
| A-strugglers-above-floor | calibration_gap 1, confusion_hotspot 19, overpacked 81, speed_bump 100 | confusion_hotspot 19, overpacked 81 | 1 | 4 | 0 |
| B-strugglers-under-floor | confusion_hotspot 100 | confusion_hotspot 100 | 1 | 0 | 0 |
| C-five-askers | calibration_gap 4 | (none) 100 | 0 | 0 | 0 |
| D-four-askers | none | (none) 100 | 0 | 0 | 0 |
| E-skimmers | leaky_bucket 100, skipped_slide 100 | leaky_bucket+skipped_slide 100 | 0 | 0 | 0 |
| F-overconfident | calibration_gap 100 | calibration_gap 100 | 0 | 0 | 0 |
| G-control-four-members | none | (none) 100 | 0 | 0 | 100 |
| H-everyone | calibration_gap 100, confusion_hotspot 100, speed_bump 1 | calibration_gap+confusion_hotspot 100 | 17 | 34 | 0 |
| I-everyone-this-week (post hoc) | calibration_gap 100, confusion_hotspot 100, speed_bump 1 | calibration_gap+confusion_hotspot 100 | 100 | 29 | 0 |
| J-five-confused-askers (post hoc) | confusion_hotspot 100 | confusion_hotspot 100 | 0 | 61 | 0 |

## Post-hoc expectations (arms I and J; they do not count)

| Expectation | Arm | Held in |
|---|---|---|
| confusion_hotspot | J-five-confused-askers | 100 of 100 |
| figures_null | I-everyone-this-week | 100 of 100 |
| themes | J-five-confused-askers | 61 of 100 |
