import uuid
from fastapi.testclient import TestClient

def test_create_course_professor(app_client: TestClient, fake_supabase):
    res = app_client.post(
        "/api/v1/courses",
        json={"title": "Test Course", "description": "A course", "color": "#000", "icon": "book"}
    )
    if res.status_code != 201:
        print("CREATE COURSE ERROR:", res.text)
    assert res.status_code == 201
    data = res.json()["data"]
    assert data["title"] == "Test Course"
    
    # Verify in mock db
    rows = fake_supabase.table("courses").select("*").execute().data
    assert len(rows) == 1
    assert rows[0]["title"] == "Test Course"

def test_create_course_student_forbidden(app, authed, student_user):
    client = TestClient(app)
    authed.as_user(student_user)
    
    res = client.post(
        "/api/v1/courses",
        json={"title": "Student Course"}
    )
    assert res.status_code == 403

def test_update_course_owner(app_client: TestClient, fake_supabase, professor_user):
    course_id = str(uuid.uuid4())
    fake_supabase.seed("courses", [{"id": course_id, "professor_id": professor_user.id, "title": "Old Title"}])
    
    res = app_client.patch(
        f"/api/v1/courses/{course_id}",
        json={"title": "New Title", "is_archived": True}
    )
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["title"] == "New Title"
    assert data["is_archived"] is True
    
    rows = fake_supabase.table("courses").select("*").eq("id", course_id).execute().data
    assert rows[0]["title"] == "New Title"

def test_update_course_non_owner(app_client: TestClient, fake_supabase):
    course_id = str(uuid.uuid4())
    # Owned by someone else
    fake_supabase.seed("courses", [{"id": course_id, "professor_id": "someone_else", "title": "Old Title"}])
    
    res = app_client.patch(
        f"/api/v1/courses/{course_id}",
        json={"title": "New Title"}
    )
    assert res.status_code == 403

def test_delete_course_owner(app_client: TestClient, fake_supabase, professor_user):
    course_id = str(uuid.uuid4())
    fake_supabase.seed("courses", [{"id": course_id, "professor_id": professor_user.id, "title": "To Delete"}])
    
    res = app_client.delete(f"/api/v1/courses/{course_id}")
    assert res.status_code == 204
    
    # Should be removed from mock db
    rows = fake_supabase.table("courses").select("*").eq("id", course_id).execute().data
    assert len(rows) == 0

def test_delete_course_non_owner(app_client: TestClient, fake_supabase):
    course_id = str(uuid.uuid4())
    fake_supabase.seed("courses", [{"id": course_id, "professor_id": "someone_else", "title": "To Delete"}])
    
    res = app_client.delete(f"/api/v1/courses/{course_id}")
    assert res.status_code == 403

def test_delete_course_with_lectures_fails(app_client: TestClient, fake_supabase, professor_user):
    course_id = str(uuid.uuid4())
    lecture_id = str(uuid.uuid4())
    fake_supabase.seed("courses", [{"id": course_id, "professor_id": professor_user.id, "title": "Course"}])
    fake_supabase.seed("lectures", [{"id": lecture_id, "course_id": course_id, "professor_id": professor_user.id}])
    
    res = app_client.delete(f"/api/v1/courses/{course_id}")
    assert res.status_code == 409
    assert "reassign_to" in res.json()["detail"]

def test_delete_course_with_lectures_reassign(app_client: TestClient, fake_supabase, professor_user):
    course_id = str(uuid.uuid4())
    reassign_to = str(uuid.uuid4())
    lecture_id = str(uuid.uuid4())
    
    fake_supabase.seed("courses", [
        {"id": course_id, "professor_id": professor_user.id, "title": "Course"},
        {"id": reassign_to, "professor_id": professor_user.id, "title": "Reassign Target"}
    ])
    fake_supabase.seed("lectures", [{"id": lecture_id, "course_id": course_id, "professor_id": professor_user.id}])
    
    res = app_client.delete(f"/api/v1/courses/{course_id}?reassign_to={reassign_to}")
    assert res.status_code == 204
    
    # Check that course was deleted
    rows = fake_supabase.table("courses").select("*").eq("id", course_id).execute().data
    assert len(rows) == 0
    # Check that lecture was reassigned
    lectures = fake_supabase.table("lectures").select("*").eq("id", lecture_id).execute().data
    assert lectures[0]["course_id"] == reassign_to
