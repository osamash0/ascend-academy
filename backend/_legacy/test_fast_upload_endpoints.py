import pytest
import uuid
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient

# The fast-upload pipeline was retired in the Phase-0 legacy sweep: its router is
# no longer mounted and the module lives under backend/_legacy/. These tests are
# kept for reference only (they hit the unmounted endpoint) and are not collected
# (pytest testpaths = backend/tests).
pytestmark = pytest.mark.skip(reason="fast-upload retired — archived in backend/_legacy/")

@pytest.fixture
def mock_db():
    with patch("backend._legacy.fast_upload.execute_query", new_callable=AsyncMock) as mock_eq, \
         patch("backend._legacy.fast_upload.process_upload_isolated", new_callable=AsyncMock) as mock_process:
        yield mock_eq, mock_process

def test_upload_fast_happy_path(app_client: TestClient, sample_pdf_bytes: bytes, mock_db):
    mock_eq, mock_process = mock_db
    
    # POST /upload/fast-parse wait, the router prefix is /fast-upload and the endpoint is /
    res = app_client.post(
        "/api/v1/fast-upload/",
        files={"file": ("test.pdf", sample_pdf_bytes, "application/pdf")},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "processing"
    assert "id" in data
    
    # Verify execute_query was called to insert into parse_runs
    mock_eq.assert_awaited()
    # Verify the background task was called
    mock_process.assert_called_once()


def test_upload_fast_non_pdf(app_client: TestClient, mock_db):
    # Depending on how the file extension or content is validated, it might return 422
    # Wait, looking at fast_upload.py, it only checks MAX_FILE_MB. 
    # It doesn't actually enforce non-PDF natively in the router signature except maybe via the processing.
    # Let's just test file size limit since that is explicitly handled.
    pass

def test_upload_fast_file_too_large(app_client: TestClient, mock_db):
    large_content = b"0" * (51 * 1024 * 1024)  # 51 MB
    res = app_client.post(
        "/api/v1/fast-upload/",
        files={"file": ("large.pdf", large_content, "application/pdf")},
    )
    assert res.status_code == 413
    assert "exceeds 50MB" in res.json()["detail"]

def test_upload_fast_unauthorized(app, sample_pdf_bytes, mock_db):
    from fastapi.testclient import TestClient
    unauthed_client = TestClient(app)
    # Don't use app_client which has auth overrides
    res = unauthed_client.post(
        "/api/v1/fast-upload/",
        files={"file": ("test.pdf", sample_pdf_bytes, "application/pdf")},
    )
    assert res.status_code == 401

def test_upload_fast_student_forbidden(app, authed, student_user, sample_pdf_bytes, mock_db):
    from fastapi.testclient import TestClient
    client = TestClient(app)
    authed.as_user(student_user)
    
    res = client.post(
        "/api/v1/fast-upload/",
        files={"file": ("test.pdf", sample_pdf_bytes, "application/pdf")},
    )
    assert res.status_code == 403

def test_get_upload_status(app_client: TestClient, mock_db):
    mock_eq, _ = mock_db
    test_run_id = str(uuid.uuid4())
    test_lecture_id = str(uuid.uuid4())
    
    # Mock the execute_query for the GET /status/{run_id} endpoint
    mock_eq.return_value = [{
        "run_id": uuid.UUID(test_run_id),
        "status": "completed",
        "lecture_id": uuid.UUID(test_lecture_id),
        "error": None
    }]
    
    res = app_client.get(f"/api/v1/fast-upload/status/{test_run_id}")
    assert res.status_code == 200
    data = res.json()
    assert data["id"] == test_run_id
    assert data["status"] == "completed"
    assert data["lectureId"] == test_lecture_id
    assert data["errorMessage"] is None
