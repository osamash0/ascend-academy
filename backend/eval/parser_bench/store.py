"""Run records: every extraction is a permanent, uniquely named folder.

A run is written while its status is "running" and sealed by finish(). After
that every write raises RunFinishedError, so a result is never edited in place:
running again makes a new run. Failed runs are kept, with their reason.
"""
from __future__ import annotations

import csv
import functools
import hashlib
import json
import os
import platform
import re
import secrets
import shutil
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

REPO = Path(__file__).resolve().parents[3]
EXPORT_DIR = REPO / "docs" / "thesis" / "experiments" / "parser-benchmark" / "data"
PURPOSES = ("explore", "benchmark")
RECORD_VERSION = 1  # bumped whenever the shape of run.json changes
# What create() records about a run's identity and origin; finish() may not overwrite any of it.
RESERVED = frozenset({
    "run_id", "kind", "tool", "version", "purpose", "source", "git", "machine", "started_at",
    "record_version", "status", "reason", "finished_at",
})
# The only files export copies, per kind of run: numbers and choices, never slide text or logs.
EXPORTED = {
    "extract": ("run.json", "checks.csv"),
    "compare": ("compare.json", "results.json", "votes.jsonl"),
}


class RunFinishedError(RuntimeError):
    """A finished run is a permanent record; nothing may be written into it."""


_RUN_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")


@functools.lru_cache(maxsize=1)
def _main_checkout() -> Path | None:
    """The main checkout when this code runs from a git worktree: the folder holding the shared .git."""
    try:
        out = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--git-common-dir"],
                             capture_output=True, text=True, timeout=10, check=True).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
    if not out:
        return None
    common = Path(out)
    return (common if common.is_absolute() else REPO / common).resolve().parent


def _guarded() -> list[Path]:
    """Folders the data may never live in: this checkout, and the main checkout it was made from."""
    main = _main_checkout()
    return [REPO] + ([main] if main is not None and main != REPO else [])


def data_root() -> Path:
    """Where runs live. Never inside a checkout of the repository: slide text must not reach the public repo."""
    root = Path(os.environ.get("PARSER_BENCH_DIR") or Path.home() / "Documents" / "learnstation-parser-bench")
    root = root.expanduser().resolve()
    for repo in _guarded():
        if root.is_relative_to(repo):
            raise ValueError(f"PARSER_BENCH_DIR {root} is inside the repository {repo}; slide text must stay out of git")
    return root


# checks.csv holds text; these are the types its columns were written from (checks.CHECK_FIELDS).
_INT_FIELDS = frozenset({
    "page", "footer_leaks", "wrong_symbols", "lonely_bullets", "line_breaks", "broken_lines",
    "headings", "list_items", "max_depth", "tables", "math_spans", "chars",
})
_FLOAT_FIELDS = frozenset({"footer_token_share", "broken_line_pct", "dropped_words_pct", "invented_words_pct"})
_BOOL_FIELDS = frozenset({"footer_leaked", "title_first"})


def typed_check(row: Mapping[str, str]) -> dict[str, Any]:
    """One checks.csv row with its numbers, flags and nulls back (csv writes None as an empty cell).
    Unknown columns stay text; columns an older checks version did not write stay absent."""
    out: dict[str, Any] = {}
    for key, raw in row.items():
        if raw is None or raw == "":
            out[key] = None
        elif key in _BOOL_FIELDS:
            out[key] = {"True": True, "False": False}.get(raw)
        elif key in _INT_FIELDS:
            out[key] = int(raw)
        elif key in _FLOAT_FIELDS:
            out[key] = float(raw)
        else:
            out[key] = raw
    return out


def record_version(meta: Mapping[str, Any]) -> int:
    """Records written before run.json carried a version are version 0."""
    return int(meta.get("record_version") or 0)


def checks_version(meta: Mapping[str, Any]) -> int:
    """Runs scored before run.json named the checks version were scored by checks version 1."""
    value = meta.get("checks_version")
    return 1 if value is None else int(value)


def _slug(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9.]+", "-", s).strip("-").lower() or "x"


def new_run_id(tool: str, version: str, *, now: datetime | None = None, token: str | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    return f"{now:%Y-%m-%d}_{_slug(tool)}-{_slug(version)}_{token or secrets.token_hex(2)}"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def git_state(repo: Path = REPO) -> dict[str, Any]:
    def git(*args: str) -> str:
        return subprocess.run(
            ["git", "-C", str(repo), *args], capture_output=True, text=True, check=True
        ).stdout.strip()

    try:
        return {"commit": git("rev-parse", "HEAD"), "dirty": bool(git("status", "--porcelain"))}
    except (OSError, subprocess.CalledProcessError):
        return {"commit": None, "dirty": None}


def machine() -> dict[str, Any]:
    import psutil

    return {
        "platform": platform.platform(),
        "macos": platform.mac_ver()[0] or None,
        "arch": platform.machine(),
        "cpu_count": os.cpu_count(),
        "ram_gb": round(psutil.virtual_memory().total / 2**30, 1),
        "python": platform.python_version(),
    }


def _write_text(path: Path, text: str) -> None:
    """Write to a temporary file, flush it to disk, then replace: a crash leaves the old file or the
    new one, never a half-written record."""
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def _write_json(path: Path, data: Mapping[str, Any]) -> None:
    _write_text(path, json.dumps(data, ensure_ascii=False, indent=2))


def _write_bytes(path: Path, data: bytes) -> None:
    """Like _write_text, for bytes that must land exactly as given."""
    tmp = path.with_suffix(".tmp")
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def _export_votes(raw: bytes, home: str) -> tuple[bytes, dict[str, Any]]:
    """votes.jsonl for the thesis: every line byte for byte, so its digest still matches results.json, except
    that a vote's note (it may quote a slide) becomes null, a line holding the home folder gets ~, and a line
    that does not parse (a torn write, which could hold half a note) is blanked. The report says what changed."""
    lines: list[bytes] = []
    blanked = rewritten = torn = 0
    for line in raw.split(b"\n"):
        if not line.strip():
            lines.append(line)
            continue
        try:
            row = json.loads(line.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            lines.append(b"")
            torn += 1
            continue
        changed = False
        if isinstance(row, dict) and row.get("note") is not None:
            row["note"] = None
            blanked += 1
            changed = True
        if home in line.decode("utf-8"):
            row = _home_as_tilde(row, home)
            changed = True
        if changed:
            rewritten += 1
            line = json.dumps(row, ensure_ascii=False).encode("utf-8")
        lines.append(line)
    out = b"\n".join(lines)
    return out, {
        "votes_digest": hashlib.sha256(raw).hexdigest(),
        "exported_digest": hashlib.sha256(out).hexdigest(),
        "identical": out == raw,
        "notes_blanked": blanked,
        "lines_rewritten": rewritten,
        "torn_lines_blanked": torn,
    }


@dataclass(frozen=True)
class ExtractRun:
    path: Path

    @property
    def run_id(self) -> str:
        return self.path.name

    @property
    def meta(self) -> dict[str, Any]:
        return json.loads((self.path / "run.json").read_text(encoding="utf-8"))

    @classmethod
    def create(
        cls,
        *,
        tool: str,
        version: str,
        source: Mapping[str, Any],
        purpose: str,
        settings: Mapping[str, Any] | None = None,
        started_at: str | None = None,
        extra: Mapping[str, Any] | None = None,
        root: Path | None = None,
        git: dict[str, Any] | None = None,
        checks_version: int | None = None,
    ) -> "ExtractRun":
        """`git` is the repository state when the run started (default: now); `checks_version` is
        the version of the checks that will score it (checks.CHECKS_VERSION, passed by execute)."""
        if purpose not in PURPOSES:
            raise ValueError(f"purpose must be one of {PURPOSES}, not {purpose!r}")
        base = (root or data_root()) / "runs" / "extract"
        base.mkdir(parents=True, exist_ok=True)
        while True:
            path = base / new_run_id(tool, version)
            try:
                path.mkdir()
                break
            except FileExistsError:
                continue
        (path / "pages").mkdir()
        _write_json(path / "run.json", {
            "run_id": path.name,
            "kind": "extract",
            "record_version": RECORD_VERSION,
            "checks_version": checks_version,
            "tool": tool,
            "version": version,
            "settings": dict(settings or {}),
            "purpose": purpose,
            "source": dict(source),
            "git": git_state() if git is None else dict(git),
            "machine": machine(),
            "started_at": started_at or now_iso(),
            "finished_at": None,
            "status": "running",
            "reason": None,
            **dict(extra or {}),
        })
        return cls(path)

    def _open(self) -> dict[str, Any]:
        meta = self.meta
        if meta["status"] != "running":
            raise RunFinishedError(f"{self.run_id} is {meta['status']}; start a new run instead")
        return meta

    def write_page(self, page: int, text: str) -> None:
        self._open()
        (self.path / "pages" / f"p{page:04d}.md").write_text(text, encoding="utf-8")

    def write_checks(self, rows: Sequence[Mapping[str, Any]]) -> None:
        self._open()
        if not rows:
            return
        with open(self.path / "checks.csv", "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)

    def append_log(self, text: str) -> None:
        self._open()
        with open(self.path / "log.txt", "a", encoding="utf-8") as f:
            f.write(text)

    def finish(self, status: str, *, reason: str | None = None, **fields: Any) -> None:
        if status not in ("finished", "failed"):
            raise ValueError("a run finishes as 'finished' or 'failed'")
        clash = sorted(RESERVED & set(fields))
        if clash:
            raise ValueError(f"finish() may not overwrite {', '.join(clash)}: create() recorded them")
        meta = self._open()
        meta.update(fields)
        meta.update(status=status, reason=reason, finished_at=now_iso())
        _write_json(self.path / "run.json", meta)

    def pages(self) -> dict[int, str]:
        return {
            int(p.stem[1:]): p.read_text(encoding="utf-8")
            for p in sorted((self.path / "pages").glob("p*.md"))
        }

    def checks(self) -> list[dict[str, str]]:
        f = self.path / "checks.csv"
        if not f.exists():
            return []
        with open(f, newline="", encoding="utf-8") as fh:
            return list(csv.DictReader(fh))

    def typed_checks(self) -> list[dict[str, Any]]:
        return [typed_check(row) for row in self.checks()]


def _record(run_dir: Path) -> Path | None:
    for name in ("run.json", "compare.json"):
        if (run_dir / name).exists():
            return run_dir / name
    return None


def list_runs(root: Path | None = None) -> list[dict[str, Any]]:
    base = (root or data_root()) / "runs"
    metas = []
    for kind in ("extract", "compare"):
        folder = base / kind
        if not folder.is_dir():
            continue
        for run_dir in folder.iterdir():
            rec = _record(run_dir) if run_dir.is_dir() else None
            if rec:
                metas.append(json.loads(rec.read_text(encoding="utf-8")))
    return sorted(metas, key=lambda m: m.get("started_at") or "", reverse=True)


def find_run(run_id: str, root: Path | None = None) -> Path:
    if not _RUN_ID.fullmatch(run_id) or ".." in run_id:
        raise ValueError(f"{run_id!r} is not a run id")
    base = (root or data_root()) / "runs"
    for kind in ("extract", "compare"):
        if (base / kind / run_id).is_dir():
            return base / kind / run_id
    raise FileNotFoundError(f"no run {run_id!r} under {base}")


def _home_as_tilde(value: Any, home: str) -> Any:
    """Every string in a JSON value, keys included, with the home folder written as ~."""
    if isinstance(value, str):
        return value.replace(home, "~")
    if isinstance(value, dict):
        return {_home_as_tilde(k, home): _home_as_tilde(v, home) for k, v in value.items()}
    if isinstance(value, list):
        return [_home_as_tilde(v, home) for v in value]
    return value


def export_run(run_id: str, *, root: Path | None = None, dest: Path = EXPORT_DIR) -> Path:
    """Copy a benchmark run's number-only files into the repo for the thesis.

    Only the files EXPORTED lists for the run's kind are copied; absent ones are skipped. JSON files are
    sanitised in memory before anything is written: the record loses the local PDF path and the home folder
    becomes ~. votes.jsonl is copied line by line, byte for byte (see _export_votes), and export.json records
    its digests and what was blanked. The record is written last.
    """
    src = find_run(run_id, root)
    rec = _record(src)
    if rec is None:
        raise FileNotFoundError(f"{run_id} has no run.json or compare.json")
    meta = json.loads(rec.read_text(encoding="utf-8"))
    if meta.get("status") in ("running", "judging"):
        raise ValueError(f"{run_id} is still {meta['status']}")
    if meta.get("purpose") != "benchmark":
        raise ValueError(f"{run_id} has purpose {meta.get('purpose')!r}; only benchmark runs count for the thesis")
    if isinstance(meta.get("source"), dict):
        meta["source"].pop("path", None)
    home = str(Path.home())

    json_files: dict[str, Any] = {}
    byte_files: dict[str, bytes] = {}
    copied: list[str] = []
    report: dict[str, Any] | None = None
    for name in EXPORTED[src.parent.name]:
        f = src / name
        if name == rec.name or not f.is_file():
            continue
        if name == "votes.jsonl":
            byte_files[name], report = _export_votes(f.read_bytes(), home)
        elif name.endswith(".json"):
            json_files[name] = _home_as_tilde(json.loads(f.read_text(encoding="utf-8")), home)
        else:
            copied.append(name)  # checks.csv: numbers only
    meta = _home_as_tilde(meta, home)

    out = dest / run_id
    out.mkdir(parents=True, exist_ok=True)
    for name in copied:
        shutil.copyfile(src / name, out / name)
    for name, data in byte_files.items():
        _write_bytes(out / name, data)
    for name, data in json_files.items():
        _write_json(out / name, data)
    if report is not None:
        _write_json(out / "export.json", report)
    _write_json(out / rec.name, meta)
    return out
