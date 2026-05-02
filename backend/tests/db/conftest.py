"""
DB / RLS test fixtures — boots a throwaway Postgres via testcontainers and
applies every migration under supabase/migrations/ in order.

Gated behind the `db` marker so it only runs nightly. Skips automatically if
testcontainers is not installed (so dev machines without Docker don't block).
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

try:
    import psycopg
    from testcontainers.postgres import PostgresContainer  # type: ignore[import-not-found]

    HAS_TESTCONTAINERS = True
except ImportError:
    HAS_TESTCONTAINERS = False


MIGRATIONS_DIR = Path(__file__).resolve().parents[3] / "supabase" / "migrations"


@pytest.fixture(scope="session")
def pg_container():
    if not HAS_TESTCONTAINERS:
        pytest.skip("testcontainers / psycopg not installed; install for nightly DB tests")
    if not os.environ.get("DOCKER_HOST") and not Path("/var/run/docker.sock").exists():
        pytest.skip("Docker is not available in this environment")
    with PostgresContainer("postgres:15-alpine") as pg:
        yield pg


@pytest.fixture(scope="session")
def pg_dsn(pg_container):
    return pg_container.get_connection_url().replace("postgresql+psycopg2", "postgresql")


@pytest.fixture(scope="session")
def applied_migrations(pg_dsn):
    """Apply every .sql file under supabase/migrations/ in lexicographic order."""
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    assert files, f"No migrations found at {MIGRATIONS_DIR}"
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        with conn.cursor() as cur:
            for f in files:
                sql = f.read_text()
                try:
                    cur.execute(sql)
                except Exception as exc:
                    raise RuntimeError(f"Migration failed: {f.name}") from exc
    return files


@pytest.fixture
def db_conn(pg_dsn, applied_migrations):
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        yield conn
