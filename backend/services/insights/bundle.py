"""Metric bundle — the single data-gathering pass that feeds all detectors.

Reuses the existing cached per-feature aggregates (so insight numbers match
the rest of the app) and adds the per-slide signals that no existing aggregate
exposes: AI-query / back-navigation counts, dwell-time distribution
(median/IQR/CV), directional back-navigation, and confidence calibration.
"""
from __future__ import annotations

import logging
import statistics
from typing import Any, Dict, List, Optional

from backend.services import analytics_service

logger = logging.getLogger(__name__)

# Dwell readings longer than this (30 min) are treated as "left the tab open",
# not genuine processing time, and excluded from distribution stats.
_DWELL_OUTLIER_CEIL = 1800.0


def _safe_median(values: List[float]) -> float:
    return float(statistics.median(values)) if values else 0.0


def _safe_quartiles(values: List[float]) -> tuple[float, float]:
    """Return (p25, p75); falls back to min/max for tiny samples."""
    if len(values) >= 4:
        q = statistics.quantiles(values, n=4)
        return float(q[0]), float(q[2])
    if values:
        return float(min(values)), float(max(values))
    return 0.0, 0.0


def _safe_cv(values: List[float]) -> float:
    """Coefficient of variation (stdev / mean); 0 when undefined."""
    if len(values) < 2:
        return 0.0
    mean = statistics.fmean(values)
    if mean <= 0:
        return 0.0
    return float(statistics.pstdev(values) / mean)


def _per_slide_signal_counts(
    client, lecture_id: str, slides_data: List[Dict[str, Any]]
) -> Dict[str, Dict[str, int]]:
    """Count AI-tutor queries and inbound back-navigations per slide id.

    - AI queries are attributed by ``slideId`` when present (post event
      enrichment) and fall back to a ``slideTitle`` → slide-id match for
      historical events that predate the enrichment.
    - Back-navigation is counted on the *destination* slide (``toSlideId``):
      a student jumping back to slide X signals X left a gap.
    """
    title_to_id = {
        (s.get("title") or "").strip(): s["id"]
        for s in slides_data
        if (s.get("title") or "").strip()
    }
    counts: Dict[str, Dict[str, int]] = {
        s["id"]: {"ai_queries": 0, "back_nav": 0} for s in slides_data
    }

    ai_events = analytics_service._fetch_all(
        client.table("learning_events")
        .select("event_data")
        .eq("event_type", "ai_tutor_query")
        .contains("event_data", {"lectureId": lecture_id})
    )
    for ev in ai_events:
        ed = ev.get("event_data") or {}
        sid = ed.get("slideId") or title_to_id.get((ed.get("slideTitle") or "").strip())
        if sid in counts:
            counts[sid]["ai_queries"] += 1

    nav_events = analytics_service._fetch_all(
        client.table("learning_events")
        .select("event_data")
        .eq("event_type", "slide_back_navigation")
        .contains("event_data", {"lectureId": lecture_id})
    )
    for ev in nav_events:
        ed = ev.get("event_data") or {}
        dest = ed.get("toSlideId")
        if dest in counts:
            counts[dest]["back_nav"] += 1

    return counts


def _per_slide_distribution_and_calibration(
    client, lecture_id: str, slides_data: List[Dict[str, Any]]
) -> Dict[str, Dict[str, Any]]:
    """Compute dwell distribution, directional back-nav, and calibration per slide.

    These are the Phase-3 signals with no existing aggregate:
    - **dwell distribution**: median / p25 / p75 / CV / short-view count
      (powers Skipped Slide, Speed Bump, Overpacked).
    - **directional back-nav**: returns specifically from the *next* slide
      (i+1 → i), the Speed Bump signature.
    - **calibration**: students who rated a slide "got it" yet failed its linked
      quiz item on the first try (the Calibration Gap / illusion-of-knowing).
    """
    id_to_num = {s["id"]: s.get("slide_number") for s in slides_data}
    out: Dict[str, Dict[str, Any]] = {
        s["id"]: {
            "median_dwell": 0.0, "dwell_p25": 0.0, "dwell_p75": 0.0,
            "dwell_cv": 0.0, "short_views": 0,
            "back_nav_from_next": 0,
            "overconfident_count": 0, "got_it_quiz_total": 0,
        }
        for s in slides_data
    }

    # ── Dwell distribution ────────────────────────────────────────────────────
    dwell_by_slide: Dict[str, List[float]] = {s["id"]: [] for s in slides_data}
    view_events = analytics_service._fetch_all(
        client.table("learning_events")
        .select("event_data")
        .eq("event_type", "slide_view")
        .contains("event_data", {"lectureId": lecture_id})
    )
    for ev in view_events:
        ed = ev.get("event_data") or {}
        sid = ed.get("slideId")
        dur = ed.get("duration_seconds")
        if sid in dwell_by_slide and isinstance(dur, (int, float)) and 0 < dur <= _DWELL_OUTLIER_CEIL:
            dwell_by_slide[sid].append(float(dur))
    for sid, durs in dwell_by_slide.items():
        if not durs:
            continue
        p25, p75 = _safe_quartiles(durs)
        out[sid].update(
            median_dwell=round(_safe_median(durs), 1),
            dwell_p25=round(p25, 1),
            dwell_p75=round(p75, 1),
            dwell_cv=round(_safe_cv(durs), 2),
            short_views=sum(1 for d in durs if d < 4.0),
        )

    # ── Directional back-navigation (from the immediately next slide) ──────────
    nav_events = analytics_service._fetch_all(
        client.table("learning_events")
        .select("event_data")
        .eq("event_type", "slide_back_navigation")
        .contains("event_data", {"lectureId": lecture_id})
    )
    for ev in nav_events:
        ed = ev.get("event_data") or {}
        src, dst = ed.get("fromSlideId"), ed.get("toSlideId")
        from_num, to_num = id_to_num.get(src), id_to_num.get(dst)
        if dst in out and isinstance(from_num, int) and isinstance(to_num, int) and from_num == to_num + 1:
            out[dst]["back_nav_from_next"] += 1

    # ── Calibration (got-it-but-wrong) ─────────────────────────────────────────
    quiz_questions = analytics_service._fetch_all(
        client.table("quiz_questions")
        .select("id, slide_id, slides!inner(lecture_id)")
        .eq("slides.lecture_id", lecture_id)
    )
    qid_to_slide = {q["id"]: q["slide_id"] for q in quiz_questions}

    quiz_attempts = analytics_service._fetch_all(
        client.table("learning_events")
        .select("user_id, event_data")
        .eq("event_type", "quiz_attempt")
        .contains("event_data", {"lectureId": lecture_id})
    )
    # (user, slide) → got any linked first-attempt wrong; and has any attempt.
    user_slide_wrong: Dict[tuple, bool] = {}
    user_slide_has_quiz: set = set()
    for ev in quiz_attempts:
        uid = ev.get("user_id")
        ed = ev.get("event_data") or {}
        sid = qid_to_slide.get(ed.get("questionId"))
        if not uid or sid not in out:
            continue
        key = (uid, sid)
        user_slide_has_quiz.add(key)
        if ed.get("correct") is False:
            user_slide_wrong[key] = True

    # Latest confidence rating per (user, slide).
    conf_events = analytics_service._fetch_all(
        client.table("learning_events")
        .select("user_id, event_data, created_at")
        .eq("event_type", "confidence_rating")
        .contains("event_data", {"lectureId": lecture_id})
        .order("created_at")
    )
    user_slide_rating: Dict[tuple, str] = {}
    for ev in conf_events:  # ordered ascending → last write wins = latest
        uid = ev.get("user_id")
        ed = ev.get("event_data") or {}
        sid = ed.get("slideId")
        rating = ed.get("rating")
        if uid and sid in out and rating in ("got_it", "unsure", "confused"):
            user_slide_rating[(uid, sid)] = rating

    for (uid, sid), rating in user_slide_rating.items():
        if rating != "got_it" or (uid, sid) not in user_slide_has_quiz:
            continue
        out[sid]["got_it_quiz_total"] += 1
        if user_slide_wrong.get((uid, sid)):
            out[sid]["overconfident_count"] += 1

    return out


def build_metric_bundle(lecture_id: str, token: Optional[str] = None) -> Dict[str, Any]:
    """Gather every signal the detectors need into one bundle.

    Returns a dict with ``total_students``, ``lecture_avg_dwell``, and a
    ``slides`` list of per-slide metric dicts.
    """
    client = analytics_service.get_auth_client(token)

    slides_data = analytics_service._fetch_all(
        client.table("slides")
        .select("id, slide_number, title")
        .eq("lecture_id", lecture_id)
        .order("slide_number")
    )

    # Reused cached aggregates (consistency with the rest of the app).
    slide_analytics = analytics_service.get_slide_analytics(lecture_id, token)
    confidence = analytics_service.get_confidence_by_slide(lecture_id, token)
    overview = analytics_service.get_lecture_overview(lecture_id, token)
    students = analytics_service.get_student_performance(lecture_id, token)
    total_students = int(overview.get("total_students") or 0)

    # New per-slide signal aggregations.
    signal_counts = _per_slide_signal_counts(client, lecture_id, slides_data)
    dist = _per_slide_distribution_and_calibration(client, lecture_id, slides_data)

    # Index reused aggregates for joining.
    sa_by_id = {row.get("slide_id"): row for row in slide_analytics}
    conf_by_num = {row.get("slide_number"): row for row in confidence}

    slides: List[Dict[str, Any]] = []
    dwell_samples: List[float] = []
    median_samples: List[float] = []
    for s in slides_data:
        sid = s["id"]
        num = s.get("slide_number")
        sa = sa_by_id.get(sid, {})
        conf = conf_by_num.get(num, {})
        counts = signal_counts.get(sid, {"ai_queries": 0, "back_nav": 0})
        d = dist.get(sid, {})

        avg_dwell = float(sa.get("average_time_seconds") or 0.0)
        view_count = int(sa.get("view_count") or 0)
        median_dwell = float(d.get("median_dwell") or 0.0)
        if view_count > 0 and avg_dwell > 0:
            dwell_samples.append(avg_dwell)
        if median_dwell > 0:
            median_samples.append(median_dwell)

        got_it_quiz_total = int(d.get("got_it_quiz_total") or 0)
        overconfident = int(d.get("overconfident_count") or 0)
        overconfidence_rate = round((overconfident / got_it_quiz_total * 100), 1) if got_it_quiz_total > 0 else 0.0

        slides.append(
            {
                "slide_id": sid,
                "slide_number": num,
                "title": s.get("title") or f"Slide {num}",
                "view_count": view_count,
                "avg_dwell": avg_dwell,
                "median_dwell": median_dwell,
                "dwell_p25": float(d.get("dwell_p25") or 0.0),
                "dwell_p75": float(d.get("dwell_p75") or 0.0),
                "dwell_cv": float(d.get("dwell_cv") or 0.0),
                "short_views": int(d.get("short_views") or 0),
                "confusion_rate": float(sa.get("confusion_rate") or 0.0),
                "quiz_success_rate": sa.get("quiz_success_rate"),
                "quiz_attempts": int(sa.get("quiz_attempts") or 0),
                "got_it": int(conf.get("got_it") or 0),
                "unsure": int(conf.get("unsure") or 0),
                "confused": int(conf.get("confused") or 0),
                "ratings_total": int(conf.get("total") or 0),
                "ai_query_count": counts["ai_queries"],
                "back_nav_count": counts["back_nav"],
                "back_nav_from_next": int(d.get("back_nav_from_next") or 0),
                "overconfident_count": overconfident,
                "got_it_quiz_total": got_it_quiz_total,
                "overconfidence_rate": overconfidence_rate,
            }
        )

    lecture_avg_dwell = (sum(dwell_samples) / len(dwell_samples)) if dwell_samples else 0.0
    lecture_median_dwell = _safe_median(median_samples)

    return {
        "lecture_id": lecture_id,
        "total_students": total_students,
        "lecture_avg_dwell": round(lecture_avg_dwell, 1),
        "lecture_median_dwell": round(lecture_median_dwell, 1),
        "slides": slides,
        "students": students,
    }
