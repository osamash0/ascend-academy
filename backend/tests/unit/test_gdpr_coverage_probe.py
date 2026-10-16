"""The coverage probe runs against production: it must be truly read-only."""
import sys
import types

from backend.scripts import gdpr_coverage_probe as probe


class _Cur:
    def __init__(self, log):
        self.log = log

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, *a):
        self.log.append("query")

    def fetchall(self):
        return []


class _Conn:
    def __init__(self, log):
        self.log = log

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql):
        self.log.append(sql)

    def cursor(self):
        return _Cur(self.log)


def test_probe_opens_its_own_read_only_transaction(monkeypatch):
    log, kwargs = [], {}

    def connect(dsn, **kw):
        kwargs.update(kw)
        return _Conn(log)

    monkeypatch.setitem(sys.modules, "psycopg", types.SimpleNamespace(connect=connect))
    assert probe.main("postgresql://example.invalid/db") == 0
    # Without autocommit psycopg would already be inside a read-write
    # transaction and "BEGIN READ ONLY" would be a no-op warning.
    assert kwargs.get("autocommit") is True
    assert log[0] == "BEGIN READ ONLY" and log[-1] == "ROLLBACK"
