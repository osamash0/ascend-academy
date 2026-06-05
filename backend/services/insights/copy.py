"""Templated, deterministic plain-language copy for insights.

This is the instant baseline the garden renders on every load (free, no AI
latency). On-demand AI narration layers on top in the UI when the professor
asks to go deeper.
"""
from __future__ import annotations

from typing import Any, Dict, Tuple


def confusion_hotspot_copy(slide: Dict[str, Any]) -> Tuple[str, str, str]:
    """Return (headline, summary, interpretation) for a Confusion Hotspot."""
    num = slide["slide_number"]
    confused_pct = round(slide["confusion_rate"])
    queries = slide["ai_query_count"]
    back_nav = slide["back_nav_count"]
    sought_help = queries > 0 or back_nav > 0

    headline = "A slide where many call for help." if sought_help else "A slide that's confusing students."

    bits = [f"{confused_pct}% of students rated slide {num} confused"]
    if queries > 0:
        bits.append(f"{queries} asked the AI tutor about it")
    if back_nav > 0:
        bits.append(f"{back_nav} backtracked to it from later slides")
    summary = " · ".join(bits) + "."

    if sought_help:
        interpretation = (
            f"Slide {num} is acting like a wall. A high share of students flagged "
            "confusion here, and the help-seeking and backtracking around it suggest "
            "the explanation isn't landing. Consider rewriting it for clarity, adding "
            "a worked example, or splitting it into two slides."
        )
    else:
        interpretation = (
            f"A high share of students flagged slide {num} as confusing — but few "
            "reached for the AI tutor or backtracked to re-read it. That pattern "
            "often means students don't realize they're stuck. Consider adding a "
            "quick check-for-understanding here, or revisiting the slide's clarity."
        )
    return headline, summary, interpretation


def silent_strugglers_copy(count: int) -> Tuple[str, str, str]:
    plural = "students are" if count != 1 else "student is"
    headline = "Someone might be silently slipping."
    summary = f"{count} {plural} disengaging — low progress and not asking for help."
    interpretation = (
        "These students show weak progress or low quiz performance, yet they "
        "haven't reached for the AI tutor. Silence reads like understanding, but "
        "here it more likely means they've quietly checked out. A nudge or a "
        "check-in now could pull them back before the exam."
    )
    return headline, summary, interpretation


def leaky_bucket_copy(slide_number: int, attrition_pct: float) -> Tuple[str, str, str]:
    headline = "Is this lecture feeling heavy?"
    summary = f"{round(attrition_pct)}% of students dropped off right after slide {slide_number}."
    interpretation = (
        f"Slide {slide_number} is where the lecture starts losing people — a steep "
        "drop in students continuing past it. Look at that slide and the one before "
        "it: something there is causing students to stop. It may be too dense, too "
        "long, or a natural-feeling stopping point."
    )
    return headline, summary, interpretation


def confusion_block_copy(start: int, end: int, avg_confusion: float) -> Tuple[str, str, str]:
    headline = "A stretch where the class lost the thread."
    summary = f"Slides {start}–{end} ran high on confusion (~{round(avg_confusion)}% on average)."
    interpretation = (
        f"Confusion isn't isolated to one slide — it builds across slides {start} "
        f"through {end}. A contiguous block like this usually means a concept was "
        "scaffolded too quickly. Consider adding a bridging slide or re-teaching the "
        "segment as a unit rather than tweaking individual slides."
    )
    return headline, summary, interpretation


def quiz_misalignment_copy(slide_number: int, success_rate: float) -> Tuple[str, str, str]:
    headline = "Are my quizzes testing what I think?"
    summary = f"Slide {slide_number} looked easy, but only {round(success_rate)}% passed its quiz first try."
    interpretation = (
        f"Students moved through slide {slide_number} comfortably — little confusion, "
        "normal pace — yet stumbled on its quiz item. That gap suggests the question "
        "tests something the slide doesn't actually teach, or at a harder level than "
        "the slide prepares for. Worth checking the item against the slide's content."
    )
    return headline, summary, interpretation


def skipped_slide_copy(slide_number: int, median_dwell: float) -> Tuple[str, str, str]:
    headline = "A slide that's being overlooked."
    summary = f"Students spend a median of just {round(median_dwell)}s on slide {slide_number} before moving on."
    interpretation = (
        f"Most students breeze past slide {slide_number} in seconds — too fast to "
        "absorb anything. Either it reads as filler they can skip, or it's where "
        "they start disengaging from the lecture. Consider shortening it, making its "
        "importance explicit, or moving it to optional material."
    )
    return headline, summary, interpretation


def silent_misleader_copy(slide_number: int, got_it_pct: float, success_rate: float) -> Tuple[str, str, str]:
    headline = "A slide that hides a trap."
    summary = f"{round(got_it_pct)}% felt sure on slide {slide_number} — yet only {round(success_rate)}% passed its quiz first try."
    interpretation = (
        f"Students leave slide {slide_number} feeling confident, but the quiz tells a "
        "different story — they didn't actually grasp it. That illusion of knowing is "
        "dangerous because they won't seek help. Add a quick check-for-understanding "
        "or a worked example that surfaces the misconception before it hardens."
    )
    return headline, summary, interpretation


def speed_bump_copy(slide_number: int) -> Tuple[str, str, str]:
    headline = "A slide students realize they missed — later."
    summary = f"Many students backtrack to slide {slide_number} from the slide right after it."
    interpretation = (
        f"Slide {slide_number} seems fine on its own, but the next slide expects "
        "something it didn't quite establish — so students jump back to re-read it. A "
        "bridging sentence or a transitional diagram connecting the two usually smooths "
        "this out."
    )
    return headline, summary, interpretation


def calibration_gap_copy(slide_number: int, overconfidence_rate: float) -> Tuple[str, str, str]:
    headline = "Confidence that doesn't match results."
    summary = f"On slide {slide_number}, {round(overconfidence_rate)}% who said “got it” still failed the quiz."
    interpretation = (
        f"There's a metacognition gap on slide {slide_number}: a large share of students "
        "who rated themselves confident then missed the linked quiz item. They can't tell "
        "what they don't know. A formative check right after this slide would help them "
        "(and you) catch the gap early."
    )
    return headline, summary, interpretation


def overpacked_copy(slide_number: int) -> Tuple[str, str, str]:
    headline = "A slide that asks too much at once."
    summary = f"Slide {slide_number} draws long, uneven dwell times and heavy help-seeking."
    interpretation = (
        f"Slide {slide_number} shows the fingerprint of cognitive overload — some students "
        "finish fast while others spend far longer, confusion is high, and the AI tutor "
        "sees a lot of traffic. It's likely carrying too many new concepts at once. "
        "Breaking it into smaller chunks usually relieves the pressure."
    )
    return headline, summary, interpretation


def positive_resolution_copy(slide_number: int, success_rate: float) -> Tuple[str, str, str]:
    headline = "Students wrestled with this — and won."
    summary = f"Slide {slide_number} drew some confusion, yet {round(success_rate)}% still passed its quiz."
    interpretation = (
        f"Slide {slide_number} wasn't effortless — students flagged some confusion — "
        "but they worked through it and the quiz results held up. This is healthy "
        "productive struggle, not a problem to fix."
    )
    return headline, summary, interpretation
