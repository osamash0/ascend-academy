# backend/services/erasure.py
"""Account erasure (GDPR Art. 17): manifest -> durable job -> auth delete -> execute.

Why this order (MILESTONE_2026_08 F2): deleting auth.users cascades the
`lectures` rows, the only map from a person to their storage files. So the
exact list of files is built FIRST (read-only, all-or-nothing) and stored in
`account_erasure_jobs` (no FK; it outlives the account). Only then is the
account deleted; the files are removed afterwards and, if that fails,
retried by the worker. Nothing is deleted while the account still exists,
so a failure cannot leave a half-deleted live account.

pdf-uploads is content-addressed and shared across users (`{pdf_hash}.pdf`);
a blob is removed only if no remaining lecture or parse_run references its
hash, checked at execution time, after the person's own rows have cascaded away.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi.concurrency import run_in_threadpool
from supabase_auth.errors import AuthApiError

from backend.core.database import supabase_admin
from backend.services.db_errors import is_tolerable_absence
from backend.services import chat_memory

logger = logging.getLogger(__name__)

BUCKETS = ("avatars", "lecture-pdfs", "lecture-posters", "worksheets")
LECTURE_OWNER_COLUMNS = ("professor_id", "student_owner_id")
_PAGE = 100
_PUBLIC_URL = re.compile(r"lecture-pdfs/(.+)$")


class ErasureError(Exception):
    """A step could not be completed; nothing irreversible happened in it."""


@dataclass
class ErasureManifest:
    subject_id: str
    lecture_ids: list[str] = field(default_factory=list)
    pdf_upload_hashes: list[str] = field(default_factory=list)
    keys: dict[str, list[str]] = field(default_factory=lambda: {b: [] for b in BUCKETS})

    def to_json(self) -> dict[str, Any]:
        return {
            "subject_id": self.subject_id,
            "lecture_ids": self.lecture_ids,
            "pdf_upload_hashes": self.pdf_upload_hashes,
            "keys": self.keys,
        }

    @classmethod
    def from_json(cls, d: dict[str, Any]) -> "ErasureManifest":
        return cls(
            subject_id=d["subject_id"],
            lecture_ids=list(d.get("lecture_ids", [])),
            pdf_upload_hashes=list(d.get("pdf_upload_hashes", [])),
            keys={b: list(d.get("keys", {}).get(b, [])) for b in BUCKETS},
        )


def _client(client):
    return client if client is not None else supabase_admin


def _rows(c, table: str, column: str, value, *, many: bool = False) -> list[dict[str, Any]]:
    if not many:
        return c.table(table).select("*").eq(column, value).execute().data or []
    out: list[dict[str, Any]] = []
    for i in range(0, len(value), _PAGE):  # keep the in_() URL short
        out.extend(c.table(table).select("*").in_(column, value[i:i + _PAGE]).execute().data or [])
    return out


def _list_folder(c, bucket: str, folder: str) -> list[str]:
    """All object keys directly in ``folder``, paging past storage's 100 cap."""
    out: list[str] = []
    offset = 0
    while True:
        page = c.storage.from_(bucket).list(
            folder, {"limit": _PAGE, "offset": offset, "sortBy": {"column": "name", "order": "asc"}}
        ) or []
        out.extend(f"{folder}/{e['name']}" for e in page if e.get("name"))
        if len(page) < _PAGE:
            return out
        offset += _PAGE


def _legacy_pdf_key(raw: str, lid: str) -> str | None:
    """Storage key from a stored pdf_url, only if inside this lecture's folder."""
    if not raw:
        return None
    match = _PUBLIC_URL.search(raw)
    key = (match.group(1) if match else raw).split("?", 1)[0].split("#", 1)[0]
    if key.startswith(f"lectures/{lid}/"):
        return key
    logger.warning("erasure: skipping pdf_url outside lecture folder (lecture %s)", lid)
    return None


async def build_erasure_manifest(uid: str, client=None) -> ErasureManifest:
    """Every file and derived row to remove for ``uid``. Read-only.

    Raises ErasureError if any listing fails: a partial manifest would
    silently orphan whatever it missed.
    """
    c = _client(client)

    def _build() -> ErasureManifest:
        m = ErasureManifest(subject_id=uid)
        lectures: dict[str, dict[str, Any]] = {}
        for col in LECTURE_OWNER_COLUMNS:
            for row in _rows(c, "lectures", col, uid):
                lectures[row["id"]] = row
        m.lecture_ids = sorted(lectures)
        hashes = {r["pdf_hash"] for r in lectures.values() if r.get("pdf_hash")}
        # An upload that never became a lecture (failed/in-flight parse) still
        # left its blob in pdf-uploads; parse_runs is the only record of it.
        hashes |= {r["pdf_hash"] for r in _rows(c, "parse_runs", "user_id", uid) if r.get("pdf_hash")}
        m.pdf_upload_hashes = sorted(hashes)

        pdf_keys: set[str] = set()
        for lid, row in lectures.items():
            pdf_keys.update(_list_folder(c, "lecture-pdfs", f"lectures/{lid}"))
            legacy = _legacy_pdf_key(row.get("pdf_url") or "", lid)
            if legacy:
                pdf_keys.add(legacy)
        m.keys["lecture-pdfs"] = sorted(pdf_keys)
        m.keys["lecture-posters"] = [f"lectures/{lid}/poster.webp" for lid in m.lecture_ids]
        if m.lecture_ids:
            m.keys["worksheets"] = sorted(
                {r["file_url"] for r in _rows(c, "worksheets", "lecture_id", m.lecture_ids, many=True)
                 if r.get("file_url")}
            )
        m.keys["avatars"] = sorted(_list_folder(c, "avatars", uid))
        return m

    try:
        return await run_in_threadpool(_build)
    except Exception as e:
        raise ErasureError(f"could not build erasure manifest: {e}") from e


JOBS = "account_erasure_jobs"
MAX_ATTEMPTS = 12
STALE_AWAITING = timedelta(hours=1)
INCONCLUSIVE_STUCK = timedelta(days=7)
_CHUNK = 100
# user_id columns with NO foreign key to auth.users: the account delete never
# cascades them, so the executor deletes them explicitly. api_tokens and
# course_access exist only in production; a table absent there is skipped.
NO_FK_USER_TABLES = ("api_tokens", "course_access", "learning_events_daily_rollup", "tutor_messages")
# (table, jsonb column) pairs whose payload carries a user_id key but no FK.
JSONB_USER_TABLES = (("dead_letter_jobs", "kwargs"),)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ts(value: str) -> datetime:
    """Parse a stored timestamp; PostgREST may send a trailing 'Z'."""
    dt = datetime.fromisoformat(value.replace("Z", "+00:00") if value.endswith("Z") else value)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


async def create_job(m: ErasureManifest, client=None) -> str:
    c = _client(client)

    def _ins() -> str:
        row = {"subject_id": m.subject_id, "manifest": m.to_json(),
               "status": "awaiting_auth_delete", "created_at": _now(), "updated_at": _now()}
        return c.table(JOBS).insert(row).execute().data[0]["id"]

    try:
        return await run_in_threadpool(_ins)
    except Exception as e:
        raise ErasureError(f"could not record erasure job: {e}") from e


async def mark_ready(job_id: str, client=None) -> None:
    c = _client(client)
    await run_in_threadpool(
        lambda: c.table(JOBS).update({"status": "pending", "updated_at": _now()}).eq("id", job_id).execute()
    )


def _auth_user_exists(c, uid: str) -> bool | None:
    """True / False, or None when auth cannot answer."""
    try:
        c.auth.admin.get_user_by_id(uid)
        return True
    except AuthApiError as e:
        # Only the auth API's own structured answer proves the account is gone;
        # a proxy 404 or a DNS "host not found" must never look like that.
        return False if (e.status == 404 and e.code == "user_not_found") else None
    except Exception:
        return None


def _hash_still_referenced(c, pdf_hash: str) -> bool:
    # The subject's own lectures and parse_runs have cascaded away by now, so
    # any hit is another person's lecture or in-flight upload of the same file.
    for table in ("lectures", "parse_runs"):
        if c.table(table).select("pdf_hash").eq("pdf_hash", pdf_hash).limit(1).execute().data:
            return True
    return False


def _remove(c, bucket: str, keys: list[str]) -> None:
    for i in range(0, len(keys), _CHUNK):
        try:
            c.storage.from_(bucket).remove(keys[i:i + _CHUNK])
        except Exception as e:
            raise ErasureError(f"{bucket}: {e}") from e


def _execute(c, m: ErasureManifest) -> None:
    """Delete everything in the manifest. Raises on the first failure."""
    if _auth_user_exists(c, m.subject_id) is not False:
        raise ErasureError("account still exists (or auth unreachable); refusing to delete files")
    for bucket in BUCKETS:
        _remove(c, bucket, m.keys.get(bucket, []))
    _remove(c, "pdf-uploads",
            [f"{h}.pdf" for h in m.pdf_upload_hashes if not _hash_still_referenced(c, h)])
    for i in range(0, len(m.lecture_ids), _CHUNK):
        c.table("slide_embeddings").delete().in_("lecture_id", m.lecture_ids[i:i + _CHUNK]).execute()
    for table in NO_FK_USER_TABLES:  # no FK: never cascaded
        try:
            c.table(table).delete().eq("user_id", m.subject_id).execute()
        except Exception as e:
            # Only a table absent here (or tutor_messages without user_id, see
            # db_errors.USER_ID_OPTIONAL_TABLES) is skipped; anything else retries.
            if not is_tolerable_absence(e, table, "user_id"):
                raise ErasureError(f"{table}: {e}") from e
    # dead_letter_jobs keeps a failed job's kwargs (user_id, filename) as JSONB
    # with no FK column, so neither the cascade nor the loop above reaches it.
    for table, column in JSONB_USER_TABLES:
        try:
            c.table(table).delete().contains(column, {"user_id": m.subject_id}).execute()
        except Exception as e:
            if not is_tolerable_absence(e, table, column):
                raise ErasureError(f"{table}: {e}") from e


async def run_job(job_id: str, client=None) -> bool:
    c = _client(client)

    def _load() -> dict[str, Any] | None:
        rows = c.table(JOBS).select("*").eq("id", job_id).execute().data
        return rows[0] if rows else None

    def _record_failure(job: dict[str, Any], e: Exception) -> None:
        c.table(JOBS).update({
            "attempts": int(job.get("attempts") or 0) + 1,
            "last_error": str(e)[:500], "updated_at": _now(),
        }).eq("id", job_id).execute()

    job = await run_in_threadpool(_load)
    if job is None:
        return True
    m = ErasureManifest.from_json(job["manifest"])
    try:
        # Tutor conversations live in Redis, outside every DB cascade. Purged
        # first (idempotent) so a DB-side failure retries the whole thing.
        await chat_memory.purge_user_sessions(m.subject_id)
        await run_in_threadpool(_execute, c, m)
    except Exception as e:
        await run_in_threadpool(_record_failure, job, e)
        logger.error("erasure job %s not finished: %s", job_id, e)
        return False
    await run_in_threadpool(lambda: c.table(JOBS).delete().eq("id", job_id).execute())
    return True


async def drain(client=None, limit: int = 20) -> dict[str, int]:
    """Finish what an endpoint call could not. Called by the worker cron."""
    c = _client(client)
    out = {"finished": 0, "retrying": 0, "cancelled": 0, "stuck": 0}

    def _load():
        # Oldest-touched first; exhausted jobs never occupy a slot.
        live = (c.table(JOBS).select("*").lt("attempts", MAX_ATTEMPTS)
                .order("updated_at").limit(limit).execute().data or [])
        stuck = c.table(JOBS).select("id", count="exact").gte("attempts", MAX_ATTEMPTS).execute()
        return live, int(stuck.count or 0)

    rows, out["stuck"] = await run_in_threadpool(_load)
    if out["stuck"]:
        logger.error("%s erasure job(s) exceeded %s attempts; need a person", out["stuck"], MAX_ATTEMPTS)
    now = datetime.now(timezone.utc)
    for job in rows:
        if job["status"] == "awaiting_auth_delete":
            exists = await run_in_threadpool(_auth_user_exists, c, job["subject_id"])
            created = _ts(job["created_at"])
            if exists is True and created < now - STALE_AWAITING:
                # The auth delete never happened: the person still has an account.
                await run_in_threadpool(lambda j=job: c.table(JOBS).delete().eq("id", j["id"]).execute())
                out["cancelled"] += 1
                continue
            if exists is not False:
                # Too fresh, or auth unreachable: touch updated_at so it rotates
                # to the back of the oldest-first queue instead of starving it.
                await run_in_threadpool(lambda j=job: c.table(JOBS).update(
                    {"updated_at": _now()}).eq("id", j["id"]).execute())
                if exists is None and created < now - INCONCLUSIVE_STUCK:
                    out["stuck"] += 1
                    logger.error("erasure job %s: auth state inconclusive for over %s; needs a person",
                                 job["id"], INCONCLUSIVE_STUCK)
                continue
            await mark_ready(job["id"], client=c)
        out["finished" if await run_job(job["id"], client=c) else "retrying"] += 1
    return out
