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
    v = reading_view(run(), 0, "https://signed/x.pdf")
    assert v == {"pdfUrl": "https://signed/x.pdf", "pages": 82, "pagesRead": 0, "stage": "developing", "lessonId": None}


def test_progress_never_exceeds_the_page_count():
    assert reading_view(run(), 999, "u")["pagesRead"] == 82


def test_a_finished_run_is_ready_and_fully_read():
    v = reading_view(run(status="completed", lecture_id="L1"), 80, "u")
    assert v["stage"] == "ready" and v["lessonId"] == "L1" and v["pagesRead"] == 82


def test_a_failed_run_says_so():
    assert reading_view(run(status="failed"), 3, "u")["stage"] == "failed"


def test_unknown_page_count_reads_as_zero():
    assert reading_view(run(page_count=None), 4, "u")["pages"] == 0


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

    async def fetchval(self, *a):
        return 0

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
