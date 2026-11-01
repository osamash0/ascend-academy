"""New run for the webpage: the methods and their readiness, PDF uploads, and background jobs."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, Query, Request, UploadFile
from pydantic import BaseModel, StrictBool

from backend.eval.parser_bench import execute, files, paid, store, tools
from backend.eval.parser_bench.api_runs import root_of

router = APIRouter(prefix="/api")


class JobsIn(BaseModel):
    sha256: str
    tools: list[str]
    purpose: str = "explore"
    cost_ok: StrictBool = False  # only a JSON true: the OK given after the estimate was shown


def _file(stored: files.StoredFile) -> dict[str, Any]:
    return {**stored.as_dict(), "benchmark_pages": execute.benchmark_pages(stored.sha256)}


@router.get("/methods")
def methods() -> dict[str, Any]:
    return {"groups": list(tools.GROUPS), "methods": [
        {"id": t.id, "label": t.label, "group": t.group, "description": t.description,
         "ready": tools.is_ready(t), "missing": tools.missing(t), "size_mb": t.size_mb,
         "needs_install": tools.needs_install(t), "paid": t.paid, "model": t.model or None,
         "key_missing": (paid.key_problem() is not None) if t.paid else None}
        for t in tools.TOOLS.values()]}


@router.get("/estimate")
def estimate(request: Request, sha256: str, methods_: str = Query(..., alias="tools"),
             purpose: str = "explore") -> dict[str, Any]:
    """What a run of the paid methods among `tools` would send and cost; the New run screen shows it before
    the cost OK."""
    if purpose not in store.PURPOSES:
        raise ValueError(f"purpose must be one of {store.PURPOSES}")
    stored = files.find_file(files.check_sha(sha256), root_of(request))
    pages = request.app.state.jobs.pages_for(stored, purpose)
    out = []
    for tool_id in dict.fromkeys(m for m in methods_.split(",") if m):
        tool = tools.TOOLS.get(tool_id)
        if tool is None:
            raise ValueError(f"unknown method {tool_id!r}")
        if tool.paid:
            out.append({"tool": tool.id, "label": tool.label, **paid.estimate(tool.model, len(pages)).as_dict()})
    return {"file": stored.name, "purpose": purpose, "estimates": out}


@router.get("/files")
def stored_files(request: Request) -> dict[str, Any]:
    return {"files": [_file(f) for f in files.list_files(root_of(request))]}


@router.post("/files")
def upload(request: Request, file: UploadFile = File(...)) -> dict[str, Any]:
    data = file.file.read(files.MAX_BYTES + 1)  # a plain def: FastAPI runs it in the threadpool, off the event loop
    return _file(files.store_pdf(data, file.filename or "upload.pdf", root=root_of(request)))


@router.get("/jobs")
def job_list(request: Request) -> dict[str, Any]:
    return {"jobs": request.app.state.jobs.list()}


@router.post("/jobs")
def start_jobs(body: JobsIn, request: Request) -> dict[str, Any]:
    if not body.tools:
        raise ValueError("tick at least one method")
    if body.purpose not in store.PURPOSES:
        raise ValueError(f"purpose must be one of {store.PURPOSES}")
    unknown = [t for t in body.tools if t not in tools.TOOLS]
    if unknown:
        raise ValueError(f"unknown methods: {', '.join(unknown)}")
    unconfirmed = [t for t in body.tools if tools.TOOLS[t].paid and not body.cost_ok]
    if unconfirmed:  # a refusal queues nothing
        raise ValueError(f"{', '.join(unconfirmed)} send page images to OpenAI and cost money; confirm the cost first")
    queue = request.app.state.jobs
    return {"jobs": queue.submit_runs(body.tools, sha256=body.sha256, purpose=body.purpose, cost_ok=body.cost_ok)}


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str, request: Request) -> dict[str, Any]:
    return request.app.state.jobs.cancel(job_id)


@router.post("/methods/{tool_id}/install")
def install(tool_id: str, request: Request) -> dict[str, Any]:
    return request.app.state.jobs.submit_install(tool_id)
