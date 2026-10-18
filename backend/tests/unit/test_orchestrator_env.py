"""The orchestrator's .env loading must never overwrite the process env.

It used to call load_dotenv(override=True), so importing the orchestrator
replaced any DATABASE_URL or provider key the caller had set (including
tests/conftest.py's guard DSN) with the values from .env. A harness that
blanked DATABASE_URL still wrote rows to the production database.
"""
from __future__ import annotations

from backend.services.ai import orchestrator


def _write(path, **values):
    path.write_text("".join(f"{k}={v}\n" for k, v in values.items()))
    return path


def test_a_variable_already_set_is_never_overwritten(tmp_path, monkeypatch):
    root = _write(tmp_path / "root.env", STUDIO_ENV_PROBE="from-root")
    backend = _write(tmp_path / "backend.env", STUDIO_ENV_PROBE="from-backend")
    monkeypatch.setenv("STUDIO_ENV_PROBE", "from-process")
    orchestrator._init_env(root=root, backend=backend)
    assert __import__("os").environ["STUDIO_ENV_PROBE"] == "from-process"


def test_a_blanked_variable_stays_blank(tmp_path, monkeypatch):
    root = _write(tmp_path / "root.env", STUDIO_ENV_PROBE="postgresql://prod")
    monkeypatch.setenv("STUDIO_ENV_PROBE", "")
    orchestrator._init_env(root=root, backend=tmp_path / "missing.env")
    assert __import__("os").environ["STUDIO_ENV_PROBE"] == ""


def test_backend_env_wins_over_root_env_as_before(tmp_path, monkeypatch):
    root = _write(tmp_path / "root.env", STUDIO_ENV_PROBE="from-root", STUDIO_ENV_ROOT_ONLY="root")
    backend = _write(tmp_path / "backend.env", STUDIO_ENV_PROBE="from-backend")
    monkeypatch.delenv("STUDIO_ENV_PROBE", raising=False)
    monkeypatch.delenv("STUDIO_ENV_ROOT_ONLY", raising=False)
    orchestrator._init_env(root=root, backend=backend)
    import os
    assert os.environ["STUDIO_ENV_PROBE"] == "from-backend"
    assert os.environ["STUDIO_ENV_ROOT_ONLY"] == "root"
    monkeypatch.delenv("STUDIO_ENV_PROBE")
    monkeypatch.delenv("STUDIO_ENV_ROOT_ONLY")
