import pytest
import asyncpg
from unittest.mock import AsyncMock, MagicMock, patch
from postgrest.exceptions import APIError

from backend.core.database import handle_db_errors, db_transaction
from backend.core.exceptions import DomainError, NotFoundError, ForbiddenError


class TestDatabaseErrorMapping:
    """Tests the database error interception and translation to DomainError subclasses."""

    async def test_postgrest_not_found_mapping(self):
        with pytest.raises(NotFoundError) as excinfo:
            async with handle_db_errors():
                raise APIError({
                    "code": "PGRST116",
                    "message": "The result contains 0 rows",
                    "details": "maybe_single() error"
                })
        assert excinfo.value.status_code == 404
        assert excinfo.value.code == "NOT_FOUND"
        assert "Zero rows" in excinfo.value.message or "result contains 0 rows" in excinfo.value.message

    async def test_postgrest_forbidden_mapping(self):
        with pytest.raises(ForbiddenError) as excinfo:
            async with handle_db_errors():
                raise APIError({
                    "code": "42501",
                    "message": "new row violates row-level security policy",
                    "details": "RLS details"
                })
        assert excinfo.value.status_code == 403
        assert excinfo.value.code == "FORBIDDEN"
        assert "policy" in excinfo.value.message

    async def test_postgrest_conflict_mapping(self):
        with pytest.raises(DomainError) as excinfo:
            async with handle_db_errors():
                raise APIError({
                    "code": "23505",
                    "message": "duplicate key value violates unique constraint",
                    "details": "Key (id)=(1) already exists."
                })
        assert excinfo.value.status_code == 400
        assert excinfo.value.code == "DB_CONFLICT"

    async def test_postgrest_foreign_key_mapping(self):
        with pytest.raises(DomainError) as excinfo:
            async with handle_db_errors():
                raise APIError({
                    "code": "23503",
                    "message": "insert violates foreign key constraint",
                    "details": "Key (course_id)=(1) is not present in table."
                })
        assert excinfo.value.status_code == 400
        assert excinfo.value.code == "DB_FOREIGN_KEY_VIOLATION"

    async def test_postgrest_not_null_mapping(self):
        with pytest.raises(DomainError) as excinfo:
            async with handle_db_errors():
                raise APIError({
                    "code": "23502",
                    "message": "null value violates non-null constraint",
                    "details": "Failing row contains null."
                })
        assert excinfo.value.status_code == 400
        assert excinfo.value.code == "DB_NOT_NULL_VIOLATION"

    async def test_asyncpg_conflict_mapping(self):
        # Create a mock unique violation error
        # asyncpg exceptions typically inherit from PostgresError and have a sqlstate attribute
        exc = asyncpg.exceptions.UniqueViolationError()
        exc.sqlstate = "23505"
        
        with pytest.raises(DomainError) as excinfo:
            async with handle_db_errors():
                raise exc
        assert excinfo.value.status_code == 400
        assert excinfo.value.code == "DB_CONFLICT"

    async def test_asyncpg_foreign_key_mapping(self):
        exc = asyncpg.exceptions.ForeignKeyViolationError()
        exc.sqlstate = "23503"
        
        with pytest.raises(DomainError) as excinfo:
            async with handle_db_errors():
                raise exc
        assert excinfo.value.status_code == 400
        assert excinfo.value.code == "DB_FOREIGN_KEY_VIOLATION"

    async def test_asyncpg_not_null_mapping(self):
        exc = asyncpg.exceptions.NotNullViolationError()
        exc.sqlstate = "23502"
        
        with pytest.raises(DomainError) as excinfo:
            async with handle_db_errors():
                raise exc
        assert excinfo.value.status_code == 400
        assert excinfo.value.code == "DB_NOT_NULL_VIOLATION"


class TestDatabaseTransactions:
    """Tests the db_transaction context manager for connection acquisition, transactions, and rollback behavior."""

    @patch("backend.core.database.db_pool", new_callable=MagicMock)
    async def test_db_transaction_success(self, mock_db_pool):
        # Setup mocks
        mock_conn = AsyncMock()
        mock_transaction = AsyncMock()
        # Mock transaction() method as a sync function returning an async context manager
        mock_conn.transaction = MagicMock(return_value=mock_transaction)
        
        # db_pool.acquire() is an async context manager
        # In mock, we can set it up to return the connection
        mock_acquire = AsyncMock()
        mock_acquire.__aenter__.return_value = mock_conn
        mock_db_pool.acquire.return_value = mock_acquire

        # Execute
        async with db_transaction() as conn:
            assert conn == mock_conn

        # Verify acquire and transaction lifecycle
        mock_db_pool.acquire.assert_called_once()
        mock_acquire.__aenter__.assert_called_once()
        mock_acquire.__aexit__.assert_called_once()
        mock_conn.transaction.assert_called_once()
        mock_transaction.__aenter__.assert_called_once()
        mock_transaction.__aexit__.assert_called_once()

    @patch("backend.core.database.db_pool", new_callable=MagicMock)
    async def test_db_transaction_rollback_on_postgres_error(self, mock_db_pool):
        # Setup mocks
        mock_conn = AsyncMock()
        mock_transaction = AsyncMock()
        mock_conn.transaction = MagicMock(return_value=mock_transaction)
        
        # Raise UniqueViolation on execute inside the transaction block
        exc = asyncpg.exceptions.UniqueViolationError()
        exc.sqlstate = "23505"
        
        mock_acquire = AsyncMock()
        mock_acquire.__aenter__.return_value = mock_conn
        mock_db_pool.acquire.return_value = mock_acquire

        # When the yielded block executes, raise PostgresError
        with pytest.raises(DomainError) as excinfo:
            async with db_transaction() as conn:
                raise exc

        # Assert the exception is mapped properly to DomainError
        assert excinfo.value.code == "DB_CONFLICT"

        # Verify transaction exited with the exception (causing rollback)
        mock_transaction.__aexit__.assert_called_once()
        args, kwargs = mock_transaction.__aexit__.call_args
        # The exception passed to transaction __aexit__ should be the original PostgresError
        assert isinstance(args[1], asyncpg.exceptions.UniqueViolationError)

        # Connection should still be released from pool
        mock_acquire.__aexit__.assert_called_once()


