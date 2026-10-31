"""Run data for the webpage: the run list, one run's outputs and checks, two runs' differences,
page images, and every output of one page side by side (Compare). Output views respect the
blinding lock."""
from __future__ import annotations

import difflib
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping

from fastapi import APIRouter, Request, Response

from backend.eval.parser_bench import blinding, checks, files, store, tools
from backend.eval.parser_bench.compare import CompareRun

router = APIRouter(prefix="/api")


def root_of(request: Request) -> Path:
    return request.app.state.root


@lru_cache(maxsize=32)
def _facts(pdf: str, mtime: float) -> checks.DocFacts:
    return checks.document_facts(Path(pdf))


def footer_lines(sha256: str, page: int, text: str, root: Path) -> list[int]:
    """The output lines the footer rule removes, for marking; none when the PDF is not on this Mac."""
    try:
        pdf = files.resolve_pdf(sha256, root)
    except FileNotFoundError:
        return []
    facts = _facts(str(pdf), pdf.stat().st_mtime)
    return checks.footer_line_numbers(text, facts.pages[page], facts) if page in facts.pages else []


def model_hidden(meta: Mapping[str, Any], state: blinding.Lock) -> bool:
    """A paid method's model id names the method (and the answering model's own id too), so while a comparison
    is judging any page this run scored, no model id is shown with the run."""
    tool = tools.TOOLS.get(meta.get("tool") or "")
    sha = (meta.get("source") or {}).get("sha256")
    return bool(tool and tool.paid and any((sha, int(p)) in state.judging for p in meta.get("pages_scored") or []))


def summary(meta: Mapping[str, Any], root: Path, state: blinding.Lock | None = None) -> dict[str, Any]:
    """One row of the Runs screen. Missing measures stay null; the viewer shows them as —. `state` is the
    blinding lock, read once by a caller that builds many rows."""
    if meta.get("kind") == "compare":
        cmp = CompareRun(store.find_run(meta["run_id"], root))
        done, total = cmp.progress()
        return {"run_id": meta["run_id"], "kind": "compare", "tool": None, "version": None, "purpose": meta.get("purpose"),
                "status": meta["status"], "started_at": meta.get("started_at"), "done": done, "total": total,
                "pages": [], "pages_total": len(meta.get("pages", [])), "commit": (meta.get("git") or {}).get("commit"),
                "record_version": store.record_version(meta), "checks_version": store.checks_version(meta)}
    source = meta.get("source") or {}
    method = tools.TOOLS.get(meta.get("tool") or "")
    if method is not None and method.paid and state is None:
        state = blinding.lock_state(root)  # only a paid run's version can be a model id
    version = None if state is not None and model_hidden(meta, state) else meta.get("version")  # the paid run's version is its model id
    return {
        "run_id": meta["run_id"], "kind": "extract", "tool": meta.get("tool"), "version": version,
        "purpose": meta.get("purpose"), "status": meta.get("status"), "reason": meta.get("reason"),
        "started_at": meta.get("started_at"), "finished_at": meta.get("finished_at"),
        "file": source.get("name"), "sha256": source.get("sha256"), "pages_total": source.get("pages_total"),
        "pages": meta.get("pages_scored") or [], "seconds_per_page": meta.get("seconds_per_page"),
        "peak_memory_mb": meta.get("peak_memory_mb"), "cost_usd": (meta.get("cost") or {}).get("usd"), "commit": (meta.get("git") or {}).get("commit"),
        "dirty": (meta.get("git") or {}).get("dirty"),
        "record_version": store.record_version(meta), "checks_version": store.checks_version(meta),
    }


@router.get("/runs")
def runs(request: Request) -> dict[str, Any]:
    root = root_of(request)
    state = blinding.lock_state(root)
    return {"runs": [summary(m, root, state) for m in store.list_runs(root)]}


def _extract(run_id: str, root: Path) -> store.ExtractRun:
    path = store.find_run(run_id, root)
    if not (path / "run.json").exists():
        raise FileNotFoundError(f"{run_id} is not an extraction run")
    return store.ExtractRun(path)


@router.get("/runs/{run_id}")
def run_detail(run_id: str, request: Request) -> dict[str, Any]:
    root = root_of(request)
    run = _extract(run_id, root)
    meta = run.meta
    sha = (meta.get("source") or {}).get("sha256")
    state = blinding.lock_state(root)
    pages = [{"page": p, "locked": state.hides(sha, p, meta.get("tool"))} for p in sorted(run.pages())]
    open_pages = {p["page"] for p in pages if not p["locked"]}
    detail = summary(meta, root, state)
    blind = model_hidden(meta, state)
    settings, cost = meta.get("settings"), meta.get("cost")
    api = meta.get("api_usage") if isinstance(meta.get("api_usage"), dict) else None
    # Per-page token counts show the length of each page's output, so, like the per-page checks, only the
    # pages the lock lets open are shown; while a comparison judges this run's pages no model id goes with it.
    api_pages = None if api is None else {
        str(k): {f: v for f, v in usage.items() if not (blind and f == "model")}
        for k, usage in (api.get("pages") or {}).items()
        if str(k).isdigit() and int(k) in open_pages and isinstance(usage, dict)}
    if blind:
        settings = {k: v for k, v in settings.items() if k != "model"} if isinstance(settings, dict) else settings
        cost = {k: v for k, v in cost.items() if k != "price"} if isinstance(cost, dict) else cost
    detail.update(
        environment=meta.get("environment"), settings=settings, failed_stage=meta.get("failed_stage"),
        warmup_seconds=meta.get("warmup_seconds"), seconds_total=meta.get("seconds_total"),
        protocol_commit=meta.get("protocol_commit"), machine=meta.get("machine"),
        page_list=pages, checks=[r for r in run.typed_checks() if r.get("page") in open_pages],
        cost=cost, pages_sent=meta.get("pages_sent"), api_pages=api_pages,
    )
    return detail


@router.get("/runs/{run_id}/pages/{page}")
def run_page(run_id: str, page: int, request: Request) -> dict[str, Any]:
    root = root_of(request)
    run = _extract(run_id, root)
    sha = (run.meta.get("source") or {}).get("sha256")
    if not sha:
        raise FileNotFoundError(f"{run_id} has no recorded source file")
    blinding.check(sha, page, run.meta.get("tool"), blinding.lock_state(root))
    text = run.pages().get(page)
    if text is None:
        raise FileNotFoundError(f"{run_id} has no page {page}")
    row = next((r for r in run.typed_checks() if r.get("page") == page), None)
    return {"run_id": run_id, "page": page, "markdown": text, "footer_lines": footer_lines(sha, page, text, root), "checks": row}


_TOKEN = re.compile(r"\s+|[^\s]+")


def word_diff(a: str, b: str) -> list[dict[str, str]]:
    """Word-level differences from a to b, whitespace kept: [{"op": equal|delete|insert, "text"}]."""
    left, right = _TOKEN.findall(a), _TOKEN.findall(b)
    ops: list[dict[str, str]] = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, left, right, autojunk=False).get_opcodes():
        if tag in ("equal", "delete", "replace") and i2 > i1:
            ops.append({"op": "equal" if tag == "equal" else "delete", "text": "".join(left[i1:i2])})
        if tag in ("insert", "replace") and j2 > j1:
            ops.append({"op": "insert", "text": "".join(right[j1:j2])})
    return ops


@router.get("/diff")
def diff(a: str, b: str, page: int, request: Request) -> dict[str, Any]:
    root = root_of(request)
    first, second = _extract(a, root), _extract(b, root)
    ma, mb = first.meta, second.meta
    if ma.get("tool") != mb.get("tool"):
        raise ValueError("pick two runs of the same method")
    sha_a, sha_b = (ma.get("source") or {}).get("sha256"), (mb.get("source") or {}).get("sha256")
    if not sha_a or sha_a != sha_b:
        raise ValueError("pick two runs of the same file")
    blinding.check(sha_a, page, ma.get("tool"), blinding.lock_state(root))  # both runs are of this method
    ta, tb = first.pages().get(page), second.pages().get(page)
    if ta is None or tb is None:
        raise FileNotFoundError(f"page {page} is not in both runs")
    return {"a": summary(ma, root), "b": summary(mb, root), "page": page, "ops": word_diff(ta, tb)}


@router.get("/files/{sha256}/pages/{page}.png")
def page_image(sha256: str, page: int, request: Request) -> Response:
    return Response(files.page_png(sha256, page, root_of(request)), media_type="image/png",
                    headers={"Cache-Control": "max-age=86400"})


@router.get("/sources")
def sources(request: Request) -> dict[str, Any]:
    """Every PDF with a finished extraction run, with the pages any run scored (Compare's picker). A page is
    listed as locked when no output of it may be named now."""
    root = root_of(request)
    state = blinding.lock_state(root)
    by_sha: dict[str, dict[str, Any]] = {}
    for meta in store.list_runs(root):
        if meta.get("kind") != "extract" or meta.get("status") != "finished":
            continue
        src = meta.get("source") or {}
        if not src.get("sha256"):  # an old or damaged record without a source never takes the whole list down
            continue
        entry = by_sha.setdefault(src["sha256"], {"sha256": src["sha256"], "name": src.get("name") or src["sha256"][:12],
                                                  "pages_total": src.get("pages_total"), "tools": {}, "runs": 0})
        for page in meta.get("pages_scored") or []:
            entry["tools"].setdefault(page, set()).add(meta.get("tool"))
        entry["runs"] += 1
    out = []
    for entry in by_sha.values():
        pages = sorted(entry["tools"])
        locked = [p for p in pages if all(state.hides(entry["sha256"], p, t) for t in entry["tools"][p])]
        out.append({"sha256": entry["sha256"], "name": entry["name"], "pages_total": entry["pages_total"],
                    "pages": pages, "locked": locked, "runs": entry["runs"]})
    return {"sources": sorted(out, key=lambda e: e["name"].lower())}


@router.get("/outputs/{sha256}/{page}")
def outputs(sha256: str, page: int, request: Request) -> dict[str, Any]:
    """Every finished run's output of one page whose method may be named now, with names and checks (Compare).
    A method still hidden on this page is left out and only counted in `hidden`; the page is locked (423)
    while a comparison judges it, or when every output of it is hidden."""
    root = root_of(request)
    files.check_sha(sha256)
    state = blinding.lock_state(root)
    if (sha256, int(page)) in state.judging:
        raise blinding.Locked(blinding.LOCKED_MESSAGE)
    found, hidden = [], 0
    for meta in store.list_runs(root):
        if meta.get("kind") != "extract" or meta.get("status") != "finished" or (meta.get("source") or {}).get("sha256") != sha256:
            continue
        run = store.ExtractRun(store.find_run(meta["run_id"], root))
        text = run.pages().get(page)
        if text is None:
            continue
        if state.hides(sha256, page, meta.get("tool")):
            hidden += 1
            continue
        row = next((r for r in run.typed_checks() if r.get("page") == page), None)
        found.append({**summary(meta, root, state), "markdown": text, "footer_lines": footer_lines(sha256, page, text, root), "checks": row})
    if hidden and not found:
        raise blinding.Locked(blinding.LOCKED_MESSAGE)
    return {"sha256": sha256, "page": page, "outputs": found, "hidden": hidden}
