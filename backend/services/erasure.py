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
a blob is removed only if no remaining lecture references its hash,
checked at execution time, after the person's own lectures have cascaded away.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any

from fastapi.concurrency import run_in_threadpool

from backend.core.database import supabase_admin

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
    q = c.table(table).select("*")
    q = q.in_(column, value) if many else q.eq(column, value)
    return q.execute().data or []


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
        m.pdf_upload_hashes = sorted({r["pdf_hash"] for r in lectures.values() if r.get("pdf_hash")})

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
