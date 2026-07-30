"""Activation onboarding and editable course-blueprint APIs.

The parser remains the authoritative producer of immutable lectures. A
blueprint is the student-editable proposal that decides which parsed materials
become a course and in what order.

Why `supabase_admin` here (the `# ADMIN:` sign-off on the import below)
--------------------------------------------------------------------
Blueprint orchestration is server-authoritative: it stitches together
`parse_runs`, `material_sources`, `lectures`/`slides` and
`course_blueprint_items`, and clones/re-parents lecture rows during item
splits and merges. Every query in this module is nonetheless scoped by the
authenticated caller's id (`owner_id`/`uid`, behind `require_creator`), so the
visibility rule is the same one RLS would apply -- it is just enforced in
Python rather than by Postgres, which is strictly weaker. Follow-up: revisit
under the P2-1 RLS-as-API-boundary pass (docs/ROADMAP_10X_FOUNDATION.md §4)
once the blueprint tables carry per-user SELECT/UPDATE policies.
"""
from __future__ import annotations

import os
import re
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from backend.core.auth_middleware import _user_id, require_creator
from backend.core.database import supabase_admin  # ADMIN: server-authoritative blueprint orchestration -- see note below
from backend.core.rate_limit import limiter

router = APIRouter(prefix="/onboarding", tags=["onboarding"])

_LECTURE_NUMBER = re.compile(r"(?:lecture|lec|chapter|week|unit)\s*[-_ ]?(\d+)", re.I)
_CLASSIFIERS = (
    ("exam", re.compile(r"exam|klausur|mock" , re.I)),
    ("worksheet", re.compile(r"worksheet|arbeitsblatt|exercise" , re.I)),
    ("assignment", re.compile(r"assignment|homework|abgabe" , re.I)),
    ("reading", re.compile(r"reading|literature|paper" , re.I)),
)


class BlueprintPatch(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=4000)
    study_goal: Optional[str] = Field(default=None, pattern="^(weekly_study|exam|assignment|understanding)$")


class BlueprintItemPatch(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=500)
    position: Optional[int] = Field(default=None, ge=0)
    classification: Optional[str] = Field(default=None, pattern="^(lecture|reading|worksheet|assignment|exam|supporting)$")
    include_in_course: Optional[bool] = None
    lecture_group_id: Optional[UUID] = None


class BlueprintItemSplit(BaseModel):
    """Split immediately after this one-based slide number.

    Omitting the boundary asks the server to choose the middle of the parsed
    deck, which is a useful recovery for a combined upload without forcing a
    student to inspect page metadata first.
    """
    after_slide: Optional[int] = Field(default=None, ge=1)


def _require_uuid(raw: str, label: str) -> UUID:
    try:
        return UUID(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid {label}.") from exc


def _classify(filename: str) -> str:
    for kind, pattern in _CLASSIFIERS:
        if pattern.search(filename):
            return kind
    return "lecture"


def _confidence(filename: str) -> float:
    return 0.9 if _LECTURE_NUMBER.search(filename) else 0.65


def _title_from_filename(filename: str) -> str:
    stem = os.path.splitext(filename or "Material")[0]
    return re.sub(r"[_-]+", " ", stem).strip().title() or "Material"


def _fetch_blueprint(blueprint_id: str, owner_id: str) -> dict[str, Any] | None:
    result = (
        supabase_admin.table("course_blueprints")
        .select("id, owner_id, batch_id, course_id, title, description, study_goal, status, created_at, updated_at")
        .eq("id", blueprint_id)
        .eq("owner_id", owner_id)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


def _serialize_blueprint(blueprint: dict[str, Any]) -> dict[str, Any]:
    item_res = (
        supabase_admin.table("course_blueprint_items")
        .select("id, material_source_id, lecture_id, title, position, classification, confidence, include_in_course, source_range, lecture_group_id, split_from_item_id")
        .eq("blueprint_id", blueprint["id"])
        .order("position")
        .execute()
    )
    items = item_res.data or []
    source_ids = [item["material_source_id"] for item in items if item.get("material_source_id")]
    sources: dict[str, dict[str, Any]] = {}
    if source_ids:
        source_res = (
            supabase_admin.table("material_sources")
            .select("id, original_filename, processing_state, extracted_metadata")
            .in_("id", source_ids)
            .execute()
        )
        sources = {source["id"]: source for source in (source_res.data or [])}
    return {
        **blueprint,
        "items": [
            {**item, "material_source": sources.get(item.get("material_source_id"))}
            for item in items
        ],
    }


def _load_batch_runs(batch_id: UUID, owner_id: str) -> list[dict[str, Any]]:
    run_res = (
        supabase_admin.table("parse_runs")
        .select("run_id, lecture_id, pdf_hash, filename, status, error, course_id")
        .eq("batch_id", str(batch_id))
        .eq("user_id", owner_id)
        .order("started_at")
        .execute()
    )
    runs = run_res.data or []
    if not runs:
        raise HTTPException(status_code=404, detail="Upload batch not found.")
    return runs


def _lectures_for_runs(runs: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    lecture_ids = [run["lecture_id"] for run in runs if run.get("lecture_id")]
    if not lecture_ids:
        return {}
    lecture_res = supabase_admin.table("lectures").select("id, title").in_("id", lecture_ids).execute()
    return {row["id"]: row for row in (lecture_res.data or [])}


def _source_state(run: dict[str, Any]) -> str:
    if run.get("status") == "completed" and run.get("lecture_id"):
        return "ready"
    if run.get("status") in {"failed", "cancelled"}:
        return "failed"
    return "processing"


def _sync_blueprint_sources(
    blueprint: dict[str, Any],
    batch_id: UUID,
    owner_id: str,
    runs: list[dict[str, Any]],
    lectures: dict[str, dict[str, Any]],
) -> None:
    """Mirror immutable parser progress into the editable proposal.

    A blueprint can be opened while other files are still processing. Keeping
    the parser status on the source record means the student can create a
    useful course from the first ready lecture without losing later files.
    """
    source_res = (
        supabase_admin.table("material_sources")
        .select("id, batch_id, parse_run_id, original_filename, classification, processing_state, extracted_metadata")
        .eq("batch_id", str(batch_id))
        .eq("owner_id", owner_id)
        .execute()
    )
    source_by_run = {source["parse_run_id"]: source for source in (source_res.data or []) if source.get("parse_run_id")}

    # A parse run is unique per user + file hash and can be attached to a
    # newer batch when that file is submitted again. Its material source is
    # unique too, so re-use and move that source instead of attempting a
    # duplicate insert (which otherwise makes this endpoint return a 500).
    unbound_run_ids = [run["run_id"] for run in runs if run["run_id"] not in source_by_run]
    if unbound_run_ids:
        reused_res = (
            supabase_admin.table("material_sources")
            .select("id, batch_id, parse_run_id, original_filename, classification, processing_state, extracted_metadata")
            .in_("parse_run_id", unbound_run_ids)
            .eq("owner_id", owner_id)
            .execute()
        )
        for source in reused_res.data or []:
            if source.get("parse_run_id"):
                source_by_run[source["parse_run_id"]] = source

    missing_sources = []
    for run in runs:
        if run["run_id"] in source_by_run:
            continue
        filename = run.get("filename") or "Material"
        missing_sources.append({
            "owner_id": owner_id,
            "batch_id": str(batch_id),
            "parse_run_id": run["run_id"],
            "original_filename": filename,
            "file_type": os.path.splitext(filename)[1].lstrip(".").lower() or "pdf",
            "content_hash": run.get("pdf_hash"),
            "processing_state": _source_state(run),
            "classification": _classify(filename),
            "extracted_metadata": {"parse_error": run.get("error")} if run.get("error") else {},
        })
    if missing_sources:
        supabase_admin.table("material_sources").insert(missing_sources).execute()
        source_res = (
            supabase_admin.table("material_sources")
            .select("id, batch_id, parse_run_id, original_filename, classification, processing_state, extracted_metadata")
            .eq("batch_id", str(batch_id))
            .eq("owner_id", owner_id)
            .execute()
        )
        source_by_run = {source["parse_run_id"]: source for source in (source_res.data or []) if source.get("parse_run_id")}

    for run in runs:
        source = source_by_run.get(run["run_id"])
        if not source:
            continue
        source_patch = {
            "processing_state": _source_state(run),
            "extracted_metadata": {"parse_error": run.get("error")} if run.get("error") else {},
        }
        needs_batch_move = source.get("batch_id") != str(batch_id)
        if needs_batch_move:
            source_patch["batch_id"] = str(batch_id)
        if (
            source.get("processing_state") != source_patch["processing_state"]
            or source.get("extracted_metadata") != source_patch["extracted_metadata"]
            or needs_batch_move
        ):
            supabase_admin.table("material_sources").update(source_patch).eq("id", source["id"]).execute()

    item_res = (
        supabase_admin.table("course_blueprint_items")
        .select("id, material_source_id, lecture_id, title, include_in_course, lecture_group_id, split_from_item_id")
        .eq("blueprint_id", blueprint["id"])
        .execute()
    )
    items_by_source: dict[str, list[dict[str, Any]]] = {}
    for item in item_res.data or []:
        items_by_source.setdefault(item["material_source_id"], []).append(item)
    new_items = []
    for position, run in enumerate(runs):
        source = source_by_run.get(run["run_id"])
        if not source:
            continue
        lecture = lectures.get(run.get("lecture_id"))
        # A split creates secondary items for the same source. Parser progress
        # must keep updating the original (non-split) item only.
        source_items = items_by_source.get(source["id"], [])
        existing = next((item for item in source_items if not item.get("split_from_item_id")), source_items[0] if source_items else None)
        if not existing:
            new_items.append({
                "blueprint_id": blueprint["id"],
                "material_source_id": source["id"],
                "lecture_id": run.get("lecture_id"),
                "title": lecture.get("title") if lecture else _title_from_filename(source["original_filename"]),
                "position": position,
                "classification": source["classification"],
                "confidence": _confidence(source["original_filename"]),
                "include_in_course": bool(lecture),
            })
            continue
        if lecture and not existing.get("lecture_id"):
            fallback_title = _title_from_filename(source["original_filename"])
            item_patch: dict[str, Any] = {"lecture_id": lecture["id"], "include_in_course": True}
            if existing.get("title") == fallback_title:
                item_patch["title"] = lecture.get("title") or fallback_title
            supabase_admin.table("course_blueprint_items").update(item_patch).eq("id", existing["id"]).execute()
    if new_items:
        supabase_admin.table("course_blueprint_items").insert(new_items).execute()

    has_ready_material = any(run.get("lecture_id") and run.get("status") == "completed" for run in runs)
    desired_status = "ready" if has_ready_material else "draft"
    if blueprint.get("status") != "created" and blueprint.get("status") != desired_status:
        supabase_admin.table("course_blueprints").update({"status": desired_status}).eq("id", blueprint["id"]).execute()


def _ensure_blueprint(batch_id: UUID, owner_id: str) -> dict[str, Any]:
    existing = (
        supabase_admin.table("course_blueprints")
        .select("id, owner_id, batch_id, course_id, title, description, study_goal, status, created_at, updated_at")
        .eq("batch_id", str(batch_id))
        .eq("owner_id", owner_id)
        .limit(1)
        .execute()
    )
    runs = _load_batch_runs(batch_id, owner_id)
    lectures = _lectures_for_runs(runs)
    if existing.data:
        _sync_blueprint_sources(existing.data[0], batch_id, owner_id, runs, lectures)
        return _serialize_blueprint(_fetch_blueprint(existing.data[0]["id"], owner_id) or existing.data[0])

    ready_runs = [run for run in runs if run.get("lecture_id") and run.get("status") == "completed"]
    first_title = lectures.get(ready_runs[0].get("lecture_id"), {}).get("title") if ready_runs else None
    existing_course_id = next((run.get("course_id") for run in runs if run.get("course_id")), None)
    existing_course: dict[str, Any] | None = None
    if existing_course_id:
        course_res = (
            supabase_admin.table("courses")
            .select("id, title, description")
            .eq("id", existing_course_id)
            .eq("professor_id", owner_id)
            .limit(1)
            .execute()
        )
        existing_course = course_res.data[0] if course_res.data else None
    blueprint_res = supabase_admin.table("course_blueprints").insert({
        "owner_id": owner_id,
        "batch_id": str(batch_id),
        "course_id": existing_course["id"] if existing_course else None,
        "title": existing_course.get("title") if existing_course else first_title or _title_from_filename(runs[0].get("filename") or "My course"),
        "description": existing_course.get("description") if existing_course else f"Study material organized from {len(runs)} uploaded file{'s' if len(runs) != 1 else ''}.",
        "status": "ready" if ready_runs else "draft",
    }).execute()
    if not blueprint_res.data:
        raise HTTPException(status_code=500, detail="Could not create a course blueprint.")
    blueprint = blueprint_res.data[0]

    _sync_blueprint_sources(blueprint, batch_id, owner_id, runs, lectures)
    return _serialize_blueprint(_fetch_blueprint(blueprint["id"], owner_id) or blueprint)


@router.get("/batches/{batch_id}/blueprint")
@limiter.limit("60/minute")
async def get_blueprint(request: Request, batch_id: str, user: Any = Depends(require_creator)):
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")
    blueprint = await run_in_threadpool(_ensure_blueprint, _require_uuid(batch_id, "batch id"), uid)
    return {"success": True, "data": blueprint}


@router.patch("/blueprints/{blueprint_id}")
@limiter.limit("60/minute")
async def patch_blueprint(request: Request, blueprint_id: str, body: BlueprintPatch, user: Any = Depends(require_creator)):
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    def _patch():
        blueprint = _fetch_blueprint(blueprint_id, uid)
        if not blueprint:
            raise HTTPException(status_code=404, detail="Course blueprint not found.")
        if blueprint.get("status") == "created":
            raise HTTPException(status_code=409, detail="This course blueprint has already been created.")
        patch = body.model_dump(exclude_none=True)
        if patch:
            supabase_admin.table("course_blueprints").update(patch).eq("id", blueprint_id).execute()
        return _serialize_blueprint(_fetch_blueprint(blueprint_id, uid) or blueprint)

    return {"success": True, "data": await run_in_threadpool(_patch)}


@router.patch("/blueprints/{blueprint_id}/items/{item_id}")
@limiter.limit("60/minute")
async def patch_blueprint_item(request: Request, blueprint_id: str, item_id: str, body: BlueprintItemPatch, user: Any = Depends(require_creator)):
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    def _patch():
        blueprint = _fetch_blueprint(blueprint_id, uid)
        if not blueprint:
            raise HTTPException(status_code=404, detail="Course blueprint not found.")
        if blueprint.get("status") == "created":
            raise HTTPException(status_code=409, detail="This course blueprint has already been created.")
        item_res = supabase_admin.table("course_blueprint_items").select("id").eq("id", item_id).eq("blueprint_id", blueprint_id).limit(1).execute()
        if not item_res.data:
            raise HTTPException(status_code=404, detail="Blueprint item not found.")
        patch = body.model_dump(exclude_none=True)
        requested_position = patch.pop("position", None)
        if patch:
            supabase_admin.table("course_blueprint_items").update(patch).eq("id", item_id).execute()
        if requested_position is not None:
            all_items = (
                supabase_admin.table("course_blueprint_items")
                .select("id, position")
                .eq("blueprint_id", blueprint_id)
                .order("position")
                .execute()
                .data or []
            )
            moving = next((item for item in all_items if item["id"] == item_id), None)
            if not moving:
                raise HTTPException(status_code=404, detail="Blueprint item not found.")
            all_items = [item for item in all_items if item["id"] != item_id]
            all_items.insert(min(requested_position, len(all_items)), moving)
            # Temporarily move every row outside its normal range so the
            # `(blueprint_id, position)` uniqueness invariant holds throughout.
            for index, item in enumerate(all_items):
                supabase_admin.table("course_blueprint_items").update({"position": index + 100000}).eq("id", item["id"]).execute()
            for index, item in enumerate(all_items):
                supabase_admin.table("course_blueprint_items").update({"position": index}).eq("id", item["id"]).execute()
        return _serialize_blueprint(_fetch_blueprint(blueprint_id, uid) or blueprint)

    return {"success": True, "data": await run_in_threadpool(_patch)}


@router.post("/blueprints/{blueprint_id}/items/{item_id}/split")
@limiter.limit("20/minute")
async def split_blueprint_item(request: Request, blueprint_id: str, item_id: str, body: BlueprintItemSplit, user: Any = Depends(require_creator)):
    """Split a parsed deck into two course lectures at a real slide boundary.

    The uploaded source and its parse run remain unchanged.  We make a second
    lecture view over the latter slides and record the two ranges on blueprint
    items, so the student can still rename, reorder, merge, or undo the
    proposed structure before course creation.
    """
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    def _split():
        blueprint = _fetch_blueprint(blueprint_id, uid)
        if not blueprint:
            raise HTTPException(status_code=404, detail="Course blueprint not found.")
        if blueprint.get("status") == "created":
            raise HTTPException(status_code=409, detail="This course blueprint has already been created.")
        item_res = (
            supabase_admin.table("course_blueprint_items")
            .select("id, blueprint_id, material_source_id, lecture_id, title, position, classification, confidence, include_in_course, source_range")
            .eq("id", item_id)
            .eq("blueprint_id", blueprint_id)
            .limit(1)
            .execute()
        )
        if not item_res.data:
            raise HTTPException(status_code=404, detail="Blueprint item not found.")
        item = item_res.data[0]
        if not item.get("lecture_id"):
            raise HTTPException(status_code=409, detail="This file is still processing. Try splitting it once it is ready.")

        slides = (
            supabase_admin.table("slides")
            .select("id, slide_number")
            .eq("lecture_id", item["lecture_id"])
            .order("slide_number")
            .execute()
            .data or []
        )
        if len(slides) < 2:
            raise HTTPException(status_code=409, detail="This material needs at least two slides before it can be split.")
        available_numbers = [int(slide["slide_number"]) for slide in slides]
        boundary = body.after_slide or available_numbers[len(available_numbers) // 2 - 1]
        if boundary not in available_numbers or boundary >= available_numbers[-1]:
            raise HTTPException(status_code=400, detail="Choose a slide boundary before the final slide.")
        moving_slides = [slide for slide in slides if int(slide["slide_number"]) > boundary]
        if not moving_slides:
            raise HTTPException(status_code=409, detail="There are no slides after that boundary to create a second lecture.")

        original_res = (
            supabase_admin.table("lectures")
            .select("title, description, pdf_url, pdf_hash, professor_id, visibility, student_owner_id, lecture_type, subject, course_code, key_topics")
            .eq("id", item["lecture_id"])
            .limit(1)
            .execute()
        )
        if not original_res.data:
            raise HTTPException(status_code=404, detail="The parsed lecture is no longer available.")
        original = original_res.data[0]
        split_title = f"{item['title']} (Part 2)"
        clone_payload = {
            "title": split_title,
            "description": original.get("description") or "",
            "pdf_url": original.get("pdf_url"),
            "pdf_hash": original.get("pdf_hash"),
            "professor_id": original.get("professor_id"),
            "student_owner_id": original.get("student_owner_id"),
            "visibility": original.get("visibility") or "course",
            "lecture_type": original.get("lecture_type"),
            "subject": original.get("subject"),
            "course_code": original.get("course_code"),
            "key_topics": original.get("key_topics"),
            "total_slides": len(moving_slides),
            "is_archived": False,
        }
        clone_res = supabase_admin.table("lectures").insert(clone_payload).execute()
        if not clone_res.data:
            raise HTTPException(status_code=500, detail="Could not create the second lecture.")
        clone = clone_res.data[0]

        moving_ids = [slide["id"] for slide in moving_slides]
        supabase_admin.table("slides").update({"lecture_id": clone["id"]}).in_("id", moving_ids).execute()
        # Retrieval chunks use zero-based page indexes while slides use
        # one-based numbers. Moving them preserves grounded answers for both
        # resulting lecture views.
        supabase_admin.table("slide_chunks").update({"lecture_id": clone["id"]}).eq("lecture_id", item["lecture_id"]).gte("page_index", min(int(slide["slide_number"]) for slide in moving_slides) - 1).execute()
        supabase_admin.table("lectures").update({"total_slides": len(slides) - len(moving_slides)}).eq("id", item["lecture_id"]).execute()

        # Shift later draft items down in reverse order to preserve the unique
        # `(blueprint_id, position)` invariant while inserting the new part.
        later_items = (
            supabase_admin.table("course_blueprint_items")
            .select("id, position")
            .eq("blueprint_id", blueprint_id)
            .gt("position", item["position"])
            .order("position", desc=True)
            .execute()
            .data or []
        )
        for later in later_items:
            supabase_admin.table("course_blueprint_items").update({"position": int(later["position"]) + 1}).eq("id", later["id"]).execute()

        original_range = {"start_slide": available_numbers[0], "end_slide": boundary}
        split_range = {"start_slide": min(int(slide["slide_number"]) for slide in moving_slides), "end_slide": available_numbers[-1]}
        supabase_admin.table("course_blueprint_items").update({"source_range": original_range}).eq("id", item_id).execute()
        supabase_admin.table("course_blueprint_items").insert({
            "blueprint_id": blueprint_id,
            "material_source_id": item["material_source_id"],
            "lecture_id": clone["id"],
            "title": split_title,
            "position": int(item["position"]) + 1,
            "classification": item["classification"],
            "confidence": item["confidence"],
            "include_in_course": item["include_in_course"],
            "source_range": split_range,
            "split_from_item_id": item_id,
        }).execute()
        return _serialize_blueprint(_fetch_blueprint(blueprint_id, uid) or blueprint)

    return {"success": True, "data": await run_in_threadpool(_split)}


def _materialize_blueprint_groups(items: list[dict[str, Any]], course_id: str, owner_id: str) -> None:
    """Publish one visible lecture per draft group without mutating sources.

    The parser has already produced a lecture for every source. A merge keeps
    that provenance intact but moves each child lecture's slides and review
    cards below the first lecture in the editable group, then archives the
    child so the learner sees one deliberate course item.
    """
    group_roots: dict[str, dict[str, Any]] = {}
    for item in items:
        group_roots.setdefault(item.get("lecture_group_id") or item["id"], item)

    for item in group_roots.values():
        lecture_res = supabase_admin.table("lectures").select("visibility").eq("id", item["lecture_id"]).single().execute()
        lecture = lecture_res.data or {}
        update: dict[str, Any] = {"course_id": course_id, "title": item["title"], "is_archived": False}
        if lecture.get("visibility") == "private_student":
            update.update({"visibility": "course", "professor_id": owner_id, "student_owner_id": None})
        supabase_admin.table("lectures").update(update).eq("id", item["lecture_id"]).execute()

    for item in items:
        root = group_roots[item.get("lecture_group_id") or item["id"]]
        if item["lecture_id"] == root["lecture_id"]:
            continue
        # The original material-source and parse-run records remain untouched.
        supabase_admin.table("slides").update({"lecture_id": root["lecture_id"]}).eq("lecture_id", item["lecture_id"]).execute()
        supabase_admin.table("review_cards").update({"lecture_id": root["lecture_id"]}).eq("lecture_id", item["lecture_id"]).execute()
        supabase_admin.table("lectures").update({"course_id": course_id, "is_archived": True}).eq("id", item["lecture_id"]).execute()


@router.post("/blueprints/{blueprint_id}/create-course")
@limiter.limit("20/minute")
async def create_course_from_blueprint(request: Request, blueprint_id: str, user: Any = Depends(require_creator)):
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    def _create():
        blueprint = _fetch_blueprint(blueprint_id, uid)
        if not blueprint:
            raise HTTPException(status_code=404, detail="Course blueprint not found.")
        items = (
            supabase_admin.table("course_blueprint_items")
            .select("id, lecture_id, title, position, lecture_group_id")
            .eq("blueprint_id", blueprint_id)
            .eq("include_in_course", True)
            .not_.is_("lecture_id", "null")
            .order("position")
            .execute()
            .data or []
        )
        if blueprint.get("course_id"):
            course = supabase_admin.table("courses").select("id, title, description").eq("id", blueprint["course_id"]).single().execute()
            if not course.data:
                raise HTTPException(status_code=404, detail="Target course not found.")
            if items:
                _materialize_blueprint_groups(items, course.data["id"], uid)
            if blueprint.get("status") != "created":
                supabase_admin.table("course_blueprints").update({"status": "created"}).eq("id", blueprint_id).execute()
                blueprint["status"] = "created"
            return {"course": course.data, "blueprint": _serialize_blueprint(blueprint)}
        if not items:
            raise HTTPException(status_code=409, detail="At least one processed lecture is required to create a course.")
        created = supabase_admin.table("courses").insert({
            "professor_id": uid,
            "title": blueprint["title"],
            "description": blueprint.get("description") or None,
        }).execute()
        if not created.data:
            raise HTTPException(status_code=500, detail="Could not create course.")
        course = created.data[0]
        _materialize_blueprint_groups(items, course["id"], uid)
        supabase_admin.table("course_blueprints").update({"course_id": course["id"], "status": "created"}).eq("id", blueprint_id).execute()
        updated = _fetch_blueprint(blueprint_id, uid) or blueprint
        return {"course": course, "blueprint": _serialize_blueprint(updated)}

    return {"success": True, "data": await run_in_threadpool(_create)}
