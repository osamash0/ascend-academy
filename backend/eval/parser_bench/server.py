"""The local webpage's server (spec "The webpage"): run data, blind judging and new runs.

FastAPI, because it is already in the backend .venv and brings routing, uploads
(python-multipart) and a test client; the stdlib http.server would need hand-written routing and
multipart parsing (the cgi module is gone since Python 3.13).

Safety: it listens on 127.0.0.1 only; the Host header must be 127.0.0.1 or localhost (no DNS
rebinding); every request that changes something must carry `X-Parser-Bench: 1`, which a form on
another website cannot send. No login: it is a lab tool on Abi's Mac, not part of the product.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from backend.eval.parser_bench import api_compare, api_newrun, api_runs, ranking, store
from backend.eval.parser_bench.blinding import Locked
from backend.eval.parser_bench.jobs import JobQueue

HOST = "127.0.0.1"
DEFAULT_PORT = 8766
VIEWER_DIST = Path(__file__).resolve().parent / "viewer" / "dist"
WRITE_HEADER = "x-parser-bench"
NOT_BUILT = """<!doctype html><meta charset="utf-8"><title>Parser Bench</title>
<body style="background:#0a0a0b;color:#ececee;font:15px system-ui;padding:40px">
<h1 style="font-size:18px">The viewer is not built yet</h1>
<p>Run <code>npx vite build --config backend/eval/parser_bench/viewer/vite.config.ts</code>, then reload.</p>"""


def create_app(*, root: Path | None = None, jobs: JobQueue | None = None, dist: Path = VIEWER_DIST,
               resamples: int = ranking.RESAMPLES) -> FastAPI:
    root = store.data_root() if root is None else root
    queue = jobs if jobs is not None else JobQueue(root)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        queue.start()
        try:
            yield
        finally:
            queue.stop()

    app = FastAPI(title="Parser Bench", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.root, app.state.jobs, app.state.resamples = root, queue, resamples

    @app.middleware("http")
    async def writes_need_the_header(request: Request, call_next):
        if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get(WRITE_HEADER) != "1":
            return JSONResponse({"detail": "changes need the X-Parser-Bench: 1 header"}, status_code=403)
        return await call_next(request)

    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])

    for error, status in ((Locked, 423), (store.RunFinishedError, 409), (FileNotFoundError, 404), (ValueError, 400)):
        app.add_exception_handler(error, _handler(status))

    app.include_router(api_runs.router)
    app.include_router(api_compare.router)
    app.include_router(api_newrun.router)
    if (dist / "index.html").exists():
        app.mount("/", StaticFiles(directory=dist, html=True), name="viewer")
    else:
        @app.get("/", response_class=HTMLResponse)
        def not_built() -> str:
            return NOT_BUILT
    return app


def _handler(status: int):
    async def handle(request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=status)
    return handle


def serve(port: int = DEFAULT_PORT) -> None:
    import uvicorn

    uvicorn.run(create_app(), host=HOST, port=port, log_level="warning")
