"""
Execution floor — fail a pytest run that passed too few tests.

A suite whose fixtures `pytest.skip` when their infrastructure is missing
(backend/tests/db/conftest.py skips when testcontainers or Docker is absent)
exits 0 with zero tests run. That is green, and it is a lie: the job looks
like it verified RLS when it verified nothing.

Set PYTEST_MIN_PASSED=<n> on a CI job and the run fails unless at least <n>
tests reached the `call` phase and passed. Unset (the default, and the local
dev case), this plugin does nothing.

Registered from backend/tests/conftest.py via `pytest_plugins`.
"""
from __future__ import annotations

import os

import pytest

ENV_VAR = "PYTEST_MIN_PASSED"

_floor_key = pytest.StashKey[str]()


def _min_passed() -> int | None:
    raw = os.environ.get(ENV_VAR, "").strip()
    if not raw:
        return None
    try:
        value = int(raw)
    except ValueError:
        raise pytest.UsageError(f"{ENV_VAR} must be an integer, got {raw!r}")
    return value if value > 0 else None


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    floor = _min_passed()
    if floor is None:
        return
    reporter = session.config.pluginmanager.get_plugin("terminalreporter")
    if reporter is None:
        return
    passed = sum(
        1 for r in reporter.stats.get("passed", []) if getattr(r, "when", "call") == "call"
    )
    if passed >= floor:
        return
    skipped = len(reporter.stats.get("skipped", []))
    session.config.stash[_floor_key] = (
        f"EXECUTION FLOOR NOT MET: {passed} passed, {ENV_VAR}={floor} "
        f"({skipped} skipped). The suite most likely skipped because its "
        f"infrastructure (Docker / testcontainers / Postgres) was unavailable. "
        f"If tests were deliberately removed, lower {ENV_VAR} in the CI job."
    )
    # Only escalate a run that would otherwise have been green; a real failure
    # or interruption keeps its own, more specific exit code.
    if session.exitstatus in (pytest.ExitCode.OK, pytest.ExitCode.NO_TESTS_COLLECTED):
        session.exitstatus = pytest.ExitCode.TESTS_FAILED


def pytest_terminal_summary(terminalreporter, exitstatus: int, config: pytest.Config) -> None:
    message = config.stash.get(_floor_key, None)
    if message:
        terminalreporter.section("execution floor", sep="=", red=True, bold=True)
        terminalreporter.write_line(message, red=True)
