from __future__ import annotations

import asyncio

import pytest

from backend.services import studio_pages_service as svc


ROWS = [
    {"page": 1, "width": 720.0, "height": 405.0, "image_path": "lectures/L/p1.webp", "geometry": "block",
     "blocks": [{"id": "p1-b0", "page": 1, "bbox": [0.1, 0.1, 0.9, 0.2], "kind": "heading",
                 "text": "FDs", "readingOrder": 0}],
     "summary": [{"markdown": "**FDs** first.", "covers": ["p1-b0"]},
                 {"markdown": "Then keys.", "covers": []}],
     "status": "ready"},
    {"page": 2, "width": 720.0, "height": 405.0, "image_path": "lectures/L/p2.webp", "geometry": "page",
     "blocks": [], "summary": [], "status": "needs_review"},
]


def test_shape_matches_studio_types():
    signed = {"lectures/L/p1.webp": "https://s/1", "lectures/L/p2.webp": "https://s/2"}
    out = svc.shape_pages("L", ROWS, signed)
    assert out["materialId"] == "L"
    assert out["pages"][0] == {"materialId": "L", "page": 1, "width": 720.0, "height": 405.0,
                               "imageUrl": "https://s/1", "geometry": "block", "blocks": ROWS[0]["blocks"]}
    assert out["pages"][1]["blocks"] == [] and out["pages"][1]["geometry"] == "page"
    assert out["summaries"] == [
        {"id": "s-p1-1", "origin": "summary", "markdown": "**FDs** first.",
         "source": {"materialId": "L", "page": 1, "blockIds": ["p1-b0"]}, "gist": True, "edited": False},
        {"id": "s-p1-2", "origin": "summary", "markdown": "Then keys.",
         "source": {"materialId": "L", "page": 1, "blockIds": []}, "gist": False, "edited": False},
    ]


def test_stage_mapping():
    assert svc.stage_of("pending") == "developing"
    assert svc.stage_of("running") == "developing"
    assert svc.stage_of("completed") == "ready"
    assert svc.stage_of("failed") == "failed"
    assert svc.stage_of("cancelled") == "failed"
    assert svc.stage_of(None) == "developing"


LID = "00000000-0000-0000-0000-000000000001"


@pytest.fixture
def flag_on(monkeypatch):
    from backend.core.config import settings

    monkeypatch.setattr(settings, "feature_studio_pages", True)


def _wire(monkeypatch, *, visible=True, run=None, total=0, rows=ROWS, signed=None):
    """Mock every DB/storage touch of get_pages; record which ones ran."""
    calls = []

    async def can_view(lid, uid):
        calls.append("can_view")
        return visible

    async def run_status(lid):
        calls.append("run_status")
        return run

    async def total_pages(lid):
        calls.append("total_pages")
        return total

    async def fetch_rows(lid):
        calls.append("rows")
        return rows

    async def sign(paths):
        calls.append("sign")
        return signed if signed is not None else {p: f"https://signed/{p}" for p in paths}

    monkeypatch.setattr(svc, "can_view_lecture", can_view)
    monkeypatch.setattr(svc, "_latest_run_status", run_status)
    monkeypatch.setattr(svc, "_total_pages", total_pages)
    monkeypatch.setattr(svc, "_rows", fetch_rows)
    monkeypatch.setattr(svc, "_sign", sign)
    return calls


def _get():
    return asyncio.run(svc.get_pages(LID, "u"))


def test_get_pages_404_when_not_visible(monkeypatch, flag_on):
    _wire(monkeypatch, visible=False, run="completed")
    with pytest.raises(svc.NotVisible):
        _get()


def test_get_pages_404_when_flag_off_even_for_a_reader(monkeypatch):
    from backend.core.config import settings

    monkeypatch.setattr(settings, "feature_studio_pages", False)
    calls = _wire(monkeypatch, run="completed")
    with pytest.raises(svc.NotVisible):
        _get()
    # Auth runs first (same 404 either way), then nothing touches lecture_pages.
    assert calls == ["can_view"]


def test_get_pages_409_while_the_run_is_working(monkeypatch, flag_on):
    for status in ("pending", "queued", "extracting", "analyzing", "finalizing", "running"):
        _wire(monkeypatch, run=status, total=12)
        with pytest.raises(svc.StillDeveloping):
            _get()


def test_get_pages_404_for_a_failed_run_even_with_partial_rows(monkeypatch, flag_on):
    # A failed parse finalizes total_slides > 0 and may leave some page rows.
    for status in ("failed", "cancelled"):
        _wire(monkeypatch, run=status, total=2, rows=ROWS[:1])
        with pytest.raises(svc.NotVisible):
            _get()


def test_get_pages_200_for_a_completed_run(monkeypatch, flag_on):
    calls = _wire(monkeypatch, run="completed", total=0)
    out = _get()
    assert [p["page"] for p in out["pages"]] == [1, 2]
    assert "total_pages" not in calls, "a run row decides; total_slides is only the legacy fallback"


def test_get_pages_legacy_lecture_without_run_falls_back_to_total_slides(monkeypatch, flag_on):
    _wire(monkeypatch, run=None, total=2)
    assert [p["page"] for p in _get()["pages"]] == [1, 2]
    _wire(monkeypatch, run=None, total=0)
    with pytest.raises(svc.StillDeveloping):
        _get()


def test_get_pages_404_without_studio_pages(monkeypatch, flag_on):
    _wire(monkeypatch, run="completed", rows=[])
    with pytest.raises(svc.NotVisible):
        _get()


def test_get_pages_404_when_pages_are_not_contiguous(monkeypatch, flag_on, caplog):
    gap = [ROWS[0], {**ROWS[1], "page": 3}]
    _wire(monkeypatch, run="completed", rows=gap)
    with caplog.at_level("WARNING"):
        with pytest.raises(svc.NotVisible):
            _get()
    assert "contiguous" in caplog.text
    not_from_one = [{**ROWS[0], "page": 2}, {**ROWS[1], "page": 3}]
    _wire(monkeypatch, run="completed", rows=not_from_one)
    with pytest.raises(svc.NotVisible):
        _get()


def test_get_pages_signs_every_picture(monkeypatch, flag_on):
    _wire(monkeypatch, run="completed")
    out = _get()
    assert [p["imageUrl"] for p in out["pages"]] == [
        "https://signed/lectures/L/p1.webp", "https://signed/lectures/L/p2.webp"]


def test_sign_warns_when_some_paths_come_back_unsigned(monkeypatch, caplog):
    import backend.core.database as database

    class _Bucket:
        def create_signed_urls(self, paths, ttl):
            return [{"path": paths[0], "signedURL": "https://s/1", "error": None},
                    {"path": paths[1], "signedURL": None, "error": "Object not found"}]

    class _Storage:
        def from_(self, bucket):
            return _Bucket()

    monkeypatch.setattr(database, "supabase_admin", type("A", (), {"storage": _Storage()})())
    with caplog.at_level("WARNING"):
        out = asyncio.run(svc._sign(["a.webp", "b.webp"]))
    assert out == {"a.webp": "https://s/1"}
    assert "1 of 2" in caplog.text


def _route_client(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from backend.api.v1.material_pages import router
    from backend.core.auth_middleware import verify_token
    from backend.core.rate_limit import limiter

    app = FastAPI()
    app.state.limiter = limiter
    app.include_router(router)
    app.dependency_overrides[verify_token] = lambda: {"id": "u"}
    monkeypatch.setattr(limiter, "enabled", False)
    return TestClient(app, raise_server_exceptions=False)


def test_route_bad_uuid_is_404_without_touching_the_service(monkeypatch):
    called = []

    async def get_pages(lid, uid):
        called.append(lid)
        return {}

    monkeypatch.setattr(svc, "get_pages", get_pages)
    res = _route_client(monkeypatch).get("/materials/not-a-uuid/pages")
    assert res.status_code == 404
    assert called == []


def test_route_data_errors_surface_as_500(monkeypatch):
    async def get_pages(lid, uid):
        raise ValueError("bad jsonb in lecture_pages")

    monkeypatch.setattr(svc, "get_pages", get_pages)
    res = _route_client(monkeypatch).get(f"/materials/{LID}/pages")
    assert res.status_code == 500


def test_route_maps_service_states(monkeypatch):
    async def developing(lid, uid):
        raise svc.StillDeveloping()

    async def hidden(lid, uid):
        raise svc.NotVisible()

    client = _route_client(monkeypatch)
    monkeypatch.setattr(svc, "get_pages", developing)
    assert client.get(f"/materials/{LID}/pages").status_code == 409
    monkeypatch.setattr(svc, "get_pages", hidden)
    assert client.get(f"/materials/{LID}/pages").status_code == 404


def _paths(**flags):
    from types import SimpleNamespace

    from fastapi import APIRouter

    from backend.api.v1.material_pages import mount_materials_routers

    parent = APIRouter()
    mount_materials_routers(parent, SimpleNamespace(
        feature_student_uploads=flags.get("uploads", False),
        feature_studio_pages=flags.get("pages", False)))
    return [(r.path, tuple(sorted(r.methods))) for r in parent.routes]


PAGES = ("/materials/{lecture_id}/pages", ("GET",))


def test_pages_route_mounted_with_only_studio_pages_flag():
    paths = _paths(pages=True)
    assert PAGES in paths
    assert not any(p == "/materials/quota" for p, _ in paths)


def test_pages_route_absent_with_both_flags_off():
    assert _paths() == []


def test_both_routers_coexist_with_uploads_on():
    paths = _paths(uploads=True)
    assert PAGES in paths
    assert ("/materials/quota", ("GET",)) in paths
    assert ("/materials/{lecture_id}", ("DELETE",)) in paths
    assert paths.count(PAGES) == 1
