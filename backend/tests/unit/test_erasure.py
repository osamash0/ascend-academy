# backend/tests/unit/test_erasure.py
"""Erasure: an exact manifest first, a durable job, then deletion that is
retried rather than swallowed."""
import pytest
from supabase_auth.errors import AuthApiError

from backend.services import erasure as er

UID = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"


class _Res:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


class FakeTable:
    def __init__(self, store, name):
        self.store, self.name, self.f, self.op, self.payload = store, name, [], "select", None

    def select(self, *_a, **_k):
        return self

    def eq(self, c, v):
        self.f.append(lambda r: r.get(c) == v)
        return self

    def lt(self, c, v):
        self.f.append(lambda r: (r.get(c) or 0) < v)
        return self

    def gte(self, c, v):
        self.f.append(lambda r: (r.get(c) or 0) >= v)
        return self

    def order(self, col):
        self.sort = col
        return self

    def limit(self, n):
        self.cap = n
        return self

    def in_(self, c, vs):
        self.f.append(lambda r: r.get(c) in vs)
        return self

    def insert(self, row):
        self.op, self.payload = "insert", row
        return self

    def update(self, patch):
        self.op, self.payload = "update", patch
        return self

    def delete(self):
        self.op = "delete"
        return self

    def execute(self):
        if self.name in self.store.fail_tables:
            raise RuntimeError(f"{self.name} unavailable")
        rows = self.store.tables.setdefault(self.name, [])
        hit = [r for r in rows if all(f(r) for f in self.f)]
        if self.op == "insert":
            row = {"id": f"job-{len(rows) + 1}", "attempts": 0, **self.payload}
            rows.append(row)
            return _Res([row])
        if self.op == "update":
            for r in hit:
                r.update(self.payload)
            return _Res(hit)
        if self.op == "delete":
            self.store.tables[self.name] = [r for r in rows if r not in hit]
            return _Res(hit)
        out = sorted(hit, key=lambda r: r.get(getattr(self, "sort", None) or "", ""))
        n = len(out)
        return _Res([dict(r) for r in out[:getattr(self, "cap", None)]], count=n)


class FakeBucket:
    def __init__(self, store, name):
        self.store, self.name = store, name

    def list(self, path, options=None):
        if self.name in self.store.fail_list:
            raise RuntimeError("list failed")
        opts = {"limit": 100, "offset": 0, **(options or {})}
        prefix = path.rstrip("/") + "/"
        names = [{"name": k[len(prefix):]} for k in self.store.objects.get(self.name, [])
                 if k.startswith(prefix) and "/" not in k[len(prefix):]]
        return names[opts["offset"]:opts["offset"] + min(opts["limit"], 100)]

    def remove(self, keys):
        if self.name in self.store.fail_remove:
            raise RuntimeError("remove failed")
        objs = self.store.objects.setdefault(self.name, [])
        self.store.objects[self.name] = [k for k in objs if k not in keys]
        self.store.removed.setdefault(self.name, []).extend(keys)
        return [{"name": k} for k in keys]


class FakeStorage:
    def __init__(self, store):
        self.store = store

    def from_(self, name):
        return FakeBucket(self.store, name)


class FakeAuthAdmin:
    def __init__(self, store):
        self.store = store

    def delete_user(self, uid):
        if self.store.fail_auth_delete:
            raise RuntimeError("auth down")
        self.store.auth_users.discard(uid)

    def get_user_by_id(self, uid):
        if uid not in self.store.auth_users:
            raise AuthApiError("User not found", 404, "user_not_found")
        return {"id": uid}


class FakeClient:
    def __init__(self, tables=None, objects=None):
        self.tables = tables or {}
        self.objects = objects or {}
        self.removed: dict[str, list[str]] = {}
        self.fail_tables: set[str] = set()
        self.fail_list: set[str] = set()
        self.fail_remove: set[str] = set()
        self.fail_auth_delete = False
        self.auth_users = {UID, OTHER}
        self.storage = FakeStorage(self)
        self.auth = type("A", (), {"admin": FakeAuthAdmin(self)})()

    def table(self, name):
        return FakeTable(self, name)


def owner_world():
    return FakeClient(
        tables={
            "lectures": [
                {"id": "L1", "professor_id": UID, "pdf_hash": "h-own", "pdf_url": "lectures/L1/a.pdf"},
                {"id": "L2", "student_owner_id": UID, "pdf_hash": "h-shared",
                 "pdf_url": "https://x/storage/v1/object/public/lecture-pdfs/lectures/L2/b.pdf"},
                {"id": "L9", "professor_id": OTHER, "pdf_hash": "h-shared"},
            ],
            "worksheets": [{"lecture_id": "L1", "file_url": "w/ws1.pdf"}],
        },
        objects={
            "avatars": [f"{UID}/avatar-1.png", f"{OTHER}/avatar-2.png"],
            "lecture-pdfs": ["lectures/L1/a.pdf", "lectures/L2/b.pdf", "lectures/L9/c.pdf"],
            "lecture-posters": ["lectures/L1/poster.webp"],
            "pdf-uploads": ["h-own.pdf", "h-shared.pdf"],
            "worksheets": ["w/ws1.pdf"],
        },
    )


@pytest.mark.asyncio
async def test_manifest_lists_every_bucket_for_the_user_only():
    c = owner_world()
    m = await er.build_erasure_manifest(UID, client=c)
    assert sorted(m.lecture_ids) == ["L1", "L2"]
    assert m.keys["avatars"] == [f"{UID}/avatar-1.png"]
    assert sorted(m.keys["lecture-pdfs"]) == ["lectures/L1/a.pdf", "lectures/L2/b.pdf"]
    assert sorted(m.keys["lecture-posters"]) == ["lectures/L1/poster.webp", "lectures/L2/poster.webp"]
    assert m.keys["worksheets"] == ["w/ws1.pdf"]
    assert sorted(m.pdf_upload_hashes) == ["h-own", "h-shared"]


@pytest.mark.asyncio
async def test_manifest_is_all_or_nothing():
    c = owner_world()
    c.fail_list.add("avatars")
    with pytest.raises(er.ErasureError):
        await er.build_erasure_manifest(UID, client=c)


@pytest.mark.asyncio
async def test_manifest_round_trips_through_json():
    m = await er.build_erasure_manifest(UID, client=owner_world())
    assert er.ErasureManifest.from_json(m.to_json()) == m


@pytest.mark.asyncio
async def test_manifest_pages_past_the_100_entry_listing_cap():
    c = owner_world()
    many = [f"{UID}/a-{i:03d}.png" for i in range(250)]
    c.objects["avatars"] = many + [f"{OTHER}/x.png"]
    m = await er.build_erasure_manifest(UID, client=c)
    assert sorted(m.keys["avatars"]) == sorted(many)


@pytest.mark.asyncio
async def test_legacy_pdf_url_strips_query_and_fragment():
    c = owner_world()
    c.tables["lectures"][1]["pdf_url"] = (
        "https://x/storage/v1/object/public/lecture-pdfs/lectures/L2/b.pdf?token=abc#p1")
    c.objects["lecture-pdfs"] = []
    m = await er.build_erasure_manifest(UID, client=c)
    assert "lectures/L2/b.pdf" in m.keys["lecture-pdfs"]


@pytest.mark.asyncio
async def test_pdf_url_outside_the_lectures_folder_is_skipped():
    c = owner_world()
    c.tables["lectures"][0]["pdf_url"] = "lectures/L9/c.pdf"
    c.tables["lectures"][1]["pdf_url"] = None
    c.objects["lecture-pdfs"] = []
    m = await er.build_erasure_manifest(UID, client=c)
    assert m.keys["lecture-pdfs"] == []


@pytest.mark.asyncio
async def test_job_runs_after_auth_delete_and_spares_shared_blobs():
    c = owner_world()
    m = await er.build_erasure_manifest(UID, client=c)
    job = await er.create_job(m, client=c)
    # Simulate the auth cascade: the person's lectures are gone, OTHER's stays.
    c.tables["lectures"] = [r for r in c.tables["lectures"] if r["id"] == "L9"]
    c.auth_users.discard(UID)
    await er.mark_ready(job, client=c)
    assert await er.run_job(job, client=c) is True
    assert c.objects["pdf-uploads"] == ["h-shared.pdf"]          # shared: kept
    assert c.objects["lecture-pdfs"] == ["lectures/L9/c.pdf"]    # other's: kept
    assert c.objects["avatars"] == [f"{OTHER}/avatar-2.png"]
    assert c.tables[er.JOBS] == []                                # done: row gone


@pytest.mark.asyncio
async def test_failed_delete_leaves_job_pending_with_error():
    c = owner_world()
    job = await er.create_job(await er.build_erasure_manifest(UID, client=c), client=c)
    c.auth_users.discard(UID)
    await er.mark_ready(job, client=c)
    c.fail_remove.add("avatars")
    assert await er.run_job(job, client=c) is False
    row = c.tables[er.JOBS][0]
    assert row["status"] == "pending" and row["attempts"] == 1
    assert "avatars" in row["last_error"]
    c.fail_remove.clear()
    assert await er.run_job(job, client=c) is True                # a retry finishes it


@pytest.mark.asyncio
async def test_run_job_refuses_while_account_still_exists():
    c = owner_world()
    job = await er.create_job(await er.build_erasure_manifest(UID, client=c), client=c)
    await er.mark_ready(job, client=c)                            # wrongly marked
    assert await er.run_job(job, client=c) is False
    assert "still exists" in c.tables[er.JOBS][0]["last_error"]
    assert c.removed == {}                                        # nothing deleted


@pytest.mark.asyncio
async def test_drain_resolves_awaiting_jobs_by_auth_state():
    c = owner_world()
    await er.create_job(await er.build_erasure_manifest(UID, client=c), client=c)
    await er.create_job(er.ErasureManifest(subject_id=OTHER), client=c)
    c.tables[er.JOBS][1]["created_at"] = "2000-01-01T00:00:00+00:00"   # auth delete never landed
    c.auth_users.discard(UID)
    c.tables["lectures"] = [r for r in c.tables["lectures"] if r["id"] == "L9"]
    out = await er.drain(client=c)
    assert out == {"finished": 1, "retrying": 0, "cancelled": 1, "stuck": 0}
    assert c.tables[er.JOBS] == []


@pytest.mark.asyncio
async def test_executor_deletes_rows_of_every_no_fk_user_table():
    assert set(er.NO_FK_USER_TABLES) >= {"api_tokens", "course_access", "learning_events_daily_rollup"}
    c = owner_world()
    for t in er.NO_FK_USER_TABLES:
        c.tables[t] = [{"user_id": UID}, {"user_id": OTHER}]
    job = await er.create_job(await er.build_erasure_manifest(UID, client=c), client=c)
    c.auth_users.discard(UID)
    await er.mark_ready(job, client=c)
    assert await er.run_job(job, client=c) is True
    for t in er.NO_FK_USER_TABLES:
        assert c.tables[t] == [{"user_id": OTHER}], t


def _fresh_pending(c, **extra):
    return c.tables.setdefault(er.JOBS, []).append(
        {"id": f"x{len(c.tables.get(er.JOBS, []))}", "subject_id": OTHER, "status": "pending",
         "manifest": er.ErasureManifest(subject_id=OTHER).to_json(), "attempts": 0,
         "updated_at": "2026-01-01T00:00:00+00:00", **extra})


@pytest.mark.asyncio
async def test_exhausted_jobs_do_not_starve_a_fresh_one():
    c = owner_world()
    c.auth_users.discard(OTHER)
    for i in range(5):
        _fresh_pending(c, attempts=er.MAX_ATTEMPTS, updated_at=f"2000-01-0{i + 1}T00:00:00+00:00")
    _fresh_pending(c)
    out = await er.drain(client=c, limit=3)
    assert out["finished"] == 1 and out["stuck"] == 5
    assert len(c.tables[er.JOBS]) == 5


@pytest.mark.asyncio
async def test_generic_404_text_is_not_proof_the_account_is_gone():
    c = owner_world()

    def boom(uid):
        raise Exception("404 Not Found: host not found")

    c.auth.admin.get_user_by_id = boom
    assert er._auth_user_exists(c, UID) is None
    job = await er.create_job(await er.build_erasure_manifest(UID, client=c), client=c)
    await er.mark_ready(job, client=c)
    assert await er.run_job(job, client=c) is False
    assert c.removed == {}


def test_structured_not_found_means_gone_other_auth_errors_inconclusive():
    c = owner_world()
    c.auth_users.discard(UID)
    assert er._auth_user_exists(c, UID) is False
    assert er._auth_user_exists(c, OTHER) is True

    def boom(uid):
        raise AuthApiError("bad gateway", 502, None)

    c.auth.admin.get_user_by_id = boom
    assert er._auth_user_exists(c, OTHER) is None


@pytest.mark.asyncio
async def test_drain_skips_fresh_awaiting_and_unreachable_auth():
    c = owner_world()
    await er.create_job(await er.build_erasure_manifest(UID, client=c), client=c)   # fresh, account alive
    assert await er.drain(client=c) == {"finished": 0, "retrying": 0, "cancelled": 0, "stuck": 0}
    c.tables[er.JOBS][0]["created_at"] = "2000-01-01T00:00:00+00:00"                 # stale, but auth down
    c.auth.admin.get_user_by_id = lambda uid: (_ for _ in ()).throw(Exception("timeout"))
    assert await er.drain(client=c) == {"finished": 0, "retrying": 0, "cancelled": 0, "stuck": 0}
    assert len(c.tables[er.JOBS]) == 1 and c.removed == {}
