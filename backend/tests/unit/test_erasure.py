# backend/tests/unit/test_erasure.py
"""Erasure: an exact manifest first, a durable job, then deletion that is
retried rather than swallowed."""
import pytest

from backend.services import erasure as er

UID = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"


class _Res:
    def __init__(self, data):
        self.data = data


class FakeTable:
    def __init__(self, store, name):
        self.store, self.name, self.f, self.op, self.payload = store, name, [], "select", None

    def select(self, *_a, **_k):
        return self

    def eq(self, c, v):
        self.f.append(lambda r: r.get(c) == v)
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
        return _Res([dict(r) for r in hit])


class FakeBucket:
    def __init__(self, store, name):
        self.store, self.name = store, name

    def list(self, path):
        if self.name in self.store.fail_list:
            raise RuntimeError("list failed")
        prefix = path.rstrip("/") + "/"
        return [{"name": k[len(prefix):]} for k in self.store.objects.get(self.name, [])
                if k.startswith(prefix) and "/" not in k[len(prefix):]]

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
            raise RuntimeError("User not found (404)")
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
