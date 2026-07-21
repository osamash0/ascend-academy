"""
S-2 (GDPR posture, docs/ROADMAP_10X_FOUNDATION.md §14) regression: proves the
`auth.users` DELETE cascade that `backend/api/v1/auth.py::delete_account_endpoint`
relies on actually removes every PII-bearing row for a user, against a REAL
Postgres instance (not mocks) — every migration under `supabase/migrations/`
is applied, including `20260721000000_slide_embeddings_migration_parity.sql`
which is the S-2 fix for the previously script-only `slide_embeddings` table.

Unlike the rest of `backend/tests/db/`, this file does NOT use the
testcontainers/Docker-backed `pg_dsn` fixture from `conftest.py` — this
sandbox has no Docker, but does have a local Homebrew Postgres 18 (+pgvector)
and Redis, which the task explicitly calls for using instead of mocking.
The `pg_dsn`/`applied_migrations` fixtures below shadow the conftest ones
(same names, module-local — pytest fixture resolution prefers the closer
definition) and point at a throwaway database created on the local instance,
dropped again in teardown. Everything downstream (`db_conn`, `make_user`,
`make_lecture`, `make_slide` from `conftest.py`) is reused unchanged.

Run directly (bypasses the `db`-marker deselect most other suites use):
    pytest backend/tests/db/test_gdpr_erasure_cascade.py -m db -q
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Iterator

import pytest

psycopg = pytest.importorskip("psycopg")

from backend.tests.db.conftest import (  # noqa: E402  (import after importorskip)
    BOOTSTRAP_SQL,
    MIGRATIONS_DIR,
    _split_sql_statements,
)

pytestmark = pytest.mark.db

LOCAL_PG_HOST = os.environ.get("GDPR_TEST_PG_HOST", "/tmp")
LOCAL_PG_PORT = os.environ.get("GDPR_TEST_PG_PORT", "5432")
LOCAL_PG_ADMIN_DSN = f"postgresql://{LOCAL_PG_HOST.replace('/', '%2F')}:{LOCAL_PG_PORT}/postgres"


def _local_postgres_available() -> bool:
    try:
        with psycopg.connect(LOCAL_PG_ADMIN_DSN, autocommit=True, connect_timeout=2):
            return True
    except Exception:
        return False


@pytest.fixture(scope="session")
def pg_dsn() -> Iterator[str]:
    """Throwaway database on the local Homebrew Postgres instance, instead of
    a testcontainers-managed one (no Docker in this sandbox)."""
    if not _local_postgres_available():
        pytest.skip(
            "Local Postgres not reachable at "
            f"host={LOCAL_PG_HOST} port={LOCAL_PG_PORT}; "
            "start Homebrew postgresql@18 to run this suite."
        )

    dbname = f"gdpr_s2_test_{uuid.uuid4().hex[:12]}"
    with psycopg.connect(LOCAL_PG_ADMIN_DSN, autocommit=True) as admin_conn:
        with admin_conn.cursor() as cur:
            cur.execute(f'CREATE DATABASE "{dbname}"')

    dsn = f"postgresql://{LOCAL_PG_HOST.replace('/', '%2F')}:{LOCAL_PG_PORT}/{dbname}"
    try:
        yield dsn
    finally:
        with psycopg.connect(LOCAL_PG_ADMIN_DSN, autocommit=True) as admin_conn:
            with admin_conn.cursor() as cur:
                # Terminate any lingering connections before DROP DATABASE.
                cur.execute(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname = %s AND pid <> pg_backend_pid()",
                    (dbname,),
                )
                cur.execute(f'DROP DATABASE IF EXISTS "{dbname}"')


@pytest.fixture(scope="session")
def applied_migrations(pg_dsn) -> list[Path]:
    """Same bootstrap-then-migrations sequence as conftest.py's fixture of
    the same name, re-pointed at the local-Postgres `pg_dsn` above."""
    bootstrap = BOOTSTRAP_SQL.read_text()
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    assert files, f"No migrations found at {MIGRATIONS_DIR}"

    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(bootstrap)
            for f in files:
                sql = f.read_text()
                try:
                    cur.execute(sql)
                except Exception:
                    for stmt in _split_sql_statements(sql):
                        try:
                            cur.execute(stmt)
                        except Exception as exc:
                            raise RuntimeError(
                                f"Migration {f.name} failed at statement:\n{stmt[:400]}"
                            ) from exc
    return files


def test_slide_embeddings_migration_parity_creates_table(db_conn, applied_migrations):
    """The S-2 fix: slide_embeddings/lecture_blueprints must exist after
    applying ONLY supabase/migrations/ (no legacy backend/scripts/ SQL) —
    proving the tables are no longer migrations-invisible."""
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT to_regclass('public.slide_embeddings'), "
            "to_regclass('public.lecture_blueprints')"
        )
        row = cur.fetchone()
    assert row[0] is not None, "slide_embeddings table missing after migrations-only bootstrap"
    assert row[1] is not None, "lecture_blueprints table missing after migrations-only bootstrap"


def test_slide_embeddings_cascades_from_lecture_delete(db_conn, applied_migrations, make_user, make_lecture):
    """slide_embeddings.lecture_id ON DELETE CASCADE actually fires — this is
    the FK the erasure flow's belt-and-suspenders app-level delete backs up."""
    professor = make_user(role="professor")
    lecture_id = make_lecture(professor)

    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO public.slide_embeddings (lecture_id, slide_index) VALUES (%s, 0)",
            (str(lecture_id),),
        )
        cur.execute("SELECT count(*) FROM public.slide_embeddings WHERE lecture_id = %s", (str(lecture_id),))
        assert cur.fetchone()[0] == 1

        cur.execute("DELETE FROM public.lectures WHERE id = %s", (str(lecture_id),))
        cur.execute("SELECT count(*) FROM public.slide_embeddings WHERE lecture_id = %s", (str(lecture_id),))
        assert cur.fetchone()[0] == 0


def test_auth_user_delete_cascades_full_pii_footprint(
    db_conn, applied_migrations, make_user, make_lecture, make_slide, make_quiz,
):
    """End-to-end proof that deleting auth.users removes every PII-bearing
    row reachable from that user — the DB guarantee
    `delete_account_endpoint` relies on instead of an app-level sweep."""
    professor = make_user(role="professor")
    lecture_id = make_lecture(professor)
    slide_id = make_slide(lecture_id)
    make_quiz(slide_id)

    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO public.slide_embeddings (lecture_id, slide_index) VALUES (%s, 0)",
            (str(lecture_id),),
        )
        cur.execute(
            "INSERT INTO public.learning_events (user_id, event_type, event_data) "
            "VALUES (%s, 'test_event', '{}'::jsonb)",
            (str(professor),),
        )

        # Sanity: everything exists before the delete.
        def _count(sql: str, param: str) -> int:
            cur.execute(sql, (param,))
            return cur.fetchone()[0]

        assert _count("SELECT count(*) FROM public.lectures WHERE id = %s", str(lecture_id)) == 1
        assert _count("SELECT count(*) FROM public.slides WHERE id = %s", str(slide_id)) == 1
        assert _count(
            "SELECT count(*) FROM public.quiz_questions q "
            "JOIN public.slides s ON s.id = q.slide_id WHERE s.lecture_id = %s",
            str(lecture_id),
        ) == 1
        assert _count(
            "SELECT count(*) FROM public.slide_embeddings WHERE lecture_id = %s", str(lecture_id)
        ) == 1
        assert _count(
            "SELECT count(*) FROM public.learning_events WHERE user_id = %s", str(professor)
        ) == 1
        assert _count("SELECT count(*) FROM public.profiles WHERE user_id = %s", str(professor)) == 1

        cur.execute("DELETE FROM auth.users WHERE id = %s", (str(professor),))

        cur.execute("SELECT count(*) FROM public.lectures WHERE id = %s", (str(lecture_id),))
        assert cur.fetchone()[0] == 0, "lectures row survived auth.users delete"

        cur.execute("SELECT count(*) FROM public.slides WHERE id = %s", (str(slide_id),))
        assert cur.fetchone()[0] == 0, "slides row survived lecture cascade"

        cur.execute("SELECT count(*) FROM public.slide_embeddings WHERE lecture_id = %s", (str(lecture_id),))
        assert cur.fetchone()[0] == 0, "slide_embeddings row survived lecture cascade"

        cur.execute("SELECT count(*) FROM public.learning_events WHERE user_id = %s", (str(professor),))
        assert cur.fetchone()[0] == 0, "learning_events row survived auth.users delete"

        cur.execute("SELECT count(*) FROM public.profiles WHERE user_id = %s", (str(professor),))
        assert cur.fetchone()[0] == 0, "profiles row survived auth.users delete"
