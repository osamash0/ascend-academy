"""Integration coverage for editable onboarding blueprint operations."""
from __future__ import annotations

from uuid import UUID

from backend.api.v1 import onboarding as onboarding_api


OWNER = "00000000-0000-0000-0000-000000000001"
OTHER_OWNER = "00000000-0000-0000-0000-000000000099"


def test_sync_blueprint_reuses_a_source_when_a_parse_run_moves_to_a_new_batch(patch_supabase, monkeypatch):
    """Re-uploading identical content must not violate material_sources' unique run key."""
    monkeypatch.setattr(onboarding_api, "supabase_admin", patch_supabase)
    old_batch = "00000000-0000-0000-0000-000000000010"
    new_batch = "00000000-0000-0000-0000-000000000011"
    run_id = "00000000-0000-0000-0000-000000000012"
    lecture_id = "00000000-0000-0000-0000-000000000013"
    patch_supabase.seed("material_sources", [{
        "id": "source-1", "owner_id": OWNER, "batch_id": old_batch,
        "parse_run_id": run_id, "original_filename": "Week 1.pdf",
        "classification": "lecture", "processing_state": "processing",
        "extracted_metadata": {},
    }])
    patch_supabase.seed("course_blueprint_items", [])

    onboarding_api._sync_blueprint_sources(
        {"id": "blueprint-1", "status": "draft"},
        UUID(new_batch),
        OWNER,
        [{
            "run_id": run_id, "lecture_id": lecture_id, "pdf_hash": "hash",
            "filename": "Week 1.pdf", "status": "completed", "error": None,
        }],
        {lecture_id: {"id": lecture_id, "title": "Week 1"}},
    )

    assert len(patch_supabase.tables["material_sources"]) == 1
    assert patch_supabase.tables["material_sources"][0]["batch_id"] == new_batch
    assert patch_supabase.tables["material_sources"][0]["processing_state"] == "ready"
    assert len(patch_supabase.tables["course_blueprint_items"]) == 1
    assert {
        key: patch_supabase.tables["course_blueprint_items"][0][key]
        for key in ("blueprint_id", "material_source_id", "lecture_id", "title", "position", "classification", "confidence", "include_in_course")
    } == {
        "blueprint_id": "blueprint-1", "material_source_id": "source-1",
        "lecture_id": lecture_id, "title": "Week 1", "position": 0,
        "classification": "lecture", "confidence": 0.9, "include_in_course": True,
    }


def test_split_material_creates_a_second_lecture_without_mutating_the_source(app_client, patch_supabase, monkeypatch):
    monkeypatch.setattr(onboarding_api, "supabase_admin", patch_supabase)
    patch_supabase.seed("course_blueprints", [{
        "id": "blueprint-1", "owner_id": OWNER, "batch_id": "batch-1",
        "course_id": None, "title": "Database Systems", "description": None,
        "study_goal": "weekly_study", "status": "ready",
    }])
    patch_supabase.seed("material_sources", [{
        "id": "source-1", "original_filename": "Weeks 1-2.pdf",
        "processing_state": "ready", "extracted_metadata": {},
    }])
    patch_supabase.seed("course_blueprint_items", [{
        "id": "item-1", "blueprint_id": "blueprint-1", "material_source_id": "source-1",
        "lecture_id": "lecture-1", "title": "Weeks 1 and 2", "position": 0,
        "classification": "lecture", "confidence": 0.9, "include_in_course": True,
        "source_range": None, "lecture_group_id": "group-1", "split_from_item_id": None,
    }])
    patch_supabase.seed("lectures", [{
        "id": "lecture-1", "title": "Weeks 1 and 2", "description": "Two weeks",
        "pdf_url": "lecture-pdfs/weeks.pdf", "pdf_hash": "h" * 64,
        "professor_id": OWNER, "student_owner_id": None, "visibility": "course",
        "lecture_type": None, "subject": "Databases", "course_code": "CS204",
        "key_topics": [], "total_slides": 4,
    }])
    patch_supabase.seed("slides", [
        {"id": "slide-1", "lecture_id": "lecture-1", "slide_number": 1},
        {"id": "slide-2", "lecture_id": "lecture-1", "slide_number": 2},
        {"id": "slide-3", "lecture_id": "lecture-1", "slide_number": 3},
        {"id": "slide-4", "lecture_id": "lecture-1", "slide_number": 4},
    ])
    patch_supabase.seed("slide_chunks", [
        {"id": "chunk-1", "lecture_id": "lecture-1", "page_index": 0},
        {"id": "chunk-2", "lecture_id": "lecture-1", "page_index": 2},
    ])

    response = app_client.post("/api/v1/onboarding/blueprints/blueprint-1/items/item-1/split", json={})

    assert response.status_code == 200
    payload = response.json()["data"]
    assert len(payload["items"]) == 2
    first, second = payload["items"]
    assert first["material_source_id"] == second["material_source_id"] == "source-1"
    assert first["source_range"] == {"start_slide": 1, "end_slide": 2}
    assert second["source_range"] == {"start_slide": 3, "end_slide": 4}
    assert second["split_from_item_id"] == "item-1"
    assert second["lecture_id"] != "lecture-1"

    new_lecture_id = second["lecture_id"]
    moved_numbers = [s["slide_number"] for s in patch_supabase.tables["slides"] if s["lecture_id"] == new_lecture_id]
    assert moved_numbers == [3, 4]
    assert patch_supabase.tables["material_sources"][0]["original_filename"] == "Weeks 1-2.pdf"


# ── _ensure_description ───────────────────────────────────────────────────────
#
# The blueprint used to ship a hard-coded "Study material organized from N
# uploaded files." for every course, which is why every upload produced an
# identical description. It is now written from the parsed decks.

def _seed_described_blueprint(patch_supabase, *, description=None):
    patch_supabase.seed("course_blueprint_items", [{
        "id": "item-1", "blueprint_id": "blueprint-1", "material_source_id": "source-1",
        "lecture_id": "lecture-1", "title": "Normalization", "position": 0,
        "classification": "lecture", "confidence": 0.9, "include_in_course": True,
    }])
    patch_supabase.seed("slides", [
        {"id": "slide-1", "lecture_id": "lecture-1", "slide_number": 1, "summary": "Functional dependencies"},
        {"id": "slide-2", "lecture_id": "lecture-1", "slide_number": 2, "summary": "Third normal form"},
    ])
    patch_supabase.seed("course_blueprints", [{
        "id": "blueprint-1", "owner_id": OWNER, "batch_id": "batch-1", "course_id": None,
        "title": "Database Systems", "description": description,
        "study_goal": "weekly_study", "status": "ready",
    }])
    return {
        "id": "blueprint-1", "owner_id": OWNER, "title": "Database Systems",
        "description": description, "status": "ready",
        "items": [{
            "id": "item-1", "lecture_id": "lecture-1", "include_in_course": True,
            "material_source": {"processing_state": "ready"},
        }],
    }


def _patch_description_llm(monkeypatch, *, reply="Relational design from dependencies to 3NF.", capture=None):
    from backend.services.ai import orchestrator

    async def _fake_generate_text(prompt, *a, **k):
        if capture is not None:
            capture["prompt"] = prompt
        return reply

    monkeypatch.setattr(orchestrator, "generate_text", _fake_generate_text)


async def test_description_is_generated_from_the_parsed_decks(patch_supabase, monkeypatch):
    monkeypatch.setattr(onboarding_api, "supabase_admin", patch_supabase)
    captured: dict[str, str] = {}
    _patch_description_llm(monkeypatch, capture=captured)
    blueprint = _seed_described_blueprint(patch_supabase)

    result = await onboarding_api._ensure_description(blueprint, OWNER)

    assert result["description"] == "Relational design from dependencies to 3NF."
    assert patch_supabase.tables["course_blueprints"][0]["description"] == "Relational design from dependencies to 3NF."
    # The prompt is grounded in the actual slide summaries, not the file count.
    assert "Normalization" in captured["prompt"]
    assert "Third normal form" in captured["prompt"]


async def test_legacy_file_count_placeholder_is_replaced(patch_supabase, monkeypatch):
    monkeypatch.setattr(onboarding_api, "supabase_admin", patch_supabase)
    _patch_description_llm(monkeypatch)
    blueprint = _seed_described_blueprint(
        patch_supabase, description="Study material organized from 1 uploaded file.",
    )

    result = await onboarding_api._ensure_description(blueprint, OWNER)

    assert result["description"] == "Relational design from dependencies to 3NF."


async def test_a_student_written_description_is_never_overwritten(patch_supabase, monkeypatch):
    monkeypatch.setattr(onboarding_api, "supabase_admin", patch_supabase)
    _patch_description_llm(monkeypatch)
    blueprint = _seed_described_blueprint(patch_supabase, description="My exam prep for CS204.")

    result = await onboarding_api._ensure_description(blueprint, OWNER)

    assert result["description"] == "My exam prep for CS204."
    assert patch_supabase.tables["course_blueprints"][0]["description"] == "My exam prep for CS204."


async def test_description_waits_until_every_source_finished_parsing(patch_supabase, monkeypatch):
    """The wizard polls every 2.5s; describing a half-parsed batch would
    summarize only the files that happened to finish first."""
    monkeypatch.setattr(onboarding_api, "supabase_admin", patch_supabase)
    _patch_description_llm(monkeypatch)
    blueprint = _seed_described_blueprint(patch_supabase)
    blueprint["items"].append({
        "id": "item-2", "lecture_id": None, "include_in_course": False,
        "material_source": {"processing_state": "processing"},
    })

    result = await onboarding_api._ensure_description(blueprint, OWNER)

    assert result["description"] is None
    assert patch_supabase.tables["course_blueprints"][0]["description"] is None


async def test_description_stays_empty_when_the_llm_fails(patch_supabase, monkeypatch):
    monkeypatch.setattr(onboarding_api, "supabase_admin", patch_supabase)
    from backend.services.ai import orchestrator

    async def _boom(prompt, *a, **k):
        raise RuntimeError("all providers exhausted")

    monkeypatch.setattr(orchestrator, "generate_text", _boom)
    blueprint = _seed_described_blueprint(patch_supabase)

    result = await onboarding_api._ensure_description(blueprint, OWNER)

    assert result["description"] is None


def test_other_creator_cannot_read_or_mutate_a_blueprint(app_client, patch_supabase, monkeypatch):
    """Every service-role-backed mutation must scope its target by owner.

    The production client intentionally has no direct table policy for draft
    blueprints, so this is the API boundary regression guard for read, edit,
    split, and course creation.  A second creator must receive the same 404
    for all four operations and leave the owner's draft untouched.
    """
    monkeypatch.setattr(onboarding_api, "supabase_admin", patch_supabase)
    patch_supabase.seed("course_blueprints", [{
        "id": "blueprint-private", "owner_id": OTHER_OWNER,
        "batch_id": "00000000-0000-0000-0000-000000000555", "course_id": None,
        "title": "Private draft", "description": None, "study_goal": "exam", "status": "ready",
    }])
    patch_supabase.seed("course_blueprint_items", [{
        "id": "item-private", "blueprint_id": "blueprint-private", "material_source_id": "source-private",
        "lecture_id": "lecture-private", "title": "Private lecture", "position": 0,
        "classification": "lecture", "confidence": 0.9, "include_in_course": True,
    }])

    responses = [
        app_client.get("/api/v1/onboarding/batches/00000000-0000-0000-0000-000000000555/blueprint"),
        app_client.patch("/api/v1/onboarding/blueprints/blueprint-private", json={"title": "stolen"}),
        app_client.patch("/api/v1/onboarding/blueprints/blueprint-private/items/item-private", json={"title": "stolen"}),
        app_client.post("/api/v1/onboarding/blueprints/blueprint-private/items/item-private/split", json={}),
        app_client.post("/api/v1/onboarding/blueprints/blueprint-private/create-course", json={}),
    ]

    assert [response.status_code for response in responses] == [404, 404, 404, 404, 404]
    assert patch_supabase.tables["course_blueprints"][0]["title"] == "Private draft"
    assert patch_supabase.tables["course_blueprint_items"] == [{
        "id": "item-private", "blueprint_id": "blueprint-private", "material_source_id": "source-private",
        "lecture_id": "lecture-private", "title": "Private lecture", "position": 0,
        "classification": "lecture", "confidence": 0.9, "include_in_course": True,
    }]
    assert patch_supabase.tables.get("courses", []) == []
