"""
The execution floor must turn an all-skipped run red, and stay out of the way
otherwise. Run in a subprocess so the inner session gets its own plugin
registration and environment.
"""
from __future__ import annotations

from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]

pytest_plugins = ["pytester"]

_SKIP_ALL = """
import pytest

@pytest.fixture
def infra():
    pytest.skip("Docker is not available in this environment")

def test_a(infra): pass
def test_b(infra): pass
"""

_TWO_PASS = """
def test_a(): pass
def test_b(): pass
"""


def _run(pytester: pytest.Pytester, monkeypatch: pytest.MonkeyPatch, source: str, floor: str | None):
    pytester.makepyfile(source)
    monkeypatch.setenv("PYTHONPATH", str(REPO_ROOT))
    if floor is None:
        monkeypatch.delenv("PYTEST_MIN_PASSED", raising=False)
    else:
        monkeypatch.setenv("PYTEST_MIN_PASSED", floor)
    return pytester.runpytest_subprocess("-p", "backend.tests.execution_floor", "-p", "no:cacheprovider")


def test_all_skipped_run_fails_when_floor_set(pytester: pytest.Pytester, monkeypatch: pytest.MonkeyPatch):
    result = _run(pytester, monkeypatch, _SKIP_ALL, "1")
    assert result.ret == pytest.ExitCode.TESTS_FAILED
    result.stdout.fnmatch_lines(["*EXECUTION FLOOR NOT MET: 0 passed, PYTEST_MIN_PASSED=1 (2 skipped)*"])


def test_floor_met_leaves_run_green(pytester: pytest.Pytester, monkeypatch: pytest.MonkeyPatch):
    result = _run(pytester, monkeypatch, _TWO_PASS, "2")
    assert result.ret == pytest.ExitCode.OK
    assert "EXECUTION FLOOR" not in result.stdout.str()


def test_floor_one_short_fails(pytester: pytest.Pytester, monkeypatch: pytest.MonkeyPatch):
    result = _run(pytester, monkeypatch, _TWO_PASS, "3")
    assert result.ret == pytest.ExitCode.TESTS_FAILED


def test_unset_floor_is_a_noop(pytester: pytest.Pytester, monkeypatch: pytest.MonkeyPatch):
    result = _run(pytester, monkeypatch, _SKIP_ALL, None)
    assert result.ret == pytest.ExitCode.OK
