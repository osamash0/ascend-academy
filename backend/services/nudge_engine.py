"""Daily nudge engine.

Evaluates a configurable set of rules per student per day and decides whether
to surface a nudge (in-app banner + a row in the `notifications` table). The
engine is intentionally a pure rules engine — no ML — so its behaviour is
inspectable and unit-testable.

Public surface:
    Rule                       — base class implementing `should_fire(ctx)`
    Nudge                      — result dataclass returned by a rule
    UserContext                — bundle of the data each rule needs
    StreakAtRiskRule           — fires when a streak is about to break today
    AssignmentDueSoonRule      — fires when an active assignment is due in N days
    WeakConceptStaleRule       — fires when a weak concept hasn't been touched
    DEFAULT_RULES              — registered rule instances
    evaluate_user(...)         — run all rules for one user
    run_daily(...)             — fan-out for every active user, write notifs

The runner is idempotent: the same (user, rule_key, subject_key) tuple is
gated by `nudge_dismissals.quiet_until`, so re-running the daily job in the
same UTC day does not duplicate notifications.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, List, Optional

from backend.core.database import supabase_admin

logger = logging.getLogger(__name__)


# ── Configurable thresholds ──────────────────────────────────────────────────

ASSIGNMENT_DUE_WINDOW_DAYS = 2
WEAK_CONCEPT_STALE_DAYS = 14
WEAK_CONCEPT_THRESHOLD = 0.5  # mastery_score < this is "weak"
DEFAULT_QUIET_DAYS = 1  # global default quiet-period after emission


# ── Models ───────────────────────────────────────────────────────────────────

@dataclass
class Nudge:
    """One concrete nudge candidate produced by a rule."""

    rule_key: str
    subject_key: str           # stable id for the subject (assignment id, concept id, '')
    title: str
    message: str
    type: str                  # notifications.type column
    priority: int              # higher = more important
    deep_link: str             # relative path to focus the user on
    quiet_days: int = DEFAULT_QUIET_DAYS


@dataclass
class UserContext:
    """The slice of user state every rule needs.

    Built once per user per run so each rule does not re-query Supabase.
    Tests construct this directly to keep rule logic side-effect free.
    """

    user_id: str
    now: datetime
    current_streak: int = 0
    last_activity_at: Optional[datetime] = None
    assignments: List[dict] = field(default_factory=list)
    weak_concepts: List[dict] = field(default_factory=list)
    dismissals: dict = field(default_factory=dict)  # {(rule_key, subject_key): quiet_until}


# ── Rule base class ──────────────────────────────────────────────────────────

class Rule:
    """Base class. Subclasses override `should_fire`.

    `dismiss_quiet_days` is the per-rule cool-off applied when the user
    explicitly dismisses one of this rule's nudges (vs. `quiet_days` on the
    Nudge itself, which gates re-emission after the engine merely fires).
    """

    key: str = ""
    dismiss_quiet_days: int = 7

    def should_fire(self, ctx: UserContext) -> List[Nudge]:
        """Return 0..N candidate nudges. Empty means the rule is silent."""
        raise NotImplementedError


# ── Rule implementations ─────────────────────────────────────────────────────

class StreakAtRiskRule(Rule):
    """Fire when the user has a real streak going but hasn't been active today.

    "Today" is bucketed by UTC date. The streak is "at risk" when the last
    activity timestamp is from a previous day — the user must act today or
    the streak resets to zero.
    """

    key = "streak_at_risk"
    dismiss_quiet_days = 1  # streaks are time-sensitive — short cool-off

    def should_fire(self, ctx: UserContext) -> List[Nudge]:
        if ctx.current_streak < 1:
            return []
        if not ctx.last_activity_at:
            return []
        last_day = ctx.last_activity_at.astimezone(timezone.utc).date()
        today = ctx.now.astimezone(timezone.utc).date()
        if last_day >= today:
            return []  # already active today
        # Older than yesterday means the streak has likely already broken,
        # which is the streak service's job to handle — we only nudge on the
        # exact "1 day from breaking" boundary.
        if (today - last_day).days != 1:
            return []
        return [
            Nudge(
                rule_key=self.key,
                subject_key="",
                title="Don't lose your streak!",
                message=(
                    f"You're 1 day from breaking your {ctx.current_streak}-day streak. "
                    "A quick lesson keeps it alive."
                ),
                type="streak",
                priority=80,
                deep_link="/dashboard",
                quiet_days=1,
            )
        ]


class AssignmentDueSoonRule(Rule):
    """Fire once per assignment that is due within N days and not yet done."""

    key = "assignment_due_soon"
    dismiss_quiet_days = 2  # assignment will be re-pinged if still open after 2d

    def __init__(self, window_days: int = ASSIGNMENT_DUE_WINDOW_DAYS) -> None:
        self.window_days = window_days

    def should_fire(self, ctx: UserContext) -> List[Nudge]:
        out: List[Nudge] = []
        horizon = ctx.now + timedelta(days=self.window_days)
        for a in ctx.assignments:
            status = (a.get("status") or "").lower()
            if status in ("completed", "overdue"):
                continue
            due_at = a.get("due_at")
            if isinstance(due_at, str):
                try:
                    due_at = datetime.fromisoformat(due_at.replace("Z", "+00:00"))
                except ValueError:
                    continue
            if not isinstance(due_at, datetime):
                continue
            if due_at.tzinfo is None:
                due_at = due_at.replace(tzinfo=timezone.utc)
            if due_at < ctx.now or due_at > horizon:
                continue
            days_left = max(0, (due_at - ctx.now).days)
            day_word = "today" if days_left == 0 else f"in {days_left} day{'s' if days_left != 1 else ''}"
            out.append(
                Nudge(
                    rule_key=self.key,
                    subject_key=str(a.get("id") or ""),
                    title="Assignment due soon",
                    message=f"\"{a.get('title') or 'Assignment'}\" is due {day_word}.",
                    type="assignment",
                    priority=90 if days_left == 0 else 70,
                    deep_link=f"/assignments/{a.get('id', '')}",
                    quiet_days=1,
                )
            )
        return out


class WeakConceptStaleRule(Rule):
    """Fire when a low-mastery concept hasn't been reviewed in N days."""

    key = "weak_concept_stale"
    dismiss_quiet_days = 14  # mastery work — long cool-off

    def __init__(
        self,
        stale_days: int = WEAK_CONCEPT_STALE_DAYS,
        threshold: float = WEAK_CONCEPT_THRESHOLD,
    ) -> None:
        self.stale_days = stale_days
        self.threshold = threshold

    def should_fire(self, ctx: UserContext) -> List[Nudge]:
        out: List[Nudge] = []
        cutoff = ctx.now - timedelta(days=self.stale_days)
        # Sort by oldest-first so the "most stale" wins if priority ties.
        ranked = sorted(
            ctx.weak_concepts,
            key=lambda c: c.get("updated_at_dt") or ctx.now,
        )
        for c in ranked:
            score = c.get("mastery_score")
            if score is None or score >= self.threshold:
                continue
            updated_at = c.get("updated_at_dt")
            if not isinstance(updated_at, datetime) or updated_at > cutoff:
                continue
            out.append(
                Nudge(
                    rule_key=self.key,
                    subject_key=str(c.get("concept_id") or ""),
                    title="Time to review",
                    message=(
                        f"You haven't reviewed \"{c.get('canonical_name') or 'a concept'}\" "
                        f"in {self.stale_days}+ days."
                    ),
                    type="review",
                    priority=60,
                    deep_link=f"/concepts/{c.get('concept_id', '')}",
                    quiet_days=7,
                )
            )
        return out


DEFAULT_RULES: List[Rule] = [
    StreakAtRiskRule(),
    AssignmentDueSoonRule(),
    WeakConceptStaleRule(),
]


# ── Pure evaluator (testable, no Supabase) ───────────────────────────────────

def evaluate_user(
    ctx: UserContext,
    rules: Iterable[Rule] = DEFAULT_RULES,
) -> List[Nudge]:
    """Run every rule and return the surviving (un-quieted) nudges.

    Rules are filtered against `ctx.dismissals`: if (rule_key, subject_key)
    has a `quiet_until` in the future, the candidate is suppressed.
    Result is sorted by priority desc.
    """
    out: List[Nudge] = []
    for rule in rules:
        try:
            candidates = rule.should_fire(ctx) or []
        except Exception as e:  # never let one rule sink the whole run
            logger.error("Rule %s raised: %s", getattr(rule, "key", rule), e, exc_info=True)
            continue
        for n in candidates:
            quiet_until = ctx.dismissals.get((n.rule_key, n.subject_key))
            if quiet_until and quiet_until > ctx.now:
                continue
            out.append(n)
    out.sort(key=lambda n: n.priority, reverse=True)
    return out


# ── Supabase plumbing for the daily runner ───────────────────────────────────

def _parse_ts(raw: Any) -> Optional[datetime]:
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
    if not isinstance(raw, str) or not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _load_active_user_ids(client=None, since_days: int = 30, now: Optional[datetime] = None) -> List[str]:
    """Return user_ids that have been active in the last `since_days` days.

    The runner skips dormant accounts so we don't pump notifications into
    abandoned profiles.
    """
    cli = client or supabase_admin
    now = now or datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=since_days)).isoformat()
    try:
        rows = (
            cli.table("learning_events")
            .select("user_id, created_at")
            .gte("created_at", cutoff)
            .execute()
            .data
            or []
        )
    except Exception as e:
        logger.error("Failed to load active users: %s", e)
        return []
    return list({r["user_id"] for r in rows if r.get("user_id")})


def _build_context(user_id: str, now: datetime, client=None) -> UserContext:
    cli = client or supabase_admin

    # Streak + last activity --------------------------------------------------
    profile = (
        cli.table("profiles")
        .select("user_id, current_streak")
        .eq("user_id", user_id)
        .execute()
        .data
        or []
    )
    current_streak = (profile[0].get("current_streak") if profile else 0) or 0

    last_event_rows = (
        cli.table("learning_events")
        .select("created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    last_activity_at = _parse_ts(last_event_rows[0]["created_at"]) if last_event_rows else None

    # Assignments due soon ----------------------------------------------------
    enroll_rows = (
        cli.table("assignment_enrollments")
        .select("assignment_id")
        .eq("user_id", user_id)
        .execute()
        .data
        or []
    )
    assignment_ids = [r["assignment_id"] for r in enroll_rows if r.get("assignment_id")]
    assignments: List[dict] = []
    if assignment_ids:
        a_rows = (
            cli.table("assignments")
            .select("id, title, due_at, min_quiz_score")
            .in_("id", assignment_ids)
            .execute()
            .data
            or []
        )
        # Compute status per assignment using the same rule the API uses.
        from backend.api.assignments import compute_status_for_user, _fetch_lecture_ids_for_assignment
        for a in a_rows:
            lec_ids = _fetch_lecture_ids_for_assignment(a["id"])
            due_at = _parse_ts(a.get("due_at")) or now
            status = compute_status_for_user(
                user_id=user_id,
                lecture_ids=lec_ids,
                due_at=due_at,
                min_quiz_score=a.get("min_quiz_score"),
                now=now,
            )
            assignments.append({**a, "status": status.get("status")})

    # Weak concepts -----------------------------------------------------------
    mastery_rows = (
        cli.table("concept_mastery")
        .select("concept_id, mastery_score, updated_at")
        .eq("user_id", user_id)
        .lt("mastery_score", WEAK_CONCEPT_THRESHOLD)
        .execute()
        .data
        or []
    )
    weak_concepts: List[dict] = []
    if mastery_rows:
        c_ids = [r["concept_id"] for r in mastery_rows if r.get("concept_id")]
        c_rows = (
            cli.table("concepts")
            .select("id, canonical_name")
            .in_("id", c_ids)
            .execute()
            .data
            or []
        ) if c_ids else []
        name_by_id = {r["id"]: r.get("canonical_name") for r in c_rows}
        for r in mastery_rows:
            weak_concepts.append({
                "concept_id": r.get("concept_id"),
                "mastery_score": r.get("mastery_score"),
                "updated_at_dt": _parse_ts(r.get("updated_at")),
                "canonical_name": name_by_id.get(r.get("concept_id")),
            })

    # Dismissals / quiet periods ---------------------------------------------
    dis_rows = (
        cli.table("nudge_dismissals")
        .select("rule_key, subject_key, quiet_until")
        .eq("user_id", user_id)
        .execute()
        .data
        or []
    )
    dismissals: dict = {}
    for r in dis_rows:
        until = _parse_ts(r.get("quiet_until"))
        if until:
            dismissals[(r.get("rule_key") or "", r.get("subject_key") or "")] = until

    return UserContext(
        user_id=user_id,
        now=now,
        current_streak=current_streak,
        last_activity_at=last_activity_at,
        assignments=assignments,
        weak_concepts=weak_concepts,
        dismissals=dismissals,
    )


def _emit_nudge(user_id: str, nudge: Nudge, now: datetime, client=None) -> Optional[str]:
    """Insert a notification + upsert the quiet-period row. Returns notif id."""
    cli = client or supabase_admin
    try:
        ins = (
            cli.table("notifications")
            .insert({
                "user_id": user_id,
                "title": nudge.title,
                "message": nudge.message,
                "type": nudge.type,
                "read": False,
                "priority": nudge.priority,
                "deep_link": nudge.deep_link,
            })
            .execute()
        )
        notif_id = (ins.data or [{}])[0].get("id") if ins.data else None
    except Exception as e:
        logger.error("Failed to insert notification for user %s: %s", user_id, e)
        return None

    quiet_until = (now + timedelta(days=max(1, nudge.quiet_days))).isoformat()
    try:
        cli.table("nudge_dismissals").upsert(
            {
                "user_id": user_id,
                "rule_key": nudge.rule_key,
                "subject_key": nudge.subject_key,
                "notification_id": notif_id,
                "dismissed": False,
                "quiet_until": quiet_until,
                "updated_at": now.isoformat(),
            },
            on_conflict="user_id,rule_key,subject_key",
        ).execute()
    except Exception as e:
        logger.error("Failed to upsert nudge_dismissals for user %s: %s", user_id, e)
    return notif_id


def run_daily(
    *,
    now: Optional[datetime] = None,
    rules: Iterable[Rule] = DEFAULT_RULES,
    client=None,
) -> dict:
    """Run the engine for every active user. Idempotent within the quiet window.

    Returns a small report dict useful for logging / scheduling visibility.
    """
    now = now or datetime.now(timezone.utc)
    cli = client or supabase_admin

    user_ids = _load_active_user_ids(client=cli, now=now)
    emitted = 0
    users_with_nudge = 0
    for uid in user_ids:
        try:
            ctx = _build_context(uid, now, client=cli)
        except Exception as e:
            logger.error("nudge ctx failed for %s: %s", uid, e, exc_info=True)
            continue
        nudges = evaluate_user(ctx, rules=rules)
        if not nudges:
            continue
        users_with_nudge += 1
        for n in nudges:
            if _emit_nudge(uid, n, now, client=cli):
                emitted += 1
    report = {
        "users_evaluated": len(user_ids),
        "users_with_nudge": users_with_nudge,
        "notifications_emitted": emitted,
        "ran_at": now.isoformat(),
    }
    logger.info("nudge_engine.run_daily: %s", report)
    return report


def dismiss_nudge(
    *,
    user_id: str,
    notification_id: str,
    now: Optional[datetime] = None,
    client=None,
) -> bool:
    """Mark the nudge as dismissed and extend its quiet period.

    The notification is also marked read so the bell/icon clears. Returns
    True if a matching dismissal row was located, False otherwise.
    """
    now = now or datetime.now(timezone.utc)
    cli = client or supabase_admin
    rows = (
        cli.table("nudge_dismissals")
        .select("id, rule_key, subject_key, user_id")
        .eq("notification_id", notification_id)
        .eq("user_id", user_id)
        .execute()
        .data
        or []
    )
    if not rows:
        return False
    row = rows[0]
    # Per-rule dismiss cool-off: streaks short, mastery long. Falls back to
    # the Rule base default if the rule_key is not registered (e.g. legacy).
    rule_key = row.get("rule_key") or ""
    rule = next((r for r in DEFAULT_RULES if r.key == rule_key), None)
    quiet_days = max(1, getattr(rule, "dismiss_quiet_days", Rule.dismiss_quiet_days))
    quiet_until = (now + timedelta(days=quiet_days)).isoformat()
    cli.table("nudge_dismissals").update({
        "dismissed": True,
        "quiet_until": quiet_until,
        "updated_at": now.isoformat(),
    }).eq("id", row["id"]).execute()
    try:
        cli.table("notifications").update({"read": True}).eq("id", notification_id).eq("user_id", user_id).execute()
    except Exception:
        pass
    return True
