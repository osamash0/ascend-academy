# backend/services/luna/store.py
"""Every SQL statement for Luna sessions. The service never writes SQL.

The backend connects as the service role, so every read and write here is
scoped by user_id itself — RLS is the second wall, not the first.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional
from uuid import UUID

from backend.core.database import get_db_connection
from backend.services.review.scheduler import ReviewState, schedule

LOCK_SECONDS = 90


def _j(v: Any) -> Any:
    return json.loads(v) if isinstance(v, str) else v


def _session(r: Any) -> dict:
    return {
        "id": str(r["id"]), "user_id": str(r["user_id"]), "space_id": r["space_id"],
        "lecture_id": str(r["lecture_id"]) if r["lecture_id"] else None, "goal": r["goal"],
        "plan": _j(r["plan"]) or [], "recap": r["recap"], "status": r["status"], "wrap": _j(r["wrap"]),
        "kept": r["kept"], "turn_count": r["turn_count"],
        "created_at": r["created_at"].isoformat(), "updated_at": r["updated_at"].isoformat(),
    }


def _turn(r: Any) -> dict:
    return {"id": str(r["id"]), "role": r["role"], "content": _j(r["content"]), "created_at": r["created_at"].isoformat()}


def _memory(r: Any) -> dict:
    return {
        "id": str(r["id"]), "kind": r["kind"], "space_id": r["space_id"], "text": r["text"],
        "active": r["active"], "updated_at": r["updated_at"],
    }


class PgStore:
    def __init__(self, connect: Callable[[], Awaitable[Any]] = get_db_connection):
        self._connect = connect

    async def _conn(self):
        return await self._connect()

    # ── sessions ─────────────────────────────────────────────────────────
    async def create_session(self, user_id: str, space_id: str, lecture_id: Optional[str], goal: str, plan: list[dict]) -> dict:
        async with await self._conn() as c:
            r = await c.fetchrow(
                """INSERT INTO luna_sessions (user_id, space_id, lecture_id, goal, plan)
                   VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *""",
                UUID(user_id), space_id, UUID(lecture_id) if lecture_id else None, goal[:300], json.dumps(plan),
            )
        return _session(r)

    async def get_session(self, session_id: str, user_id: str) -> Optional[dict]:
        async with await self._conn() as c:
            r = await c.fetchrow("SELECT * FROM luna_sessions WHERE id = $1 AND user_id = $2", UUID(session_id), UUID(user_id))
        return _session(r) if r else None

    async def update_session(self, session_id: str, *, plan=None, recap=None, turn_count=None, status=None, wrap=None, kept=None) -> None:
        async with await self._conn() as c:
            await c.execute(
                """UPDATE luna_sessions SET
                     plan = COALESCE($2::jsonb, plan), recap = COALESCE($3, recap),
                     turn_count = COALESCE($4, turn_count), status = COALESCE($5, status),
                     wrap = COALESCE($6::jsonb, wrap), kept = COALESCE($7, kept),
                     ended_at = CASE WHEN $5 IN ('wrapped', 'abandoned') THEN now() ELSE ended_at END,
                     updated_at = now()
                   WHERE id = $1""",
                UUID(session_id), json.dumps(plan) if plan is not None else None, recap, turn_count, status,
                json.dumps(wrap) if wrap is not None else None, kept,
            )

    async def claim(self, session_id: str) -> bool:
        async with await self._conn() as c:
            got = await c.fetchval(
                f"""UPDATE luna_sessions SET in_flight_until = now() + interval '{LOCK_SECONDS} seconds'
                    WHERE id = $1 AND (in_flight_until IS NULL OR in_flight_until < now()) RETURNING id""",
                UUID(session_id),
            )
        return got is not None

    async def release(self, session_id: str) -> None:
        async with await self._conn() as c:
            await c.execute("UPDATE luna_sessions SET in_flight_until = NULL WHERE id = $1", UUID(session_id))

    async def list_sessions(self, user_id: str, space_id: str) -> list[dict]:
        async with await self._conn() as c:
            rows = await c.fetch(
                "SELECT * FROM luna_sessions WHERE user_id = $1 AND space_id = $2 ORDER BY updated_at DESC LIMIT 30",
                UUID(user_id), space_id,
            )
        return [_session(r) for r in rows]

    # ── turns ────────────────────────────────────────────────────────────
    async def add_turns(self, session_id: str, user_id: str, client_turn_id: str, rows: list[tuple[str, dict]]) -> None:
        async with await self._conn() as c:
            await c.executemany(
                """INSERT INTO luna_turns (session_id, user_id, client_turn_id, role, content)
                   VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT (session_id, client_turn_id, role) DO NOTHING""",
                [(UUID(session_id), UUID(user_id), UUID(client_turn_id), role, json.dumps(content)) for role, content in rows],
            )

    async def turns_for_client_id(self, session_id: str, client_turn_id: str) -> list[dict]:
        async with await self._conn() as c:
            rows = await c.fetch(
                "SELECT * FROM luna_turns WHERE session_id = $1 AND client_turn_id = $2 ORDER BY created_at",
                UUID(session_id), UUID(client_turn_id),
            )
        return [_turn(r) for r in rows]

    async def recent_turns(self, session_id: str, limit: int) -> list[dict]:
        async with await self._conn() as c:
            rows = await c.fetch(
                "SELECT * FROM (SELECT * FROM luna_turns WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2) t ORDER BY created_at",
                UUID(session_id), limit,
            )
        return [_turn(r) for r in rows]

    # ── memory ───────────────────────────────────────────────────────────
    async def active_memory(self, user_id: str, space_id: str) -> list[dict]:
        async with await self._conn() as c:
            rows = await c.fetch(
                """SELECT * FROM learner_memory WHERE user_id = $1 AND active
                     AND (space_id IS NULL OR space_id = $2) ORDER BY updated_at""",
                UUID(user_id), space_id,
            )
        return [_memory(r) for r in rows]

    async def all_active_memory(self, user_id: str) -> list[dict]:
        async with await self._conn() as c:
            rows = await c.fetch("SELECT * FROM learner_memory WHERE user_id = $1 AND active ORDER BY updated_at", UUID(user_id))
        return [_memory(r) for r in rows]

    async def add_memory(self, user_id: str, lines: list[dict], space_id: Optional[str], session_id: Optional[str]) -> list[dict]:
        out = []
        async with await self._conn() as c:
            for m in lines:
                r = await c.fetchrow(
                    """INSERT INTO learner_memory (user_id, kind, space_id, text, source_session_id)
                       VALUES ($1, $2, $3, $4, $5) RETURNING *""",
                    UUID(user_id), m["kind"], space_id if m["space_scoped"] else None, m["text"],
                    UUID(session_id) if session_id else None,
                )
                out.append(_memory(r))
        return out

    async def retire_memory(self, user_id: str, ids: list[str]) -> None:
        if not ids:
            return
        async with await self._conn() as c:
            await c.execute(
                """UPDATE learner_memory SET active = false, retired_at = now(), updated_at = now()
                   WHERE user_id = $1 AND id = ANY($2::uuid[]) AND active""",
                UUID(user_id), [UUID(i) for i in ids],
            )

    async def list_memory(self, user_id: str) -> list[dict]:
        async with await self._conn() as c:
            await c.execute(
                "DELETE FROM learner_memory WHERE user_id = $1 AND NOT active AND retired_at < now() - interval '30 days'",
                UUID(user_id),
            )
            rows = await c.fetch(
                "SELECT * FROM learner_memory WHERE user_id = $1 ORDER BY active DESC, updated_at DESC", UUID(user_id),
            )
        return [_memory(r) for r in rows]

    async def edit_memory(self, user_id: str, memory_id: str, text: str) -> Optional[dict]:
        async with await self._conn() as c:
            r = await c.fetchrow(
                "UPDATE learner_memory SET text = $3, updated_at = now() WHERE user_id = $1 AND id = $2 RETURNING *",
                UUID(user_id), UUID(memory_id), text,
            )
        return _memory(r) if r else None

    async def delete_memory(self, user_id: str, memory_id: str) -> bool:
        async with await self._conn() as c:
            gone = await c.fetchval(
                "DELETE FROM learner_memory WHERE user_id = $1 AND id = $2 RETURNING id", UUID(user_id), UUID(memory_id),
            )
        return gone is not None

    async def forget_all(self, user_id: str) -> int:
        async with await self._conn() as c:
            rows = await c.fetch("DELETE FROM learner_memory WHERE user_id = $1 RETURNING id", UUID(user_id))
        return len(rows)

    # ── owned practice cards ─────────────────────────────────────────────
    async def insert_owned_cards(self, user_id: str, lecture_id: str, cards: list[dict]) -> int:
        now = datetime.now(timezone.utc)
        added = 0
        async with await self._conn() as c:
            for card in cards:
                h = hashlib.sha256(f"luna|{user_id}|{card['question']}".encode()).hexdigest()
                front = {"question": card["question"], "options": [o["text"] for o in card["options"]], "page": card.get("page")}
                back = {"correct": next(i for i, o in enumerate(card["options"]) if o["correct"]),
                        "why": [o["why"] for o in card["options"]]}
                cid = await c.fetchval(
                    """INSERT INTO review_cards (lecture_id, source_type, front, back, content_hash, owner_id)
                       VALUES ($1, 'luna_session', $2::jsonb, $3::jsonb, $4, $5)
                       ON CONFLICT (lecture_id, content_hash) DO NOTHING RETURNING id""",
                    UUID(lecture_id), json.dumps(front), json.dumps(back), h, UUID(user_id),
                )
                if cid:
                    await c.execute(
                        """INSERT INTO review_schedule (user_id, card_id, due_at, stability, difficulty, reps, lapses, state)
                           VALUES ($1, $2, $3, 0, 2.5, 0, 0, 'new') ON CONFLICT (user_id, card_id) DO NOTHING""",
                        UUID(user_id), cid, now,
                    )
                    added += 1
        return added

    async def due_cards(self, user_id: str, lecture_id: Optional[str]) -> list[dict]:
        async with await self._conn() as c:
            rows = await c.fetch(
                """SELECT rc.id, rc.lecture_id, rc.front, rc.back FROM review_schedule rs
                   JOIN review_cards rc ON rc.id = rs.card_id
                   WHERE rs.user_id = $1 AND rc.owner_id = $1 AND rc.source_type = 'luna_session'
                     AND NOT rs.suspended AND rs.due_at <= now()
                     AND ($2::uuid IS NULL OR rc.lecture_id = $2::uuid)
                   ORDER BY rs.due_at LIMIT 10""",
                UUID(user_id), UUID(lecture_id) if lecture_id else None,
            )
        return [{"card_id": str(r["id"]), "lecture_id": str(r["lecture_id"]), "front": _j(r["front"]), "back": _j(r["back"])}
                for r in rows]

    async def grade_owned_card(self, user_id: str, card_id: str, rating: int) -> Optional[dict]:
        now = datetime.now(timezone.utc)
        async with await self._conn() as c:
            row = await c.fetchrow(
                """SELECT rs.* FROM review_schedule rs JOIN review_cards rc ON rc.id = rs.card_id
                   WHERE rs.user_id = $1 AND rs.card_id = $2 AND rc.owner_id = $1""",
                UUID(user_id), UUID(card_id),
            )
            if row is None:
                return None
            prior = ReviewState(
                stability=float(row["stability"]), difficulty=float(row["difficulty"]), reps=row["reps"],
                lapses=row["lapses"], state=row["state"], due_at=row["due_at"], last_reviewed=row["last_reviewed"],
            )
            new = schedule(prior, rating, now)
            await c.execute(
                """UPDATE review_schedule SET due_at = $1, stability = $2, difficulty = $3, reps = $4,
                     lapses = $5, state = $6, last_reviewed = $7 WHERE user_id = $8 AND card_id = $9""",
                new.due_at, new.stability, new.difficulty, new.reps, new.lapses, new.state, new.last_reviewed,
                UUID(user_id), UUID(card_id),
            )
            await c.execute(
                "INSERT INTO review_log (user_id, card_id, rating) VALUES ($1, $2, $3)", UUID(user_id), UUID(card_id), rating,
            )
        return {"card_id": card_id, "due_at": new.due_at.isoformat()}
