"""Tests for backend/scripts/check_migration_timestamps.py (P4-4 migration governance).

Covers: clean dirs, grandfathered-only collisions (must not fail), and a
brand-new collision (must fail) — using a temp directory so these tests never
touch the real supabase/migrations/ tree.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

import check_migration_timestamps as cmt  # noqa: E402


def _touch(dir_: Path, name: str) -> None:
    (dir_ / name).write_text("-- noop\n")


def test_no_migrations_no_collisions(tmp_path: Path) -> None:
    assert cmt.find_collisions(tmp_path) == {}


def test_unique_timestamps_no_collisions(tmp_path: Path) -> None:
    _touch(tmp_path, "20260101000000_a.sql")
    _touch(tmp_path, "20260101000001_b.sql")
    assert cmt.find_collisions(tmp_path) == {}


def test_duplicate_timestamp_detected(tmp_path: Path) -> None:
    _touch(tmp_path, "20260101000000_a.sql")
    _touch(tmp_path, "20260101000000_b.sql")
    collisions = cmt.find_collisions(tmp_path)
    assert set(collisions.keys()) == {"20260101000000"}
    assert sorted(collisions["20260101000000"]) == [
        "20260101000000_a.sql",
        "20260101000000_b.sql",
    ]


def test_non_migration_files_ignored(tmp_path: Path) -> None:
    _touch(tmp_path, "README.md")
    _touch(tmp_path, "20260101000000_a.sql")
    assert cmt.find_collisions(tmp_path) == {}


def test_real_migrations_dir_only_has_known_baseline_collisions() -> None:
    """Regression guard: today's repo has exactly the 3 known collision groups
    (20260503000008/19/20). If this grows, it means a NEW collision was
    introduced without going through the CI check (or the check itself is
    broken) — this test should fail loudly in that case.
    """
    collisions = cmt.find_collisions(cmt.MIGRATIONS_DIR)
    unexpected = {
        ts: names
        for ts, names in collisions.items()
        if any(n not in cmt.KNOWN_BASELINE_COLLISION_FILENAMES for n in names)
    }
    assert unexpected == {}, f"Unexpected new migration timestamp collisions: {unexpected}"


def test_main_passes_on_clean_dir(tmp_path: Path, monkeypatch, capsys) -> None:
    _touch(tmp_path, "20260101000000_a.sql")
    monkeypatch.setattr(sys, "argv", ["prog", "--migrations-dir", str(tmp_path)])
    assert cmt.main() == 0
    assert "OK" in capsys.readouterr().out


def test_main_fails_on_new_collision(tmp_path: Path, monkeypatch, capsys) -> None:
    _touch(tmp_path, "20260101000000_a.sql")
    _touch(tmp_path, "20260101000000_b.sql")
    monkeypatch.setattr(sys, "argv", ["prog", "--migrations-dir", str(tmp_path)])
    assert cmt.main() == 1
    assert "FAIL" in capsys.readouterr().out


def test_main_passes_when_only_grandfathered_names_collide(
    tmp_path: Path, monkeypatch, capsys
) -> None:
    # Recreate one real grandfathered collision group by exact filename.
    _touch(tmp_path, "20260503000008_parser_v3_schema.sql")
    _touch(tmp_path, "20260503000008_user_feedback.sql")
    monkeypatch.setattr(sys, "argv", ["prog", "--migrations-dir", str(tmp_path)])
    assert cmt.main() == 0
    assert "OK" in capsys.readouterr().out


def test_main_fails_when_new_file_added_to_grandfathered_timestamp(
    tmp_path: Path, monkeypatch, capsys
) -> None:
    # A new file re-using an already-grandfathered timestamp must still fail —
    # grandfathering covers the *existing* files, not the timestamp slot.
    _touch(tmp_path, "20260503000008_parser_v3_schema.sql")
    _touch(tmp_path, "20260503000008_user_feedback.sql")
    _touch(tmp_path, "20260503000008_totally_new_migration.sql")
    monkeypatch.setattr(sys, "argv", ["prog", "--migrations-dir", str(tmp_path)])
    assert cmt.main() == 1
    assert "FAIL" in capsys.readouterr().out


def test_main_errors_on_missing_dir(tmp_path: Path, monkeypatch) -> None:
    missing = tmp_path / "does-not-exist"
    monkeypatch.setattr(sys, "argv", ["prog", "--migrations-dir", str(missing)])
    assert cmt.main() == 2
