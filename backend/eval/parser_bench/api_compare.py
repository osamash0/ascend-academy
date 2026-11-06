"""Blind judging for the webpage. While a benchmark comparison is being judged, nothing here names
a tool or a run: a duel is a page image and two outputs called left and right. Names, results and
My votes open when judging is finished (or after an early unlock, which the lab log records)."""
from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Any, Iterator

from fastapi import APIRouter, Request
from pydantic import BaseModel, StrictFloat, StrictInt

from backend.eval.parser_bench import blinding, results
from backend.eval.parser_bench.api_runs import root_of
from backend.eval.parser_bench.compare import CompareRun, list_comparisons

router = APIRouter(prefix="/api/comparisons")
log = logging.getLogger(__name__)


class VoteIn(BaseModel):
    duel: int
    choice: str
    seconds: StrictFloat | StrictInt  # a JSON true/false is refused, not read as 1.0/0.0
    session: str
    note: str | None = None


class SessionIn(BaseModel):
    session: str


class UnlockIn(BaseModel):
    reason: str


def _summary(cmp: CompareRun) -> dict[str, Any]:
    meta = cmp.meta
    done, total = cmp.progress()
    return {"run_id": meta["run_id"], "purpose": meta["purpose"], "status": meta["status"], "started_at": meta["started_at"],
            "done": done, "total": total, "rounds": None if blinding.comparison_locked(meta) else meta["rounds"], "unlocked_early": meta.get("unlocked_early"),
            "locked": blinding.comparison_locked(meta), "pages": [{"key": p["key"], "type": p["type"]} for p in meta["pages"]]}


@contextmanager
def _no_names() -> Iterator[None]:
    """A missing run directory or output must never reach the browser with its message: that text holds
    the tool's name, a run id and a local path, which would break the blinding. The judge watches the
    server's terminal too, so the log names only the error's type and where it came from."""
    try:
        yield
    except (FileNotFoundError, KeyError) as exc:
        frame = exc.__traceback__
        while frame.tb_next is not None:
            frame = frame.tb_next
        code = frame.tb_frame.f_code
        log.error("masked %s in %s (%s:%d) during blind judging", type(exc).__name__, code.co_name,
                  code.co_filename.rsplit("/", 1)[-1], frame.tb_lineno)
        raise FileNotFoundError("an output for this duel is missing; judging cannot continue") from None


def _open(cmp: CompareRun) -> None:
    if blinding.comparison_locked(cmp.meta):
        raise blinding.Locked("names and results open when judging is finished")


@router.get("")
def comparisons(request: Request) -> dict[str, Any]:
    return {"comparisons": [_summary(c) for c in list_comparisons(root_of(request))]}


@router.get("/{run_id}/next")
def next_duel(run_id: str, request: Request) -> dict[str, Any]:
    root = root_of(request)
    cmp = CompareRun.open(run_id, root)
    done, total = cmp.progress()
    duel = cmp.next_duel() if cmp.meta["status"] == "judging" else None
    if duel is None:
        return {"finished": cmp.meta["status"] == "finished", "done": done, "total": total}
    with _no_names():
        page = cmp.page(duel["page"])
        left, right = cmp.output(duel["left"], duel["page"], root), cmp.output(duel["right"], duel["page"], root)
    body = {
        "finished": False, "done": done, "total": total, "duel": duel["duel"],
        "page": {"key": page["key"], "type": page["type"], "number": page["page"], "file": page["file"],
                 "png": f"/api/files/{page['sha256']}/pages/{page['page']}.png"},
        "left": {"markdown": left},
        "right": {"markdown": right},
    }
    if not blinding.comparison_locked(cmp.meta):  # a round number tells the judge whether the top two overlap
        body["round"] = duel["round"]
    return body


@router.post("/{run_id}/votes")
def vote(run_id: str, body: VoteIn, request: Request) -> dict[str, Any]:
    root = root_of(request)
    cmp = CompareRun.open(run_id, root)
    line = cmp.vote(duel=body.duel, choice=body.choice, seconds=body.seconds, session=body.session, note=body.note)
    with _no_names():
        step = results.advance(cmp, resamples=request.app.state.resamples, root=root)
    done, total = cmp.progress()
    body = {"vote_id": line["vote_id"], "done": done, "total": total, "finished": step["finished"]}
    if not blinding.comparison_locked(cmp.meta):  # "added" would say that round 2 started, so only after judging
        body["added"] = step["added"]
    return body


@router.post("/{run_id}/undo")
def undo(run_id: str, body: SessionIn, request: Request) -> dict[str, Any]:
    cmp = CompareRun.open(run_id, root_of(request))
    with _no_names():
        line = cmp.undo(session=body.session)
    return {"retracted": None if line is None else line["duel"]}


@router.get("/{run_id}/results")
def comparison_results(run_id: str, request: Request) -> dict[str, Any]:
    root = root_of(request)
    cmp = CompareRun.open(run_id, root)
    _open(cmp)
    return results.current_results(cmp, resamples=request.app.state.resamples, root=root)


@router.get("/{run_id}/votes")
def my_votes(run_id: str, request: Request) -> dict[str, Any]:
    """Every vote with both names, the pick, the seconds and the note; withdrawn ones marked."""
    cmp = CompareRun.open(run_id, root_of(request))
    _open(cmp)
    events = cmp.events()
    withdrawn = {e["vote_id"] for e in events if e["type"] == "retract"}
    types = {p["key"]: p["type"] for p in cmp.meta["pages"]}
    votes = [{**{k: e[k] for k in ("vote_id", "duel", "page", "left", "right", "choice", "seconds", "note", "at", "session")},
              "type": types.get(e["page"]), "withdrawn": e["vote_id"] in withdrawn}
             for e in events if e["type"] == "vote"]
    return {"run_id": run_id, "votes": votes}


@router.post("/{run_id}/unlock")
def unlock(run_id: str, body: UnlockIn, request: Request) -> dict[str, Any]:
    cmp = CompareRun.open(run_id, root_of(request))
    blinding.unlock_early(cmp, body.reason)
    return _summary(cmp)
