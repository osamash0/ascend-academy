"""
requirements.txt (what CI installs) vs requirements-docker.txt (what the
production image installs) must not drift silently.

The two lists differ on purpose — the docker set is lean — but every
difference has to be written down here with a reason. Before this test,
markitdown, resend and lxml were in requirements.txt only: CI passed with them
installed while prod lacked them, and each import sits behind a try/except that
only logs (PPTX import, feedback e-mail, the Marburg catalog scraper all
degraded to "nothing happened").

If this test fails:
  * the package is needed at runtime in prod  -> add it to requirements-docker.txt
  * it is genuinely dev/parser-v3/dead-code   -> add it to ALLOWED_DIFFERENCES
    below with a one-line reason someone can check later.
"""
from __future__ import annotations

from pathlib import Path

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

BACKEND = Path(__file__).resolve().parents[2]
FULL = BACKEND / "requirements.txt"
DOCKER = BACKEND / "requirements-docker.txt"

# Packages in requirements.txt but deliberately absent from the prod image.
ONLY_IN_FULL: dict[str, str] = {
    # Documented in requirements-docker.txt's header.
    "llama-cloud-services": "parser v3/v4 only (lazy import)",
    "ollama": "local LLM runner, unreachable inside Docker",
    "paddleocr": "dead code, removed from ocr_fallback.py",
    "paddlepaddle": "dead code, removed from ocr_fallback.py",
    # Documented inline further down requirements-docker.txt.
    "pytesseract": "only consumer is ocr_fallback.py via the retired v2 parse path; "
                   "the tesseract binary is not in the image either",
    # Not imported anywhere under backend/ (grep-verified 2026-10-10).
    "pandas": "no import under backend/; local-dev only",
    "tabulate": "no import under backend/; local-dev only",
}

# Packages in requirements-docker.txt but not requirements.txt (none today).
ONLY_IN_DOCKER: dict[str, str] = {}

# Same package in both files but with different extras.
EXTRAS_DIFFER: dict[str, str] = {}


def _parse(path: Path) -> dict[str, Requirement]:
    reqs: dict[str, Requirement] = {}
    for raw in path.read_text().splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or line.startswith("-"):
            continue
        req = Requirement(line)
        reqs[canonicalize_name(req.name)] = req
    return reqs


def test_requirement_files_parse():
    assert _parse(FULL), f"{FULL} parsed to nothing"
    assert _parse(DOCKER), f"{DOCKER} parsed to nothing"


def test_every_package_missing_from_docker_is_explained():
    full, docker = _parse(FULL), _parse(DOCKER)
    unexplained = sorted(set(full) - set(docker) - set(ONLY_IN_FULL))
    assert not unexplained, (
        f"In requirements.txt (CI) but NOT requirements-docker.txt (prod): {unexplained}. "
        "CI tests run with these installed; the production image does not have them. "
        "Add them to requirements-docker.txt, or to ONLY_IN_FULL in this file with a reason."
    )


def test_every_docker_only_package_is_explained():
    full, docker = _parse(FULL), _parse(DOCKER)
    unexplained = sorted(set(docker) - set(full) - set(ONLY_IN_DOCKER))
    assert not unexplained, (
        f"In requirements-docker.txt (prod) but NOT requirements.txt (CI): {unexplained}. "
        "Prod installs code that CI never tests against. Add them to requirements.txt, "
        "or to ONLY_IN_DOCKER in this file with a reason."
    )


def test_shared_packages_have_matching_extras():
    full, docker = _parse(FULL), _parse(DOCKER)
    mismatched = sorted(
        f"{name}: requirements.txt{sorted(full[name].extras)} vs docker{sorted(docker[name].extras)}"
        for name in set(full) & set(docker)
        if full[name].extras != docker[name].extras and name not in EXTRAS_DIFFER
    )
    # e.g. `markitdown` without `[pptx]` imports fine and then cannot read a deck.
    assert not mismatched, f"Extras differ between the two files: {mismatched}"


def test_allowlists_have_no_stale_entries():
    full, docker = _parse(FULL), _parse(DOCKER)
    stale = sorted(
        [n for n in ONLY_IN_FULL if not (n in full and n not in docker)]
        + [n for n in ONLY_IN_DOCKER if not (n in docker and n not in full)]
        + [n for n in EXTRAS_DIFFER if not (n in full and n in docker)]
    )
    assert not stale, (
        f"Allowlisted but no longer a difference: {stale}. Remove them so the "
        "allowlist keeps describing reality."
    )
    assert all(reason.strip() for reason in {**ONLY_IN_FULL, **ONLY_IN_DOCKER, **EXTRAS_DIFFER}.values())
