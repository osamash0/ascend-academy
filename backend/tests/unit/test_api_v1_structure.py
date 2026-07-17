from fastapi.testclient import TestClient
from backend.main import app
from backend.core.exceptions import DomainError, NotFoundError

client = TestClient(app)

def test_v1_docs_endpoint_matches_env_config():
    """The interactive docs are served only when enabled (development); in
    non-dev environments docs_url is None and /docs 404s. Assert whichever
    matches the app's actual configuration so this passes in any env."""
    expected = 200 if app.docs_url else 404
    response = client.get("/docs")
    assert response.status_code == expected

def test_legacy_redirect_preserves_method_and_params():
    """Verify that a legacy route like /api/auth/logout redirects with 307
    to /api/v1/auth/logout and preserves query parameters.
    """
    response = client.post("/api/auth/logout?foo=bar", follow_redirects=False)
    assert response.status_code == 307
    assert response.headers["location"] == "/api/v1/auth/logout?foo=bar"

def test_legacy_redirect_loop_prevention():
    """Verify that a redirect loop is prevented for v1 paths under /api/."""
    response = client.get("/api/v1/some-path", follow_redirects=False)
    # If the path starts with v1/, redirect_legacy_api raises a 404, not a redirect.
    assert response.status_code == 404

def test_domain_error_exception_handler():
    """Verify that DomainError exceptions translate to the standardized ErrorResponse JSON structure."""
    from fastapi import APIRouter
    test_router = APIRouter()
    
    @test_router.get("/test-domain-error")
    def trigger_domain_error():
        raise DomainError("This is a domain error", code="INVALID_ACTION", details={"reason": "test"})
    
    @test_router.get("/test-not-found-error")
    def trigger_not_found_error():
        raise NotFoundError("Resource not found", code="OBJECT_MISSING")

    # Add router temporarily to test exception handlers
    app.include_router(test_router)
    try:
        # 1. Test DomainError
        response = client.get("/test-domain-error")
        assert response.status_code == 400
        json_data = response.json()
        assert json_data["data"] is None
        assert json_data["error"]["code"] == "INVALID_ACTION"
        assert json_data["error"]["message"] == "This is a domain error"
        assert json_data["error"]["details"] == {"reason": "test"}

        # 2. Test NotFoundError (subclass of DomainError)
        response = client.get("/test-not-found-error")
        assert response.status_code == 404
        json_data = response.json()
        assert json_data["data"] is None
        assert json_data["error"]["code"] == "OBJECT_MISSING"
        assert json_data["error"]["message"] == "Resource not found"
    finally:
        # Clean up the router from app routes
        app.routes[:] = [r for r in app.routes if getattr(r, "path", "") not in ("/test-domain-error", "/test-not-found-error")]

