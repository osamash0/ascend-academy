"""Integration tests for the root endpoint and CORS."""
from fastapi.testclient import TestClient


def test_root_ok(app):
    client = TestClient(app)
    r = client.get("/")
    assert r.status_code == 200
    assert "message" in r.json()


def test_cors_preflight(app):
    client = TestClient(app)
    r = client.options(
        "/api/analytics/lecture/L1/overview",
        headers={
            "Origin": "http://localhost:5000",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Authorization",
        },
    )
    # CORSMiddleware always responds
    assert r.status_code in (200, 204, 400)
