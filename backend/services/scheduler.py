"""Personalized weekly study plan (Task #35).

This module has two layers:

1. A ``build_plan`` pure function over plain dataclasses. It takes a
   ``UserState`` snapshot + a horizon (days) + a daily time budget and
   returns a ``Plan`` describing what to study each day and why. It does
   not touch Supabase, the network, or the clock — every input is passed
   in. This is what the unit tests exercise.

2. ``assemble_user_state`` and ``build_plan_for_user`` thin wrappers that
   read the user's slice of state from the existing tables (progress,
   assignments, concept mastery) and feed it to the pure function.

Scheduling rules (in priority order):
    * Hard:   assignment due dates — incomplete lectures from each
              assignment are spread across the days leading up to its
              due_at.
    * Soft:   spaced-repetition review of weak concepts — for each of
              the user's lowest-mastery concepts, schedule a short
              refresher on a related lecture in a free slot.
    * Filler: in-progress lectures sorted least-recently-touched first,
              so we always honour the daily budget.

If prerequisite features (assignments, concept mastery) are not yet
populated, the scheduler degrades gracefully — it just sequences
in-progress lectures by the least-recently-touched heuristic.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field, asdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ── Tunables ────────────────────────────────────────────────────────────────

DEFAULT_BUDGET_MINUTES = 30
DEFAULT_ITEM_MINUTES = 15
WEAK_MASTERY_THRESHOLD = 0.5
MAX_WEAK_CONCEPTS_PER_PLAN = 3
# A lecture marked "done" suppresses itself from the next N days of
# regenerated plans. This is the cross-day side of the mark-done action.
COMPLETION_COOLDOWN_DAYS = 3


# ── Dataclasses ─────────────────────────────────────────────────────────────

@dataclass
class LectureState:
    lecture_id: str
    title: str
    total_slides: int = 0
    completed_slides: int = 0
    last_touched_at: Optional[datetime] = None

    @property
    def is_complete(self) -> bool:
        return self.total_slides > 0 and self.completed_slides >= self.total_slides

    @property
    def is_in_progress(self) -> bool:
        return self.completed_slides > 0 and not self.is_complete


@dataclass
class AssignmentState:
    assignment_id: str
    title: str
    due_at: datetime
    lecture_ids: List[str] = field(default_factory=list)
    completed_lecture_ids: List[str] = field(default_factory=list)
    min_quiz_score: Optional[int] = None


@dataclass
class WeakConcept:
    concept_id: str
    name: str
    mastery_score: float
    lecture_ids: List[str] = field(default_factory=list)


@dataclass
class UserState:
    user_id: str
    today: date
    lectures: List[LectureState] = field(default_factory=list)
    assignments: List[AssignmentState] = field(default_factory=list)
    weak_concepts: List[WeakConcept] = field(default_factory=list)
    completed_today: List[str] = field(default_factory=list)
    # Lectures marked done in the recent past (within COMPLETION_COOLDOWN_DAYS).
    # Suppressed from the entire upcoming plan window so a "done" click
    # actually re-shapes tomorrow's regen, not just today's.
    recent_completions: List[str] = field(default_factory=list)


@dataclass
class PlanItem:
    item_id: str
    lecture_id: str
    lecture_title: str
    est_minutes: int
    reason: str
    priority: str  # 'assignment' | 'weak_concept' | 'continue'
    slide_start: Optional[int] = None
    slide_end: Optional[int] = None
    # Convenience for the frontend: [start, end] inclusive, or None when
    # we have no slide-count metadata for the lecture.
    slide_range: Optional[List[int]] = None


@dataclass
class PlanDay:
    date: str  # ISO YYYY-MM-DD
    items: List[PlanItem] = field(default_factory=list)
    total_minutes: int = 0
    budget_minutes: int = DEFAULT_BUDGET_MINUTES


@dataclass
class Plan:
    days: List[PlanDay]
    budget_minutes: int
    has_assignments: bool = False
    has_weak_concepts: bool = False


# ── Helpers ─────────────────────────────────────────────────────────────────

_PRIORITY_RANK = {"assignment": 0, "weak_concept": 1, "continue": 2}


def _make_item_id(plan_date: date, lecture_id: str) -> str:
    """Stable, opaque-looking id the frontend round-trips back on /done."""
    return f"{plan_date.isoformat()}_{lecture_id}"


def parse_item_id(item_id: str) -> tuple[date, str]:
    """Inverse of ``_make_item_id``. Raises ValueError on malformed input."""
    if not item_id or "_" not in item_id:
        raise ValueError("Malformed item id.")
    date_part, _, lecture_id = item_id.partition("_")
    plan_date = date.fromisoformat(date_part)
    if not lecture_id:
        raise ValueError("Malformed item id.")
    return plan_date, lecture_id


def _slide_range(l: LectureState) -> tuple[Optional[int], Optional[int]]:
    if l.total_slides <= 0:
        return (None, None)
    start = min(l.completed_slides + 1, l.total_slides)
    return (start, l.total_slides)


def _add_item(
    bucket: Dict[int, List[PlanItem]],
    used: Dict[int, set],
    offset: int,
    plan_date: date,
    lecture: LectureState,
    *,
    reason: str,
    priority: str,
) -> bool:
    if lecture.lecture_id in used[offset]:
        return False
    if lecture.is_complete:
        return False
    start, end = _slide_range(lecture)
    bucket[offset].append(
        PlanItem(
            item_id=_make_item_id(plan_date, lecture.lecture_id),
            lecture_id=lecture.lecture_id,
            lecture_title=lecture.title,
            est_minutes=DEFAULT_ITEM_MINUTES,
            reason=reason,
            priority=priority,
            slide_start=start,
            slide_end=end,
            slide_range=[start, end] if start is not None and end is not None else None,
        )
    )
    used[offset].add(lecture.lecture_id)
    return True


def _has_room(bucket: Dict[int, List[PlanItem]], offset: int, budget: int) -> bool:
    return sum(i.est_minutes for i in bucket[offset]) + DEFAULT_ITEM_MINUTES <= budget


# ── Pure scheduler ──────────────────────────────────────────────────────────

def build_plan(
    state: UserState,
    days: int = 7,
    budget: int = DEFAULT_BUDGET_MINUTES,
) -> Plan:
    """Build a per-day study plan. Pure: no I/O, deterministic for a given state."""
    if days <= 0:
        return Plan(days=[], budget_minutes=budget)

    by_id: Dict[str, LectureState] = {l.lecture_id: l for l in state.lectures}
    bucket: Dict[int, List[PlanItem]] = defaultdict(list)
    used: Dict[int, set] = defaultdict(set)
    # Cross-day suppression: any lecture the student already completed in the
    # cooldown window is excluded from the entire regenerated plan, so a
    # "done" click today actually re-shapes tomorrow's plan.
    cooldown_lectures: set = set(state.recent_completions) | set(state.completed_today)

    # 1. Assignments — hard constraints. Spread incomplete lectures across the
    #    days leading up to due date. Sorted by earliest due first.
    has_assignments = False
    for a in sorted(state.assignments, key=lambda x: x.due_at):
        completed = set(a.completed_lecture_ids)
        incomplete = [
            lid for lid in a.lecture_ids
            if lid not in completed
            and lid not in cooldown_lectures
            and lid in by_id
            and not by_id[lid].is_complete
        ]
        if not incomplete:
            continue
        has_assignments = True

        due_d = a.due_at.date() if isinstance(a.due_at, datetime) else a.due_at
        days_until = (due_d - state.today).days
        if days_until < 0:
            # Overdue — pile everything into today.
            window = 1
        else:
            window = max(1, min(days_until + 1, days))

        for i, lid in enumerate(incomplete):
            slot = i % window
            lec = by_id[lid]
            reason = (
                f'Due {due_d.isoformat()} for "{a.title}"'
                if days_until >= 0
                else f'Overdue: "{a.title}"'
            )
            placed = False
            # Try preferred slot first, then walk forward to honour budget.
            for try_offset in list(range(slot, days)) + list(range(0, slot)):
                if not _has_room(bucket, try_offset, budget):
                    continue
                plan_date = state.today + timedelta(days=try_offset)
                if _add_item(
                    bucket, used, try_offset, plan_date, lec,
                    reason=reason, priority="assignment",
                ):
                    placed = True
                    break
            # If nothing fit (week is fully booked) it's fine — assignment
            # was attempted and the next regen will catch it.
            if not placed:
                logger.debug("Scheduler: no slot for lecture %s in %d-day window", lid, days)

    # 2. Weak concepts — soft. One refresher per concept on a free day.
    has_weak = False
    weak_sorted = sorted(
        [w for w in state.weak_concepts if w.mastery_score < WEAK_MASTERY_THRESHOLD],
        key=lambda w: (w.mastery_score, w.name.lower()),
    )[:MAX_WEAK_CONCEPTS_PER_PLAN]

    for wc in weak_sorted:
        for lid in wc.lecture_ids:
            if lid not in by_id or by_id[lid].is_complete:
                continue
            if lid in cooldown_lectures:
                continue
            placed = False
            for offset in range(days):
                if not _has_room(bucket, offset, budget):
                    continue
                plan_date = state.today + timedelta(days=offset)
                if _add_item(
                    bucket, used, offset, plan_date, by_id[lid],
                    reason=f"Refresh weak concept: {wc.name}",
                    priority="weak_concept",
                ):
                    placed = True
                    has_weak = True
                    break
            if placed:
                break  # one lecture per weak concept

    # 3. Filler — in-progress lectures, least-recently-touched first.
    in_progress = sorted(
        [l for l in state.lectures
         if l.is_in_progress and l.lecture_id not in cooldown_lectures],
        key=lambda l: (
            l.last_touched_at or datetime.min.replace(tzinfo=timezone.utc),
            l.title.lower(),
        ),
    )
    for offset in range(days):
        plan_date = state.today + timedelta(days=offset)
        for lec in in_progress:
            if not _has_room(bucket, offset, budget):
                break
            _add_item(
                bucket, used, offset, plan_date, lec,
                reason="Continue where you left off",
                priority="continue",
            )

    # 4. Materialise the days.
    plan_days: List[PlanDay] = []
    for offset in range(days):
        d = state.today + timedelta(days=offset)
        items = list(bucket.get(offset, []))
        # Stable order within a day: assignments first, then weak, then continue.
        items.sort(key=lambda i: (_PRIORITY_RANK.get(i.priority, 99), i.lecture_title.lower()))
        plan_days.append(
            PlanDay(
                date=d.isoformat(),
                items=items,
                total_minutes=sum(i.est_minutes for i in items),
                budget_minutes=budget,
            )
        )

    return Plan(
        days=plan_days,
        budget_minutes=budget,
        has_assignments=has_assignments,
        has_weak_concepts=has_weak,
    )


def plan_to_dict(plan: Plan) -> Dict[str, Any]:
    return asdict(plan)


# ── Data assembly (Supabase-bound, kept thin) ───────────────────────────────

def _parse_dt(v: Any) -> Optional[datetime]:
    if not v:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, str):
        try:
            dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def assemble_user_state(
    user_id: str,
    today: date,
    client: Any,
) -> UserState:
    """Read the user's slice of state and project it into ``UserState``.

    Each query is wrapped in try/except so a missing prerequisite (e.g. the
    concept catalog hasn't been ingested yet) degrades gracefully.
    """
    # ── Progress rows (used to merge in completion data later) ─────────
    progress_rows: List[dict] = []
    try:
        pres = (
            client.table("student_progress")
            .select(
                "lecture_id, completed_slides, last_slide_viewed, completed_at, created_at"
            )
            .eq("user_id", user_id)
            .execute()
        )
        progress_rows = pres.data or []
    except Exception as e:
        logger.warning("Scheduler: progress lookup failed for %s: %s", user_id, e)
        progress_rows = []

    progress_by_lid: Dict[str, dict] = {
        p["lecture_id"]: p for p in progress_rows if p.get("lecture_id")
    }

    # ── Assignments (gracefully optional) — gather assignment lecture IDs.
    assignments: List[AssignmentState] = []
    assignment_lecture_ids: set = set()
    try:
        ares = (
            client.table("assignment_enrollments")
            .select("assignment_id")
            .eq("user_id", user_id)
            .execute()
        )
        a_ids = sorted({r["assignment_id"] for r in (ares.data or []) if r.get("assignment_id")})
        if a_ids:
            adata = (
                client.table("assignments")
                .select("id, title, due_at, min_quiz_score")
                .in_("id", a_ids)
                .execute()
                .data
                or []
            )
            ajoin = (
                client.table("assignment_lectures")
                .select("assignment_id, lecture_id")
                .in_("assignment_id", a_ids)
                .execute()
                .data
                or []
            )
            join_by_aid: Dict[str, List[str]] = defaultdict(list)
            for jr in ajoin:
                if jr.get("assignment_id") and jr.get("lecture_id"):
                    join_by_aid[jr["assignment_id"]].append(jr["lecture_id"])
                    assignment_lecture_ids.add(jr["lecture_id"])

            done_lectures = {
                p["lecture_id"] for p in progress_rows
                if p.get("completed_at") and p.get("lecture_id")
            }
            for a in adata:
                due = _parse_dt(a.get("due_at"))
                if not due:
                    continue
                lec_ids = join_by_aid.get(a["id"], [])
                assignments.append(
                    AssignmentState(
                        assignment_id=a["id"],
                        title=a.get("title") or "Assignment",
                        due_at=due,
                        lecture_ids=lec_ids,
                        completed_lecture_ids=[lid for lid in lec_ids if lid in done_lectures],
                        min_quiz_score=a.get("min_quiz_score"),
                    )
                )
    except Exception as e:
        logger.warning("Scheduler: assignments lookup failed (graceful degrade): %s", e)

    # ── Weak concepts (gracefully optional) — also gather lecture IDs.
    weak_concepts: List[WeakConcept] = []
    weak_concept_lecture_ids: set = set()
    try:
        mres = (
            client.table("concept_mastery")
            .select("concept_id, mastery_score")
            .eq("user_id", user_id)
            .execute()
        )
        mrows = [r for r in (mres.data or []) if r.get("mastery_score") is not None]
        weak_rows = [r for r in mrows if r["mastery_score"] < WEAK_MASTERY_THRESHOLD]
        if weak_rows:
            cids = sorted({r["concept_id"] for r in weak_rows if r.get("concept_id")})
            crows = (
                client.table("concepts")
                .select("id, canonical_name")
                .in_("id", cids)
                .execute()
                .data
                or []
            )
            cname = {c["id"]: c.get("canonical_name") or "Concept" for c in crows}
            cl_rows = (
                client.table("concept_lectures")
                .select("concept_id, lecture_id")
                .in_("concept_id", cids)
                .execute()
                .data
                or []
            )
            cl_by_concept: Dict[str, List[str]] = defaultdict(list)
            for r in cl_rows:
                if r.get("concept_id") and r.get("lecture_id"):
                    cl_by_concept[r["concept_id"]].append(r["lecture_id"])
                    weak_concept_lecture_ids.add(r["lecture_id"])
            for r in weak_rows:
                cid = r["concept_id"]
                weak_concepts.append(
                    WeakConcept(
                        concept_id=cid,
                        name=cname.get(cid, "Concept"),
                        mastery_score=float(r["mastery_score"]),
                        lecture_ids=cl_by_concept.get(cid, []),
                    )
                )
    except Exception as e:
        logger.warning("Scheduler: weak-concept lookup failed (graceful degrade): %s", e)

    # ── Lecture universe = progress ∪ assignments ∪ weak concepts ──────
    # The student's "active lectures" include anything they've started
    # plus anything the system needs them to study (assigned or weak).
    # Lectures with no progress row default to zero progress so the
    # scheduler can still surface them.
    all_lecture_ids = set(progress_by_lid.keys()) | assignment_lecture_ids | weak_concept_lecture_ids
    lectures: List[LectureState] = []
    if all_lecture_ids:
        try:
            lres = (
                client.table("lectures")
                .select("id, title, total_slides")
                .in_("id", sorted(all_lecture_ids))
                .execute()
            )
            lec_meta = {r["id"]: r for r in (lres.data or [])}
        except Exception as e:
            logger.warning("Scheduler: lectures lookup failed: %s", e)
            lec_meta = {}

        for lid in sorted(all_lecture_ids):
            ld = lec_meta.get(lid)
            if not ld:
                continue
            p = progress_by_lid.get(lid) or {}
            completed_arr = p.get("completed_slides") or []
            last_touched = _parse_dt(p.get("completed_at")) or _parse_dt(p.get("created_at"))
            lectures.append(
                LectureState(
                    lecture_id=lid,
                    title=ld.get("title") or "Untitled lecture",
                    total_slides=int(ld.get("total_slides") or 0),
                    completed_slides=len(completed_arr),
                    last_touched_at=last_touched,
                )
            )

    # ── Recent schedule completions (today + cooldown window back) ─────
    completed_today: List[str] = []
    recent_completions: List[str] = []
    try:
        cutoff = (today - timedelta(days=COMPLETION_COOLDOWN_DAYS)).isoformat()
        cres = (
            client.table("schedule_item_completions")
            .select("lecture_id, plan_date")
            .eq("user_id", user_id)
            .gte("plan_date", cutoff)
            .execute()
        )
        rows = cres.data or []
        today_iso = today.isoformat()
        for r in rows:
            lid = r.get("lecture_id")
            if not lid:
                continue
            recent_completions.append(lid)
            if r.get("plan_date") == today_iso:
                completed_today.append(lid)
    except Exception as e:
        logger.warning("Scheduler: completions lookup failed (graceful degrade): %s", e)

    return UserState(
        user_id=user_id,
        today=today,
        lectures=lectures,
        assignments=assignments,
        weak_concepts=weak_concepts,
        completed_today=completed_today,
        recent_completions=recent_completions,
    )


def get_daily_budget_minutes(user_id: str, client: Any) -> int:
    """Read the per-user daily study minute budget. Falls back to default."""
    try:
        res = (
            client.table("profiles")
            .select("study_minutes_per_day")
            .eq("user_id", user_id)
            .execute()
        )
        rows = res.data or []
        if rows:
            v = rows[0].get("study_minutes_per_day")
            if v and isinstance(v, (int, float)) and v > 0:
                return int(v)
    except Exception:
        # Column is optional — silent fallback is correct here.
        pass
    return DEFAULT_BUDGET_MINUTES


def build_plan_for_user(
    user_id: str,
    days: int,
    client: Any,
    *,
    today: Optional[date] = None,
    budget: Optional[int] = None,
) -> Plan:
    """End-to-end: fetch state + run the pure scheduler."""
    today_d = today or datetime.now(timezone.utc).date()
    state = assemble_user_state(user_id, today_d, client)
    eff_budget = budget if budget and budget > 0 else get_daily_budget_minutes(user_id, client)
    return build_plan(state, days=days, budget=eff_budget)


def record_completion(
    user_id: str,
    plan_date: date,
    lecture_id: str,
    client: Any,
) -> dict:
    """Idempotent insert into ``schedule_item_completions``."""
    payload = {
        "user_id": user_id,
        "plan_date": plan_date.isoformat(),
        "lecture_id": lecture_id,
    }
    # Use upsert for idempotency (re-clicking "done" must not error).
    try:
        client.table("schedule_item_completions").upsert(
            payload, on_conflict="user_id,plan_date,lecture_id"
        ).execute()
    except Exception as e:
        logger.error("Scheduler: completion upsert failed: %s", e)
        raise
    return {**payload, "completed": True}
