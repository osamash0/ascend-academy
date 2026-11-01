"""`marker`: marker-pdf's PdfConverter on its defaults, with paginate_output on, so that the Markdown marks
where each page starts (spec: "output split by page"). LLM enhancement stays off: use_llm is marker's default
False and is never set. Marker picks its own mode and device (on Apple Silicon: its "fast" mode, torch on MPS,
and its surya VLM through a local llama.cpp llama-server that it starts and stops itself, for equations and for
blocks whose text layer is bad).

Servers: surya keeps the servers it starts (layout, OCR error and the VLM's llama-server) alive after their
process, and a later run attaches to any healthy one named in its registry folder
(surya/inference/backends/spawn.py: `_cache_dir()` holds every sentinel and lock). That would leave servers behind
and let a later run skip the start-up time and memory of the servers it uses. So the registry is pointed at a
temporary folder of this run only, every server this run uses is its own child, and every one is stopped before
the runner exits, on success and on failure.

Exits non-zero, writing nothing, unless the page marks give back exactly the pages of the PDF in order with no
text before the first mark: a partial result must never be scored as marker's result.

Usage: python -I marker_runner.py <in.pdf> <out.json>
"""
import json
import os
import re
import shutil
import signal
import sys
import tempfile
import time
from importlib.metadata import version
from pathlib import Path

# marker's paginated Markdown: a line "{N}" followed by 48 dashes before each page, N the zero-based page id.
MARK = re.compile(r"^\{(\d+)\}-{48}$", re.M)
SERVER_GRACE = 5.0  # seconds a server gets after SIGTERM before SIGKILL


def split_pages(markdown: str, page_count: int) -> dict:
    """{"1": text, ..., "N": text} from marker's paginated Markdown; ValueError unless the marks are 0..N-1 in
    order and nothing but white space precedes the first."""
    marks = list(MARK.finditer(markdown))
    ids = [int(m.group(1)) for m in marks]
    if not marks or ids != list(range(page_count)):
        raise ValueError(f"page marks {ids[:12]} for a PDF of {page_count} pages (expected 0..{page_count - 1})")
    before = markdown[: marks[0].start()].strip()
    if before:
        raise ValueError(f"{len(before)} characters of text before the first page mark")
    pages = {}
    for i, mark in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(markdown)
        pages[str(ids[i] + 1)] = markdown[mark.end():end].strip()
    return pages


def device() -> str:
    """The torch device marker's settings resolve to here, or "unknown" when it cannot be read."""
    try:
        from marker.settings import settings

        return str(settings.TORCH_DEVICE_MODEL)
    except Exception:
        return "unknown"


def count_pages(path: str) -> int:
    import pypdfium2

    pdf = pypdfium2.PdfDocument(path)
    try:
        return len(pdf)
    finally:
        pdf.close()


def isolate_servers(spawn_module, run_dir) -> Path:
    """Point surya's server registry (`_cache_dir`, which every sentinel and lock path goes through) at a folder
    inside `run_dir`, so this run neither finds another run's servers nor leaves its own where a later run finds
    them. Returns the folder."""
    folder = Path(run_dir) / "servers"
    folder.mkdir(parents=True, exist_ok=True)

    def cache_dir() -> Path:
        folder.mkdir(parents=True, exist_ok=True)
        return folder

    spawn_module._cache_dir = cache_dir
    return folder


def _alive(pid: int) -> bool:
    try:
        if os.waitpid(pid, os.WNOHANG)[0] == pid:  # our own child that has exited: reaped now
            return False
    except ChildProcessError:
        pass
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _signal(pid: int, sig: int) -> None:
    """Signal a server and what it started: its whole process group when it leads one (surya starts its servers
    with start_new_session=True), else the process alone."""
    try:
        if os.getpgid(pid) == pid and pid != os.getpgrp():
            os.killpg(pid, sig)
        else:
            os.kill(pid, sig)
    except (ProcessLookupError, PermissionError):
        pass


def _stop(pids: list, grace: float) -> None:
    for pid in pids:
        _signal(pid, signal.SIGTERM)
    deadline = time.monotonic() + grace
    while time.monotonic() < deadline and any(_alive(pid) for pid in pids):
        time.sleep(0.1)
    for pid in pids:
        if _alive(pid):
            _signal(pid, signal.SIGKILL)
    for _ in range(50):
        if not any(_alive(pid) for pid in pids):
            return
        time.sleep(0.1)


def stop_servers(folder, grace: float = SERVER_GRACE) -> None:
    """Stop every server named in the sentinel files of `folder` (SIGTERM, `grace` seconds, SIGKILL)."""
    pids = []
    for sentinel in sorted(Path(folder).glob("*_server.json")):
        try:
            pid = json.loads(sentinel.read_text(encoding="utf-8")).get("pid")
        except (OSError, ValueError, AttributeError):
            continue
        if isinstance(pid, int) and not isinstance(pid, bool) and pid > 1 and pid not in pids:
            pids.append(pid)
    _stop(pids, grace)


def stop_children(grace: float = SERVER_GRACE) -> None:
    """Stop every process still running under this one (a server whose sentinel was never written, say). Without
    psutil there is nothing to do: the sentinels have been handled and execute.py reaps the process group."""
    try:
        import psutil

        pids = [child.pid for child in psutil.Process().children(recursive=True)]
    except Exception:
        return
    _stop(pids, grace)


def main(argv: list) -> None:
    # In the run's own working folder: execute.invoke() starts every runner there and removes it after the run,
    # killed or not, so nothing of this run stays in the system temp folder.
    run_dir = tempfile.mkdtemp(prefix="ls-marker-", dir=os.getcwd())
    folder = Path(run_dir) / "servers"
    try:
        _convert(argv, run_dir)
    finally:  # success or failure: no server of this run outlives it
        cleanup(folder, run_dir)


def cleanup(folder, run_dir) -> None:
    """Every step runs even if an earlier one fails, and a failing step never raises: during an exception it would
    replace the conversion's own error. A step's error goes to stderr, which the run's log keeps."""
    for name, step in (("stop_servers", lambda: stop_servers(folder)), ("stop_children", stop_children),
                       ("remove run folder", lambda: shutil.rmtree(run_dir, ignore_errors=True))):
        try:
            step()
        except Exception as err:
            print(f"marker_runner: cleanup step {name} failed: {err!r}", file=sys.stderr)


def _convert(argv: list, run_dir: str) -> None:
    from surya.inference.backends import spawn  # the registry is redirected before anything can start a server

    isolate_servers(spawn, run_dir)
    from marker.converters.pdf import PdfConverter
    from marker.models import create_model_dict
    from marker.output import text_from_rendered

    src, out = argv[1], argv[2]
    page_count = count_pages(src)
    converter = PdfConverter(artifact_dict=create_model_dict(), config={"paginate_output": True})
    markdown, _, _ = text_from_rendered(converter(src))
    try:
        pages = split_pages(markdown, page_count)
    except ValueError as err:
        raise SystemExit(f"marker_runner: {err}")
    data = {
        "version": version("marker-pdf"),
        # what ran, read back from the converter (marker 2.1.0: .mode resolved from the device, .llm_service None)
        "settings": {"converter": "PdfConverter", "paginate_output": True,
                     "use_llm": bool(converter.config.get("use_llm", False)),
                     "llm_service_used": converter.llm_service is not None,
                     "mode": str(converter.mode), "device": device(),
                     "servers": "started by this run and stopped at its end; never shared between runs"},
        "pages": pages,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv)
