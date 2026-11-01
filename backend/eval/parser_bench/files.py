"""PDFs for the webpage: uploads stored by SHA-256 under the data directory (never in git), and
the PDF behind any SHA-256 for page images."""
from __future__ import annotations

import hashlib
import os
import re
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from backend.eval.decks import DECK_DIR
from backend.eval.parser_bench import pageset, store
from backend.eval.parser_bench.sources import page_count, render_png, sha256_file

MAX_BYTES = 300 * 2**20
PNG_ZOOM = 2.0
_SHA = re.compile(r"[0-9a-f]{64}")
_resolved: dict[str, Path] = {}  # sha256 → a PDF already verified to have that hash


@dataclass(frozen=True)
class StoredFile:
    sha256: str
    name: str
    path: Path
    pages: int
    size: int

    def as_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data.pop("path")  # the browser never needs a local path
        return data


def files_root(root: Path | None = None) -> Path:
    return (root or store.data_root()) / "files"


def check_sha(sha256: str) -> str:
    if not _SHA.fullmatch(sha256):
        raise ValueError(f"{sha256!r} is not a SHA-256")
    return sha256


def safe_name(name: str) -> str:
    """The upload's own file name, without folders or odd characters, ending in a lowercase .pdf."""
    base = Path((name or "").replace("\\", "/")).name
    cleaned = re.sub(r"[^\w .()+-]", "_", base).strip(" .")[:120]
    stem = cleaned[:-4] if cleaned.lower().endswith(".pdf") else cleaned
    return (stem or "upload") + ".pdf"


def _pdfs(folder: Path) -> list[Path]:
    """The PDFs in one upload folder, matched without regard to the case of the extension (a
    file stored as X.PDF before names were normalised is still found)."""
    if not folder.is_dir():
        return []
    return sorted(p for p in folder.iterdir() if p.is_file() and p.suffix.lower() == ".pdf")


def _describe(path: Path) -> StoredFile:
    return StoredFile(path.parent.name, path.name, path, page_count(path), path.stat().st_size)


def store_pdf(data: bytes, name: str, *, root: Path | None = None) -> StoredFile:
    """Keep an uploaded PDF as files/<sha256>/<name>; the same bytes are stored once."""
    if len(data) > MAX_BYTES:
        raise ValueError(f"the file is larger than {MAX_BYTES // 2**20} MB")
    if not data.startswith(b"%PDF-"):
        raise ValueError("that is not a PDF")
    sha = hashlib.sha256(data).hexdigest()
    folder = files_root(root) / sha
    existing = _pdfs(folder)
    if existing:
        return _describe(existing[0])
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / safe_name(name)
    fd, tmp = tempfile.mkstemp(dir=folder, prefix=".upload-", suffix=".tmp")  # this call's own temp file
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    try:
        return _describe(path)
    except Exception:
        path.unlink(missing_ok=True)  # only the file this call wrote ...
        try:
            folder.rmdir()  # ... and the folder, only if nothing else is in it
        except OSError:
            pass
        raise ValueError("the PDF cannot be read") from None


def list_files(root: Path | None = None) -> list[StoredFile]:
    base = files_root(root)
    if not base.is_dir():
        return []
    found = [_pdfs(folder) for folder in base.iterdir() if folder.is_dir() and _SHA.fullmatch(folder.name)]
    return sorted((_describe(paths[0]) for paths in found if paths), key=lambda f: f.name.lower())


def _stored_path(sha256: str, root: Path | None = None) -> Path | None:
    paths = _pdfs(files_root(root) / check_sha(sha256))
    return paths[0] if paths else None


def find_file(sha256: str, root: Path | None = None) -> StoredFile:
    path = _stored_path(sha256, root)
    if path is None:
        raise FileNotFoundError(f"no stored file {sha256[:12]}…")
    return _describe(path)


def resolve_pdf(sha256: str, root: Path | None = None) -> Path:
    """A PDF on this Mac with that SHA-256: a stored upload, a benchmark source, or a run's source.

    Every path returned is hashed at the moment it is handed out, so a file changed on disk since
    it was stored is never used for a page image or a run. A stored upload that no longer matches
    its folder's hash is refused; it is not replaced by another candidate."""
    check_sha(sha256)
    stored = _stored_path(sha256, root)
    if stored is not None:
        actual = sha256_file(stored)
        if actual != sha256:
            raise ValueError(f"the stored upload {sha256[:12]}… has changed on disk (it now hashes to "
                             f"{actual[:12]}…); upload it again")
        return stored
    known = _resolved.get(sha256)
    if known is not None and known.exists() and sha256_file(known) == sha256:
        return known
    candidates = [DECK_DIR / p.file for p in pageset.load_or_empty() if p.sha256 == sha256]
    candidates += [Path(m["source"]["path"]) for m in store.list_runs(root)
                   if m.get("kind") == "extract" and m.get("source", {}).get("sha256") == sha256 and m["source"].get("path")]
    path = next((c for c in candidates if c.exists() and sha256_file(c) == sha256), None)
    if path is None:
        raise FileNotFoundError(f"no PDF with SHA-256 {sha256[:12]}… on this Mac") from None
    _resolved[sha256] = path
    return path


def page_png(sha256: str, page: int, root: Path | None = None) -> bytes:
    """The page as a PNG at 2× (cached under cache/png). Images never show a tool's output."""
    cache = (root or store.data_root()) / "cache" / "png" / f"{check_sha(sha256)}-{int(page)}.png"
    if cache.exists():
        return cache.read_bytes()
    png = render_png(resolve_pdf(sha256, root), int(page), zoom=PNG_ZOOM)
    cache.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=cache.parent, prefix=cache.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(png)
        os.replace(tmp, cache)  # a reader sees the whole PNG or no cache file, never a part
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return png
