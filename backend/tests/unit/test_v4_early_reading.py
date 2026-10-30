import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.v1 import v4_spaces
from backend.core.auth_middleware import require_student
from backend.core.rate_limit import limiter
from backend.services.v4_spaces_service import reading_view


def run(**over):
    base = {"status": "running", "page_count": 82, "lecture_id": None}
    base.update(over)
    return base


def test_a_fresh_run_can_be_read_with_nothing_done_yet():
    v = reading_view(run(), [], False, "https://signed/x.pdf")
    assert v == {
        "pdfUrl": "https://signed/x.pdf",
        "pages": 82,
        "pagesRead": 0,
        "pagesReady": [],
        "practiceReady": False,
        "readable": False,
        "stage": "developing",
        "lessonId": None,
    }


def test_pages_luna_has_written_are_listed_in_order_and_make_it_readable():
    v = reading_view(run(lecture_id="L1"), [3, 1, 2], False, "u")
    assert v["pagesReady"] == [1, 2, 3]
    assert v["pagesRead"] == 3
    assert v["readable"] is True
    assert v["stage"] == "developing"


def test_a_lesson_row_without_pages_is_not_readable_yet():
    assert reading_view(run(lecture_id="L1"), [], False, "u")["readable"] is False


def test_progress_never_exceeds_the_page_count():
    assert reading_view(run(page_count=2, lecture_id="L1"), [1, 2, 3], False, "u")["pagesRead"] == 2


def test_a_finished_run_is_ready_and_fully_read():
    v = reading_view(run(status="completed", lecture_id="L1", page_count=4), [1, 2], True, "u")
    assert v["stage"] == "ready" and v["lessonId"] == "L1"
    assert v["pagesReady"] == [1, 2, 3, 4] and v["pagesRead"] == 4
    assert v["practiceReady"] is True and v["readable"] is True


def test_a_failed_run_keeps_what_was_read():
    v = reading_view(run(status="failed", lecture_id="L1"), [1, 2], False, "u")
    assert v["stage"] == "failed" and v["pagesReady"] == [1, 2] and v["readable"] is True


def test_a_finished_run_without_a_page_count_is_read_from_its_slides():
    v = reading_view(run(status="completed", lecture_id="L1", page_count=None), [2, 1, 3], True, "u")
    assert v["stage"] == "ready"
    assert v["pagesReady"] == [1, 2, 3] and v["pagesRead"] == 3
    assert v["readable"] is True
    v0 = reading_view(run(status="completed", lecture_id="L1", page_count=0), [1], False, "u")
    assert v0["pagesReady"] == [1] and v0["readable"] is True


def test_unknown_page_count_reads_as_zero():
    assert reading_view(run(page_count=None), [], False, "u")["pages"] == 0


# ── The route: your own run only ─────────────────────────────────────────────

ME = "22222222-2222-4222-8222-222222222222"
OTHER = "44444444-4444-4444-8444-444444444444"
MINE = "11111111-1111-4111-8111-111111111111"


class _Conn:
    """parse_runs holding one run, MINE, owned by `owner`; no database."""

    def __init__(self, owner):
        self.owner = owner
        self.asked = []

    async def fetchrow(self, sql, run_id, user_id):
        self.asked.append(sql)
        if str(run_id) == MINE and str(user_id) == self.owner:
            return {"status": "running", "page_count": 10, "lecture_id": None, "pdf_hash": "h"}
        return None

    async def fetch(self, *a):
        return []

    async def fetchval(self, *a):
        return False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


@pytest.fixture
def client_for(monkeypatch):
    from backend.services import v4_reader_service

    def make(owner):
        conn = _Conn(owner)

        async def get_db_connection():
            return conn

        async def signed(path, bucket):
            return f"https://signed/{bucket}/{path}"

        monkeypatch.setattr(v4_spaces.service, "get_db_connection", get_db_connection)
        monkeypatch.setattr(v4_reader_service, "signed_pdf_url", signed)
        monkeypatch.setattr(v4_spaces.settings, "feature_student_uploads", True)
        app = FastAPI()
        app.state.limiter = limiter
        app.include_router(v4_spaces.router, prefix="/api/v1")
        app.dependency_overrides[require_student] = lambda: {"id": ME}
        return TestClient(app), conn

    return make


def test_your_own_run_can_be_read(client_for):
    client, conn = client_for(ME)
    res = client.get(f"/api/v1/v4/uploads/{MINE}/reading")
    assert res.status_code == 200
    assert res.json()["pdfUrl"] == "https://signed/pdf-uploads/h.pdf"
    assert "user_id = $2" in conn.asked[0]


def test_someone_elses_run_is_not_found(client_for):
    client, _ = client_for(OTHER)
    res = client.get(f"/api/v1/v4/uploads/{MINE}/reading")
    assert res.status_code == 404


def test_an_unknown_run_is_not_found(client_for):
    client, _ = client_for(ME)
    res = client.get(f"/api/v1/v4/uploads/{uuid.uuid4()}/reading")
    assert res.status_code == 404


# ── The shelf: an upload is readable once its Lesson has pages ───────────────


async def test_the_shelf_marks_an_upload_readable_once_it_has_pages(monkeypatch):
    from backend.services import v4_spaces_service as svc

    async def mine(user_id):
        return [
            {"run_id": "r1", "lecture_id": "L1", "status": "running", "filename": "a.pdf", "title": None,
             "total_slides": 0, "slide_count": 8, "created_at": "2026-10-29T10:00:00Z"},
            {"run_id": "r2", "lecture_id": "L2", "status": "running", "filename": "b.pdf", "title": None,
             "total_slides": 0, "slide_count": 0, "created_at": "2026-10-29T09:00:00Z"},
        ]

    class _Empty:
        async def fetch(self, *a):
            return []

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

    async def conn():
        return _Empty()

    monkeypatch.setattr(svc.materials_service, "list_my_materials", mine)
    monkeypatch.setattr(svc, "get_db_connection", conn)
    out = {u["id"]: u for u in await svc.uploads_for("u")}
    assert out["r1"]["readable"] is True and out["r1"]["stage"] == "developing"
    assert out["r2"]["readable"] is False
