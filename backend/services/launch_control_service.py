"""Launch Control: the one admin screen for launch day.

Four panels, all computed live from the database and the running config:

* readiness gates — can we launch? Each gate passes, fails, or asks a human
  to confirm something the app cannot see (a pg_dump, the privacy policy);
* real-users pulse — who signed up, who came back, internal accounts excluded
  (migration 20261013000000_real_users.sql);
* AI spend — today against the fleet ceiling, by feature/model, and per
  student against the monthly cap (public.llm_calls);
* catalog health — every lecture a student can open, against the quality gate.

The SQL lives here; the pure decisions (quality gate, gate evaluation) are
separate functions so they can be tested without a database.
"""
from __future__ import annotations

import datetime as dt
import logging
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ── Quality gate ─────────────────────────────────────────────────────────────

MIN_SLIDES = 3
MIN_QUIZZES = 5
MIN_CONCEPTS = 3
# Metadata slides (title, agenda, "Questions?") are never embedded, so a
# fully indexed deck still sits below 100%. Below this share, retrieval for
# the tutor has real holes.
MIN_EMBEDDED_SHARE = 0.3

# Titles that mark test uploads. Matched case-insensitively against the
# lecture and course titles a student can actually open.
JUNK_TITLE_RE = re.compile(
    r"\b(e2e|test|unify editor|gamification lecture|please ignore|cache invalidation|verification course)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class LectureHealth:
    id: str
    course_id: str
    course: str
    title: str
    slides: int
    quizzes: int
    concepts: int
    poster: bool
    embedded: int

    @property
    def missing(self) -> List[str]:
        gaps = []
        if self.slides < MIN_SLIDES:
            gaps.append("slides")
        if self.quizzes < MIN_QUIZZES:
            gaps.append("quizzes")
        if self.concepts < MIN_CONCEPTS:
            gaps.append("concepts")
        if not self.poster:
            gaps.append("poster")
        if self.slides and self.embedded / self.slides < MIN_EMBEDDED_SHARE:
            gaps.append("search index")
        if JUNK_TITLE_RE.search(self.title) or JUNK_TITLE_RE.search(self.course):
            gaps.append("test content")
        return gaps

    def as_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "course_id": self.course_id,
            "course": self.course,
            "title": self.title,
            "slides": self.slides,
            "quizzes": self.quizzes,
            "concepts": self.concepts,
            "poster": self.poster,
            "embedded": self.embedded,
            "missing": self.missing,
        }


# ── Gates ────────────────────────────────────────────────────────────────────

def gate(gate_id: str, label: str, status: str, detail: str) -> Dict[str, str]:
    assert status in ("pass", "fail", "confirm")
    return {"id": gate_id, "label": label, "status": status, "detail": detail}


def evaluate_gates(
    *,
    openai_only: bool,
    provider_error: Optional[str],
    ceiling_usd: float,
    user_cap_usd: float,
    classification_ready: bool,
    lectures: List[LectureHealth],
    starter_courses: int,
    v4_reader_on: bool,
) -> List[Dict[str, str]]:
    """Every check the app can make on its own, plus the two it cannot."""
    failing = [l for l in lectures if l.missing]
    junk = [l for l in lectures if "test content" in l.missing]
    gates = [
        gate(
            "ai_mode", "All AI runs on OpenAI",
            "pass" if openai_only and not provider_error else "fail",
            provider_error or ("AI_PROVIDER_MODE=openai_only" if openai_only
                               else "AI_PROVIDER_MODE is not openai_only"),
        ),
        gate(
            "ai_caps", "Spending caps set",
            "pass" if ceiling_usd > 0 and user_cap_usd > 0 else "fail",
            f"${ceiling_usd:g}/day for the platform, ${user_cap_usd:g}/month per student",
        ),
        gate(
            "real_users", "Real users are told apart from test accounts",
            "pass" if classification_ready else "fail",
            "account classification is live" if classification_ready
            else "apply migration 20261013000000_real_users.sql",
        ),
        gate(
            "starter", "One starter course for onboarding",
            "pass" if starter_courses == 1 else "fail",
            f"{starter_courses} published course(s) with demo_slug 'database-systems'",
        ),
        gate(
            "no_junk", "No test content visible to students",
            "pass" if not junk else "fail",
            "clean" if not junk else f"{len(junk)} visible lecture(s) look like test uploads",
        ),
        gate(
            "catalog", "Every visible lecture passes the quality gate",
            "pass" if lectures and not failing else "fail",
            f"{len(lectures) - len(failing)} of {len(lectures)} pass",
        ),
        gate(
            "v4_reader", "v4 reader backend is on",
            "pass" if v4_reader_on else "fail",
            "FEATURE_V4_READER=1" if v4_reader_on else "set FEATURE_V4_READER=1",
        ),
        gate(
            "backup", "Fresh database backup taken",
            "confirm", "pg_dump before launch; the free tier has no automatic backups",
        ),
        gate(
            "privacy", "Privacy policy names OpenAI",
            "confirm", "EN + DE policy list OpenAI as a processor of slides and tutor messages",
        ),
    ]
    return gates


# ── Queries ──────────────────────────────────────────────────────────────────

_VISIBLE_LECTURES_SQL = """
SELECT
  l.id::text AS id,
  c.id::text AS course_id,
  c.title AS course,
  l.title,
  (SELECT count(*) FROM public.slides s WHERE s.lecture_id = l.id) AS slides,
  (SELECT count(*) FROM public.quiz_questions q
     JOIN public.slides s ON s.id = q.slide_id WHERE s.lecture_id = l.id) AS quizzes,
  (SELECT count(*) FROM public.concept_lectures cl WHERE cl.lecture_id = l.id) AS concepts,
  l.poster_url IS NOT NULL AS poster,
  (SELECT count(*) FROM public.slide_embeddings e WHERE e.pdf_hash = l.pdf_hash) AS embedded
FROM public.lectures l
JOIN public.courses c ON c.id = l.course_id
WHERE NOT COALESCE(l.is_archived, false)
  AND NOT COALESCE(c.is_archived, false)
  AND COALESCE(l.visibility, 'course') = 'course'
ORDER BY c.title, l.created_at
"""


async def _relation_exists(conn, name: str) -> bool:
    return bool(await conn.fetchval("SELECT to_regclass($1) IS NOT NULL", name))


async def fetch_catalog(conn) -> List[LectureHealth]:
    rows = await conn.fetch(_VISIBLE_LECTURES_SQL)
    return [
        LectureHealth(
            id=r["id"], course_id=r["course_id"], course=r["course"] or "",
            title=r["title"] or "", slides=r["slides"], quizzes=r["quizzes"],
            concepts=r["concepts"], poster=r["poster"], embedded=r["embedded"],
        )
        for r in rows
    ]


async def fetch_pulse(conn, classification_ready: bool) -> Dict[str, Any]:
    # Without the classification view every account counts as real; the
    # real_users gate is red in that case, so the numbers are flagged, not hidden.
    real = (
        "SELECT user_id, created_at FROM public.account_classification WHERE NOT is_internal"
        if classification_ready
        else "SELECT user_id, created_at FROM public.profiles"
    )
    totals = await conn.fetchrow(
        f"""
        WITH real AS ({real})
        SELECT
          (SELECT count(*) FROM real) AS real_users,
          (SELECT count(*) FROM public.profiles) AS all_users,
          (SELECT count(*) FROM real WHERE created_at >= now() - interval '7 days') AS signups_7d,
          (SELECT count(DISTINCT e.user_id) FROM public.learning_events e
             JOIN real r ON r.user_id = e.user_id
            WHERE e.created_at >= now() - interval '24 hours') AS active_24h,
          (SELECT count(DISTINCT e.user_id) FROM public.learning_events e
             JOIN real r ON r.user_id = e.user_id
            WHERE e.created_at >= now() - interval '7 days') AS active_7d
        """
    )
    funnel = None
    sources: List[Dict[str, Any]] = []
    if classification_ready:
        funnel = await conn.fetchrow(
            """
            SELECT COALESCE(sum(signed_up), 0)::int AS signed_up,
                   COALESCE(sum(onboarded), 0)::int AS onboarded,
                   COALESCE(sum(activated), 0)::int AS activated,
                   COALESCE(sum(came_back), 0)::int AS came_back,
                   COALESCE(sum(week_2_active), 0)::int AS week_2_active
            FROM public.real_user_funnel_daily
            """
        )
        sources = [
            dict(r) for r in await conn.fetch(
                """
                SELECT acquisition_source AS source, sum(signed_up)::int AS signed_up,
                       sum(activated)::int AS activated
                FROM public.real_user_funnel_daily
                GROUP BY 1 ORDER BY 2 DESC LIMIT 8
                """
            )
        ]
    daily = await conn.fetch(
        f"""
        WITH real AS ({real})
        SELECT d::date AS date, count(r.user_id)::int AS signups
        FROM generate_series(current_date - 29, current_date, interval '1 day') d
        LEFT JOIN real r ON r.created_at::date = d::date
        GROUP BY 1 ORDER BY 1
        """
    )
    feed = await conn.fetch(
        f"""
        WITH real AS ({real})
        SELECT e.created_at, e.event_type, e.user_id::text AS user_id,
               COALESCE(NULLIF(p.display_name, ''), NULLIF(p.full_name, ''),
                        split_part(p.email, '@', 1)) AS who
        FROM public.learning_events e
        JOIN real r ON r.user_id = e.user_id
        JOIN public.profiles p ON p.user_id = e.user_id
        WHERE e.created_at >= now() - interval '14 days'
        ORDER BY e.created_at DESC
        LIMIT 30
        """
    )
    return {
        "classification_ready": classification_ready,
        "totals": {k: int(v or 0) for k, v in dict(totals).items()},
        "funnel": dict(funnel) if funnel else None,
        "sources": sources,
        "signups_daily": [{"date": r["date"].isoformat(), "signups": r["signups"]} for r in daily],
        "feed": [
            {
                "at": r["created_at"].isoformat(),
                "event_type": r["event_type"],
                "user_id": r["user_id"],
                "who": r["who"],
            }
            for r in feed
        ],
    }


async def fetch_ai_spend(conn, *, ceiling_usd: float, user_cap_usd: float) -> Dict[str, Any]:
    today = await conn.fetchval(
        "SELECT COALESCE(sum(est_cost_usd), 0)::float8 FROM public.llm_calls "
        "WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc'"
    )
    month = await conn.fetchval(
        "SELECT COALESCE(sum(est_cost_usd), 0)::float8 FROM public.llm_calls "
        "WHERE created_at >= date_trunc('month', now())"
    )
    daily = await conn.fetch(
        """
        SELECT d::date AS date, COALESCE(sum(c.est_cost_usd), 0)::float8 AS usd,
               count(c.id)::int AS calls
        FROM generate_series(current_date - 29, current_date, interval '1 day') d
        LEFT JOIN public.llm_calls c ON c.created_at::date = d::date
        GROUP BY 1 ORDER BY 1
        """
    )
    by_feature = await conn.fetch(
        """
        SELECT feature, sum(est_cost_usd)::float8 AS usd, count(*)::int AS calls
        FROM public.llm_calls WHERE created_at >= now() - interval '30 days'
        GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT 12
        """
    )
    by_provider = await conn.fetch(
        """
        SELECT provider, model, sum(est_cost_usd)::float8 AS usd, count(*)::int AS calls
        FROM public.llm_calls WHERE created_at >= now() - interval '30 days'
        GROUP BY 1, 2 ORDER BY 4 DESC LIMIT 12
        """
    )
    top_users = await conn.fetch(
        """
        SELECT c.user_id::text AS user_id,
               COALESCE(NULLIF(p.display_name, ''), NULLIF(p.full_name, ''),
                        split_part(p.email, '@', 1)) AS who,
               sum(c.est_cost_usd)::float8 AS usd, count(*)::int AS calls
        FROM public.llm_calls c
        LEFT JOIN public.profiles p ON p.user_id = c.user_id
        WHERE c.user_id IS NOT NULL AND c.created_at >= date_trunc('month', now())
        GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10
        """
    )
    return {
        "ceiling_usd": ceiling_usd,
        "user_cap_usd": user_cap_usd,
        "today_usd": round(today, 4),
        "month_usd": round(month, 4),
        "daily": [
            {"date": r["date"].isoformat(), "usd": round(r["usd"], 4), "calls": r["calls"]}
            for r in daily
        ],
        "by_feature": [
            {"feature": r["feature"], "usd": round(r["usd"], 4), "calls": r["calls"]}
            for r in by_feature
        ],
        "by_provider": [
            {"provider": r["provider"], "model": r["model"], "usd": round(r["usd"], 4), "calls": r["calls"]}
            for r in by_provider
        ],
        "top_users": [
            {"user_id": r["user_id"], "who": r["who"], "usd": round(r["usd"], 4), "calls": r["calls"]}
            for r in top_users
        ],
    }


async def build_overview(conn) -> Dict[str, Any]:
    from backend.core.config import settings
    from backend.services.ai import orchestrator

    provider_error = None
    try:
        orchestrator.assert_provider_mode()
    except RuntimeError as exc:
        provider_error = str(exc)

    classification_ready = await _relation_exists(conn, "public.account_classification")
    lectures = await fetch_catalog(conn)
    starter = await conn.fetchval(
        "SELECT count(*) FROM public.courses WHERE demo_slug = 'database-systems' "
        "AND NOT COALESCE(is_archived, false)"
    )
    ceiling = settings.llm_openai_daily_cost_ceiling_usd
    user_cap = settings.llm_monthly_user_cost_cap_usd
    return {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "gates": evaluate_gates(
            openai_only=orchestrator.OPENAI_ONLY,
            provider_error=provider_error,
            ceiling_usd=ceiling,
            user_cap_usd=user_cap,
            classification_ready=classification_ready,
            lectures=lectures,
            starter_courses=int(starter or 0),
            v4_reader_on=settings.feature_v4_reader,
        ),
        "pulse": await fetch_pulse(conn, classification_ready),
        "ai": await fetch_ai_spend(conn, ceiling_usd=ceiling, user_cap_usd=user_cap),
        "catalog": [l.as_dict() for l in lectures],
        "models": {
            "mode": orchestrator.AI_PROVIDER_MODE,
            "quality": orchestrator.OPENAI_QUALITY_MODEL,
            "bulk": orchestrator.OPENAI_BULK_MODEL,
        },
    }


async def set_classification(
    conn, *, user_id: str, is_internal: Optional[bool], reason: Optional[str], set_by: str,
) -> None:
    """Mark one account internal/real by hand; ``None`` returns it to the rules."""
    if is_internal is None:
        await conn.execute(
            "DELETE FROM public.internal_account_overrides WHERE user_id = $1", user_id,
        )
        return
    await conn.execute(
        """
        INSERT INTO public.internal_account_overrides (user_id, is_internal, reason, set_by)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id) DO UPDATE
          SET is_internal = EXCLUDED.is_internal, reason = EXCLUDED.reason,
              set_by = EXCLUDED.set_by, set_at = now()
        """,
        user_id, is_internal, reason, set_by,
    )
