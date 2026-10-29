"""Every backend connection in a DB test reaches the throwaway database, never the .env one."""
from __future__ import annotations

import pytest

import backend.core.database as database
import backend.services.v4_spaces_service as spaces
import backend.services.v4_telemetry as telemetry

pytestmark = pytest.mark.db
asyncpg = pytest.importorskip("asyncpg")


async def test_every_backend_connection_reaches_the_throwaway_database(throwaway_db, pg_dsn):
    expected = pg_dsn.rsplit("/", 1)[1].split("?")[0]
    for module in (database, spaces, telemetry):
        async with await module.get_db_connection() as conn:
            assert await conn.fetchval("SELECT current_database()") == expected
