import pytest
from fastapi.testclient import TestClient

def test_debug(app_client: TestClient):
    res = app_client.post(
        "/api/v1/courses",
        json={"title": "Test Course", "description": "A course", "color": "#000", "icon": "book"}
    )
    print("CREATE STATUS:", res.status_code)
    print("CREATE BODY:", res.text)

    res = app_client.delete("/api/v1/courses/e36993e4-8dc4-4fbf-8ec0-bda87a52f3fe")
    print("DELETE STATUS:", res.status_code)
    print("DELETE BODY:", res.text)
    
    res2 = app_client.post(
        "/api/v1/fast-upload/",
        files={"file": ("test.pdf", b"pdfcontent", "application/pdf")},
    )
    print("UPLOAD STATUS:", res2.status_code)
    print("UPLOAD BODY:", res2.text)
