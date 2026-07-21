"""
DB / RLS test fixtures — boots a throwaway Postgres via testcontainers,
applies a bootstrap that stubs the Supabase environment (auth/storage
schemas, roles, JWT-claim helpers, out-of-band cache tables), then runs
every migration under supabase/migrations/ in lexicographic order.

Gated behind the `db` marker so it only runs nightly. Skips automatically
if testcontainers / psycopg / Docker isn't available so dev machines
without Docker don't block normal `pytest`.
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Iterator

import pytest

try:
    import psycopg
    from testcontainers.postgres import PostgresContainer  # type: ignore[import-not-found]

    HAS_TESTCONTAINERS = True
except ImportError:
    HAS_TESTCONTAINERS = False


REPO_ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS_DIR = REPO_ROOT / "supabase" / "migrations"
BOOTSTRAP_SQL = Path(__file__).resolve().parent / "sql" / "00_bootstrap.sql"


# ── Container & DSN ──────────────────────────────────────────────────────────


@pytest.fixture(scope="session")
def pg_container() -> Iterator["PostgresContainer"]:
    if not HAS_TESTCONTAINERS:
        pytest.skip("testcontainers / psycopg not installed; install for nightly DB tests")
    if not os.environ.get("DOCKER_HOST") and not Path("/var/run/docker.sock").exists():
        pytest.skip("Docker is not available in this environment")
    # pgvector/pgvector is the official Postgres 15 image with the
    # `vector` extension pre-installed. The parser v3 schema migration
    # (20260503000008) requires `CREATE EXTENSION vector`, which is not
    # available in postgres:15-alpine. Real Supabase projects ship pgvector
    # by default, so this only matters for the nightly test container.
    #
    # Pinned to an immutable digest (rather than the floating `:pg15` tag)
    # so a silent upstream re-push can't masquerade as a regression in our
    # migrations. This digest is the multi-arch OCI index for pgvector
    # 0.8.2 on Postgres 15 (bookworm), pushed 2026-02-26 — equivalent to
    # the tags `pg15`, `pg15-bookworm`, `0.8.2-pg15`, `0.8.2-pg15-bookworm`.
    # Bump intentionally when upgrading pgvector.
    PGVECTOR_DIGEST = "pgvector/pgvector:pg15"
    with PostgresContainer(PGVECTOR_DIGEST) as pg:
        yield pg


@pytest.fixture(scope="session")
def pg_dsn(request) -> str:
    """Plain libpq URL (psycopg v3 doesn't accept the +psycopg2 suffix).

    If ``LOCAL_PG_DSN`` is set, use it directly instead of spinning up a
    testcontainers Postgres — lets this suite run against a real local
    Postgres (e.g. Homebrew Postgres) in sandboxes with no Docker access.
    The migrations/bootstrap are identical either way; only the target
    connection differs. A real Postgres is required either way (nothing
    here is mocked) — this just changes where that Postgres instance runs.

    Must be a full ``postgresql://`` URI (not a bare libpq keyword string
    like ``dbname=... host=...``) — some tests (e.g. test_exam_api.py) open
    an asyncpg pool directly against this DSN, and asyncpg requires a URI
    scheme. Example for a local Homebrew Postgres on a Unix socket, current
    user, empty pre-created database ``s1_pytest``:
    ``LOCAL_PG_DSN="postgresql://$(whoami)@%2Ftmp:5432/s1_pytest"``.
    """
    local_dsn = os.environ.get("LOCAL_PG_DSN")
    if local_dsn:
        if not HAS_TESTCONTAINERS:
            pytest.skip("psycopg not installed; install for DB tests")
        return local_dsn
    pg_container = request.getfixturevalue("pg_container")
    return (
        pg_container.get_connection_url()
        .replace("postgresql+psycopg2", "postgresql")
        .replace("postgresql+psycopg", "postgresql")
    )


# ── Bootstrap + migrations (session-scoped) ──────────────────────────────────


def _split_sql_statements(sql: str) -> list[str]:
    """
    Split a SQL file on top-level semicolons.

    A semicolon only separates statements when it is NOT inside a $$...$$
    block (SECURITY DEFINER bodies / DO blocks), a ``--`` line comment, a
    ``/* */`` block comment, or a ``'...'`` string literal. Splitting on a
    semicolon inside any of those — e.g. a comment reading "...profile XP;
    saves them..." — produces a bogus fragment and a misleading syntax
    error, so we track each context explicitly.

    Per-statement execution also matters functionally, not just for error
    messages: a few migrations (e.g. ``ALTER TYPE ... ADD VALUE`` followed
    by a policy that *uses* the new enum value) cannot run in one batch
    transaction, and only succeed when each statement is its own autocommit
    statement.
    """
    out: list[str] = []
    buf: list[str] = []
    in_dollar = False        # inside $$ ... $$
    in_line_comment = False  # inside -- ... \n
    in_block_comment = False # inside /* ... */
    in_squote = False        # inside '...'
    i = 0
    n = len(sql)
    while i < n:
        ch = sql[i]
        two = sql[i : i + 2]

        if in_line_comment:
            buf.append(ch)
            if ch == "\n":
                in_line_comment = False
            i += 1
            continue
        if in_block_comment:
            buf.append(ch)
            if two == "*/":
                buf.append(sql[i + 1])
                in_block_comment = False
                i += 2
                continue
            i += 1
            continue
        if in_squote:
            buf.append(ch)
            if ch == "'":
                if sql[i + 1 : i + 2] == "'":  # escaped '' inside a literal
                    buf.append("'")
                    i += 2
                    continue
                in_squote = False
            i += 1
            continue

        # Comment / string starts are only meaningful outside a $$ body.
        if not in_dollar:
            if two == "--":
                in_line_comment = True
                buf.append(two)
                i += 2
                continue
            if two == "/*":
                in_block_comment = True
                buf.append(two)
                i += 2
                continue
            if ch == "'":
                in_squote = True
                buf.append(ch)
                i += 1
                continue

        if two == "$$":
            in_dollar = not in_dollar
            buf.append("$$")
            i += 2
            continue
        if ch == ";" and not in_dollar:
            stmt = "".join(buf).strip()
            if stmt:
                out.append(stmt)
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1
    tail = "".join(buf).strip()
    if tail:
        out.append(tail)
    return out


@pytest.fixture(scope="session")
def applied_migrations(pg_dsn) -> list[Path]:
    """
    Apply the bootstrap SQL, then every .sql file under supabase/migrations/
    in lexicographic order. Returns the list of migration paths so callers
    can assert they all loaded.
    """
    bootstrap = BOOTSTRAP_SQL.read_text()
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    assert files, f"No migrations found at {MIGRATIONS_DIR}"

    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(bootstrap)
            for f in files:
                sql = f.read_text()
                # Run as a single batch first; on failure, retry split for
                # a precise error message.
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


# ── Per-test connection ──────────────────────────────────────────────────────


@pytest.fixture
def db_conn(pg_dsn, applied_migrations) -> Iterator["psycopg.Connection"]:
    """A fresh autocommit connection per test, opened as superuser."""
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        yield conn


# ── Synthetic factories ──────────────────────────────────────────────────────


@pytest.fixture
def make_user(db_conn):
    """
    Insert a synthetic auth.users row. The 20260501000000 trigger handles
    profile + user_roles creation based on raw_user_meta_data->>'role'.
    Returns the new uuid.
    """

    def _make(role: str = "student", email: str | None = None) -> uuid.UUID:
        uid = uuid.uuid4()
        em = email or f"u-{uid}@test.local"
        with db_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO auth.users (id, email, raw_user_meta_data)
                VALUES (%s, %s, %s::jsonb)
                """,
                (str(uid), em, f'{{"role": "{role}"}}'),
            )
        return uid

    return _make


@pytest.fixture
def make_lecture(db_conn):
    """Insert a lecture authored by the given professor uuid. Returns the lecture uuid."""

    def _make(professor_id: uuid.UUID, title: str = "Test Lecture") -> uuid.UUID:
        lid = uuid.uuid4()
        with db_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.lectures (id, title, professor_id, total_slides)
                VALUES (%s, %s, %s, %s)
                """,
                (str(lid), title, str(professor_id), 1),
            )
        return lid

    return _make


@pytest.fixture
def make_slide(db_conn):
    """Insert a slide for a lecture. Returns the slide uuid."""

    def _make(lecture_id: uuid.UUID, slide_number: int = 1) -> uuid.UUID:
        sid = uuid.uuid4()
        with db_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.slides (id, lecture_id, slide_number, title, content_text)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (str(sid), str(lecture_id), slide_number, f"Slide {slide_number}", "body"),
            )
        return sid

    return _make


@pytest.fixture
def make_quiz(db_conn):
    """Insert a quiz question for a slide. Returns the question uuid."""

    def _make(slide_id: uuid.UUID) -> uuid.UUID:
        qid = uuid.uuid4()
        with db_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.quiz_questions
                    (id, slide_id, question_text, options, correct_answer)
                VALUES (%s, %s, %s, %s::jsonb, %s)
                """,
                (str(qid), str(slide_id), "2+2?", '["1","2","3","4"]', 3),
            )
        return qid

    return _make


@pytest.fixture
def make_course(db_conn):
    """Insert a course owned by the given professor uuid. Returns the course uuid."""

    def _make(professor_id: uuid.UUID, title: str = "Test Course") -> uuid.UUID:
        cid = uuid.uuid4()
        with db_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.courses (id, professor_id, title)
                VALUES (%s, %s, %s)
                """,
                (str(cid), str(professor_id), title),
            )
        return cid

    return _make


@pytest.fixture
def make_course_enrollment(db_conn):
    """Enroll a student in a course via course_enrollments (the modern,
    explicit-join path — distinct from the legacy assignment_enrollments
    path used elsewhere in this file)."""

    def _make(user_id: uuid.UUID, course_id: uuid.UUID) -> uuid.UUID:
        eid = uuid.uuid4()
        with db_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.course_enrollments (id, user_id, course_id)
                VALUES (%s, %s, %s)
                """,
                (str(eid), str(user_id), str(course_id)),
            )
        return eid

    return _make


@pytest.fixture
def make_progress(db_conn):
    """Insert a student_progress row for (user, lecture)."""

    def _make(user_id: uuid.UUID, lecture_id: uuid.UUID, xp: int = 10) -> uuid.UUID:
        pid = uuid.uuid4()
        with db_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.student_progress
                    (id, user_id, lecture_id, xp_earned)
                VALUES (%s, %s, %s, %s)
                """,
                (str(pid), str(user_id), str(lecture_id), xp),
            )
        return pid

    return _make
