"""Unit tests for backend.services.account_service (S-2 GDPR export/erasure).

The real Supabase client is replaced with a small in-memory fake that mimics
the PostgREST-style `.table(x).select().eq().execute()` chain and the
Storage `.storage.from_(bucket).remove([...])` call — these tests verify the
*decision logic* (which rows are exported, which blobs are safe to delete
given content-addressed dedup, which worksheet exception applies), not the
real database, which is covered separately by the real-Postgres cascade
tests in backend/tests/db/test_gdpr_erasure_cascade.py.
"""
from __future__ import annotations

import pytest

from backend.services import account_service


class _Result:
    def __init__(self, data):
        self.data = data


class _Storage:
    def __init__(self):
        self.removed: dict[str, list[str]] = {}

    def from_(self, bucket):
        outer = self

        class _Bucket:
            @staticmethod
            def remove(paths):
                outer.removed.setdefault(bucket, []).extend(paths)

        return _Bucket()


class FakeSupabaseAdmin:
    def __init__(self, tables: dict[str, list[dict]]):
        self._tables = {k: list(v) for k, v in tables.items()}
        self.storage = _Storage()
        self.deleted: dict[str, list] = {}

    def table(self, name):
        rows = self._tables.get(name, [])

        class _T:
            def __init__(self, outer, rows, name):
                self._outer = outer
                self._rows = rows
                self._name = name
                self._pending_filter = None

            def select(self, _cols="*"):
                return self

            def eq(self, col, val):
                self._pending_filter = ("eq", col, val)
                return self

            def in_(self, col, values):
                self._pending_filter = ("in", col, values)
                return self

            def delete(self):
                self._pending_delete = True
                return self

            def execute(self):
                rows = self._rows
                if self._pending_filter:
                    kind, col, val = self._pending_filter
                    if kind == "eq":
                        rows = [r for r in rows if r.get(col) == val]
                    else:
                        rows = [r for r in rows if r.get(col) in val]
                if getattr(self, "_pending_delete", False):
                    self._outer.deleted.setdefault(self._name, []).extend(rows)
                    remaining = [r for r in self._tables_ref() if r not in rows]
                    self._tables_ref()[:] = remaining
                return _Result(list(rows))

            def _tables_ref(self):
                return self._outer._tables[self._name]

        return _T(self, rows, name)


@pytest.fixture
def patch_admin(monkeypatch):
    def _patch(tables: dict[str, list[dict]]):
        fake = FakeSupabaseAdmin(tables)
        monkeypatch.setattr(account_service, "supabase_admin", fake)
        return fake

    return _patch


UID = "11111111-1111-1111-1111-111111111111"
OTHER_UID = "22222222-2222-2222-2222-222222222222"


@pytest.mark.asyncio
async def test_export_user_data_scopes_every_table_to_uid(patch_admin):
    tables = {
        "profiles": [{"user_id": UID, "email": "a@b.com"}, {"user_id": OTHER_UID, "email": "x@y.com"}],
        "achievements": [{"user_id": UID, "badge": "first_upload"}],
        "lectures": [{"id": "lec-1", "professor_id": UID}, {"id": "lec-2", "professor_id": OTHER_UID}],
        "worksheets": [{"id": "w-1", "uploaded_by": UID}],
    }
    patch_admin(tables)

    result = await account_service.export_user_data(UID)

    assert result["user_id"] == UID
    assert "exported_at" in result
    assert result["profiles"] == [{"user_id": UID, "email": "a@b.com"}]
    assert result["achievements"] == [{"user_id": UID, "badge": "first_upload"}]
    assert result["lectures"] == [{"id": "lec-1", "professor_id": UID}]
    assert result["worksheets_uploaded"] == [{"id": "w-1", "uploaded_by": UID}]


@pytest.mark.asyncio
async def test_export_user_data_skips_missing_table_without_raising(patch_admin, monkeypatch):
    patch_admin({})

    # Simulate a table that doesn't exist in this environment by making
    # .execute() raise, mirroring a real PostgREST 404/undefined-table error.
    class _Boom:
        def table(self, _name):
            raise RuntimeError("relation does not exist")

    monkeypatch.setattr(account_service, "supabase_admin", _Boom())

    result = await account_service.export_user_data(UID)
    assert result["profiles"] == []
    assert result["user_id"] == UID


@pytest.mark.asyncio
async def test_erase_user_storage_deletes_own_slide_embeddings(patch_admin):
    tables = {
        "lectures": [{"id": "lec-1", "professor_id": UID, "student_owner_id": None, "pdf_hash": None}],
        "slide_embeddings": [
            {"id": "se-1", "lecture_id": "lec-1"},
            {"id": "se-2", "lecture_id": "lec-other"},
        ],
        "worksheets": [],
    }
    fake = patch_admin(tables)

    summary = await account_service.erase_user_storage_and_derived_data(UID)

    assert summary["slide_embeddings_deleted"] == 1
    assert fake.deleted["slide_embeddings"] == [{"id": "se-1", "lecture_id": "lec-1"}]


@pytest.mark.asyncio
async def test_erase_user_storage_retains_shared_pdf_hash_blob(patch_admin):
    """Content-addressed dedup safety: a pdf_hash still referenced by another
    user's lecture must NOT be deleted from storage."""
    tables = {
        "lectures": [
            {"id": "lec-1", "professor_id": UID, "student_owner_id": None, "pdf_hash": "shared-hash"},
            {"id": "lec-2", "professor_id": OTHER_UID, "student_owner_id": None, "pdf_hash": "shared-hash"},
        ],
        "slide_embeddings": [],
        "worksheets": [],
    }
    fake = patch_admin(tables)

    summary = await account_service.erase_user_storage_and_derived_data(UID)

    assert summary["pdf_blobs_deleted"] == 0
    assert summary["pdf_blobs_retained_shared"] == 1
    assert "pdf-uploads" not in fake.storage.removed


@pytest.mark.asyncio
async def test_erase_user_storage_deletes_unshared_pdf_hash_blob(patch_admin):
    tables = {
        "lectures": [{"id": "lec-1", "professor_id": UID, "student_owner_id": None, "pdf_hash": "solo-hash"}],
        "slide_embeddings": [],
        "worksheets": [],
    }
    fake = patch_admin(tables)

    summary = await account_service.erase_user_storage_and_derived_data(UID)

    assert summary["pdf_blobs_deleted"] == 1
    assert summary["pdf_blobs_retained_shared"] == 0
    assert fake.storage.removed["pdf-uploads"] == ["solo-hash.pdf"]


@pytest.mark.asyncio
async def test_erase_user_storage_deletes_worksheet_files_for_owned_lectures(patch_admin):
    tables = {
        "lectures": [{"id": "lec-1", "professor_id": UID, "student_owner_id": None, "pdf_hash": None}],
        "slide_embeddings": [],
        "worksheets": [{"lecture_id": "lec-1", "file_url": "worksheets/lec-1/sheet.pdf"}],
    }
    fake = patch_admin(tables)

    summary = await account_service.erase_user_storage_and_derived_data(UID)

    assert summary["worksheet_files_deleted"] == 1
    assert fake.storage.removed["worksheets"] == ["worksheets/lec-1/sheet.pdf"]


@pytest.mark.asyncio
async def test_erase_user_storage_is_noop_when_user_owns_nothing(patch_admin):
    fake = patch_admin({"lectures": [], "slide_embeddings": [], "worksheets": []})

    summary = await account_service.erase_user_storage_and_derived_data(UID)

    assert summary == {
        "pdf_blobs_deleted": 0,
        "pdf_blobs_retained_shared": 0,
        "worksheet_files_deleted": 0,
        "slide_embeddings_deleted": 0,
    }
    assert fake.storage.removed == {}
