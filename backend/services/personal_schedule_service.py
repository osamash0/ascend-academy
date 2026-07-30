"""Personal optimal-study-time analytics.

Moved out of ``analytics_service.py`` (P4-1 god-object split — the roadmap's
``docs/ROADMAP_10X_FOUNDATION.md`` §9). This is unrelated to the per-lecture
analytics aggregates that make up the rest of that module: it looks at a
single student's own event history to suggest *when* they study best.

Not to be confused with ``backend/services/scheduler.py`` (the weekly SRS
study-plan builder behind ``GET /api/schedule/me``) — that decides *what* to
study next; this decides *when* the student is historically most effective.
"""
import logging
from datetime import datetime, timedelta
from typing import Any, Dict

from backend.services import analytics_service

logger = logging.getLogger(__name__)


def get_personal_optimal_schedule(user_id: str, token: str = None, timezone_offset_minutes: int = 0) -> Dict[str, Any]:
    """
    Calculate the best time to study for a specific student based on:
    1. Circadian patterns (when they are active)
    2. Performance metrics (accuracy and speed during different hours)
    """
    # Qualified module access (not `from ... import`) so tests that patch
    # analytics_service.get_auth_client / _fetch_all keep working here too.
    client = analytics_service.get_auth_client(token)

    # Fetch all learning events for this user
    events_data = analytics_service._fetch_all(client.table("learning_events")\
        .select("event_type, event_data, created_at")\
        .eq("user_id", user_id))

    events = events_data or []
    if not events:
        return {
            "suggested_hours": [],
            "message": "Not enough data yet. Keep learning to see your optimal schedule!",
            "peak_hour": None
        }

    # Group by hour (0-23)
    # Note: We should ideally handle timezone, but using UTC for now
    hourly_stats = {h: {"count": 0, "correct": 0, "attempts": 0, "total_duration": 0, "view_count": 0} for h in range(24)}

    # Login events are not learning activity — exclude to avoid skewing circadian scores
    _EXCLUDED_EVENT_TYPES = {"login"}

    for ev in events:
        if ev.get("event_type") in _EXCLUDED_EVENT_TYPES:
            continue
        try:
            # created_at is like '2024-03-20T10:30:00+00:00'
            dt = datetime.fromisoformat(ev["created_at"].replace('Z', '+00:00'))
            # Shift UTC to client local time
            local_dt = dt - timedelta(minutes=timezone_offset_minutes)
            hour = local_dt.hour

            hourly_stats[hour]["count"] += 1

            ev_type = ev.get("event_type")
            ev_data = ev.get("event_data", {})

            if ev_type == "quiz_attempt":
                hourly_stats[hour]["attempts"] += 1
                if ev_data.get("correct"):
                    hourly_stats[hour]["correct"] += 1
            elif ev_type == "slide_view":
                hourly_stats[hour]["view_count"] += 1
                hourly_stats[hour]["total_duration"] += ev_data.get("duration_seconds", 0)
        except Exception:
            continue

    # Score each hour
    scores = []
    for h, s in hourly_stats.items():
        if s["count"] == 0:
            continue

        # Volume (20% weight) - normalized against max count
        # Accuracy (50% weight) - correct/attempts
        # Focus (30% weight) - avg duration per slide

        accuracy = (s["correct"] / s["attempts"]) if s["attempts"] > 0 else 0.5 # Neutral if no quizzes
        avg_duration = (s["total_duration"] / s["view_count"]) if s["view_count"] > 0 else 30

        # Scale duration to a 0-1 score (assume 60s is ideal "deep focus" per slide)
        focus_score = min(1.0, avg_duration / 60.0)

        # Volume score
        intensity = min(1.0, s["count"] / 10.0) # Assume 10 events/hour is high intensity

        total_score = (intensity * 0.2) + (accuracy * 0.5) + (focus_score * 0.3)

        scores.append({
            "hour": h,
            "score": round(total_score, 3),
            "accuracy": round(accuracy * 100, 1),
            "intensity": s["count"]
        })

    # Sort by score
    scores.sort(key=lambda x: x["score"], reverse=True)

    suggested = scores[:3]
    if not suggested:
        return {
            "suggested_hours": [],
            "message": "Not enough data yet. Keep learning!",
            "peak_hour": None
        }

    peak = suggested[0]["hour"]

    # Simple advice logic
    advice = ""
    pattern = "Calibrating"
    if peak is not None:
        if 5 <= peak < 12:
            advice = "You're a morning lark! Your focus and accuracy are highest in the AM."
            pattern = "Morning Peak"
        elif 12 <= peak < 17:
            advice = "Afternoon power-user! You handle complex topics well in the middle of the day."
            pattern = "Afternoon Surge"
        elif 17 <= peak < 22:
            advice = "Evening focus! You seem to reach your flow state as the day winds down."
            pattern = "Evening Flow"
        else:
            advice = "Night owl detected! You show high cognitive clarity during late-night sessions."
            pattern = "Night Owl"

    # For the frontend timeline, we want ALL 24 hours.
    # Hours without data will have a baseline score.
    full_day_stats = []
    for h in range(24):
        # Find if we have real data for this hour
        existing = next((s for s in scores if s["hour"] == h), None)
        if existing:
            full_day_stats.append(existing)
        else:
            full_day_stats.append({
                "hour": h,
                "score": 0.1, # Baseline
                "accuracy": 0,
                "intensity": 0
            })

    # Sort full_day_stats by hour for the timeline
    full_day_stats.sort(key=lambda x: x["hour"])

    return {
        "suggested_hours": full_day_stats,
        "peak_hour": peak,
        "message": advice,
        "accuracy_at_peak": suggested[0]["accuracy"] if suggested else 0,
        "energy_pattern": pattern,
        "circadian_score": int(suggested[0]["score"] * 100) if suggested else 0
    }
