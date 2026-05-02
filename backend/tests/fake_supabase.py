"""
In-memory Supabase / PostgREST query-chain fake.

This is a deliberately small mock — it implements only the chain calls our
production code actually uses, plus enough surface to assert on writes.
It is NOT a general-purpose PostgREST emulator.

Supported chain methods on `client.table(name)`:

    .select(cols)
    .eq(col, value)
    .neq(col, value)
    .in_(col, values)
    .contains(col, sub_dict)
    .order(col, desc=False)
    .range(start, end)
    .limit(n)
    .single()
    .maybe_single()
    .execute()
    .upsert(payload, on_conflict=...).execute()
    .update(patch).eq(col, v).execute()
    .delete().eq(col, v).execute()
    .insert(payload).execute()

`client.tables[name]` is the raw list-of-dicts backing store. Use
`client.seed("table", [...])` to load fixtures, and inspect `client.calls`
for assertions on what the SUT did.
"""
from __future__ import annotations
import copy
import re
from dataclasses import dataclass, field
from typing import Any


@dataclass
class _Result:
    data: Any
    count: int | None = None


def _matches_contains(value: Any, sub: dict) -> bool:
    if not isinstance(value, dict):
        return False
    for k, v in sub.items():
        if value.get(k) != v:
            return False
    return True


class _Storage:
    def __init__(self) -> None:
        self.uploaded: list[tuple[str, str]] = []
        self.removed: list[tuple[str, list[str]]] = []

    def from_(self, bucket: str):  # supabase-py uses .from_
        return _Bucket(self, bucket)


class _Bucket:
    def __init__(self, store: _Storage, bucket: str) -> None:
        self.store = store
        self.bucket = bucket

    def upload(self, path: str, file: Any) -> dict:
        self.store.uploaded.append((self.bucket, path))
        return {"path": path}

    def remove(self, paths: list[str]) -> dict:
        self.store.removed.append((self.bucket, list(paths)))
        return {"removed": paths}

    def get_public_url(self, path: str) -> str:
        return f"https://fake-supabase/storage/{self.bucket}/{path}"


class _QueryBuilder:
    def __init__(self, client: "FakeSupabaseClient", table: str) -> None:
        self._client = client
        self._table = table
        self._filters: list[tuple[str, str, Any]] = []
        self._order: tuple[str, bool] | None = None
        self._range: tuple[int, int] | None = None
        self._limit: int | None = None
        self._single = False
        self._maybe_single = False
        self._select_cols: str | None = None
        # mutation state
        self._mutation: str | None = None
        self._payload: Any = None
        self._on_conflict: str | None = None
        self._patch: dict | None = None

    # ── Chain methods ──────────────────────────────────────────────────────
    def select(self, cols: str = "*", **_: Any) -> "_QueryBuilder":
        self._select_cols = cols
        return self

    def eq(self, col: str, value: Any) -> "_QueryBuilder":
        self._filters.append(("eq", col, value))
        return self

    def neq(self, col: str, value: Any) -> "_QueryBuilder":
        self._filters.append(("neq", col, value))
        return self

    def in_(self, col: str, values: list[Any]) -> "_QueryBuilder":
        self._filters.append(("in", col, list(values)))
        return self

    def contains(self, col: str, sub: dict) -> "_QueryBuilder":
        self._filters.append(("contains", col, sub))
        return self

    def order(self, col: str, desc: bool = False) -> "_QueryBuilder":
        self._order = (col, desc)
        return self

    def range(self, start: int, end: int) -> "_QueryBuilder":
        self._range = (start, end)
        return self

    def limit(self, n: int) -> "_QueryBuilder":
        self._limit = n
        return self

    def single(self) -> "_QueryBuilder":
        self._single = True
        return self

    def maybe_single(self) -> "_QueryBuilder":
        self._maybe_single = True
        return self

    # ── Mutations ──────────────────────────────────────────────────────────
    def insert(self, payload: Any) -> "_QueryBuilder":
        self._mutation = "insert"
        self._payload = payload
        return self

    def upsert(self, payload: Any, on_conflict: str | None = None, **_: Any) -> "_QueryBuilder":
        self._mutation = "upsert"
        self._payload = payload
        self._on_conflict = on_conflict
        return self

    def update(self, patch: dict) -> "_QueryBuilder":
        self._mutation = "update"
        self._patch = patch
        return self

    def delete(self) -> "_QueryBuilder":
        self._mutation = "delete"
        return self

    # ── Execute ────────────────────────────────────────────────────────────
    def execute(self) -> _Result:
        rows = self._client.tables.setdefault(self._table, [])

        if self._mutation == "insert":
            payloads = self._payload if isinstance(self._payload, list) else [self._payload]
            inserted = []
            for p in payloads:
                row = copy.deepcopy(p)
                row.setdefault("id", f"fake-id-{len(rows)+1}")
                rows.append(row)
                inserted.append(row)
            self._client.calls.append(("insert", self._table, payloads))
            return _Result(data=inserted)

        if self._mutation == "upsert":
            payloads = self._payload if isinstance(self._payload, list) else [self._payload]
            keys = (self._on_conflict or "").split(",") if self._on_conflict else []
            upserted = []
            for p in payloads:
                if keys and all(k in p for k in keys):
                    existing = next(
                        (r for r in rows if all(r.get(k) == p[k] for k in keys)),
                        None,
                    )
                    if existing is not None:
                        existing.update(p)
                        upserted.append(existing)
                        continue
                row = copy.deepcopy(p)
                row.setdefault("id", f"fake-id-{len(rows)+1}")
                rows.append(row)
                upserted.append(row)
            self._client.calls.append(("upsert", self._table, payloads, self._on_conflict))
            return _Result(data=upserted)

        # Filter rows for read / update / delete
        matching = [copy.deepcopy(r) for r in rows]
        for op, col, val in self._filters:
            if op == "eq":
                matching = [r for r in matching if r.get(col) == val]
            elif op == "neq":
                matching = [r for r in matching if r.get(col) != val]
            elif op == "in":
                matching = [r for r in matching if r.get(col) in val]
            elif op == "contains":
                matching = [r for r in matching if _matches_contains(r.get(col), val)]

        if self._mutation == "update":
            updated = []
            for r in rows:
                if self._row_matches(r):
                    r.update(self._patch or {})
                    updated.append(copy.deepcopy(r))
            self._client.calls.append(("update", self._table, self._patch, self._filters))
            return _Result(data=updated)

        if self._mutation == "delete":
            kept = [r for r in rows if not self._row_matches(r)]
            removed_count = len(rows) - len(kept)
            self._client.tables[self._table] = kept
            self._client.calls.append(("delete", self._table, self._filters))
            return _Result(data=[], count=removed_count)

        # SELECT path
        if self._order:
            col, desc = self._order
            matching.sort(key=lambda r: (r.get(col) is None, r.get(col)), reverse=desc)
        if self._range:
            start, end = self._range
            matching = matching[start : end + 1]
        if self._limit:
            matching = matching[: self._limit]

        if self._single:
            if len(matching) == 0:
                # PostgREST raises on .single() with 0 rows. Mimic via
                # exception-like result with a code attribute.
                raise _PGError("PGRST116", "JSON object requested, multiple (or no) rows returned")
            return _Result(data=matching[0])
        if self._maybe_single:
            return _Result(data=matching[0] if matching else None)
        return _Result(data=matching)

    # ── helpers ────────────────────────────────────────────────────────────
    def _row_matches(self, row: dict) -> bool:
        for op, col, val in self._filters:
            if op == "eq" and row.get(col) != val:
                return False
            if op == "neq" and row.get(col) == val:
                return False
            if op == "in" and row.get(col) not in val:
                return False
            if op == "contains" and not _matches_contains(row.get(col), val):
                return False
        return True


class _PGError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class _Postgrest:
    def __init__(self) -> None:
        self.token: str | None = None

    def auth(self, token: str) -> None:
        self.token = token


class _Auth:
    def __init__(self, client: "FakeSupabaseClient") -> None:
        self._client = client
        # token -> user
        self._users_by_token: dict[str, Any] = {}

    def register_token(self, token: str, user: Any) -> None:
        self._users_by_token[token] = user

    def get_user(self, token: str) -> Any:
        user = self._users_by_token.get(token)
        if not user:
            raise RuntimeError("invalid token")
        return _UserResponse(user)

    def sign_out(self) -> None:
        return None


@dataclass
class _UserResponse:
    user: Any


class FakeSupabaseClient:
    """In-memory PostgREST-like client used in tests."""

    def __init__(self) -> None:
        self.tables: dict[str, list[dict]] = {}
        self.calls: list[tuple] = []
        self.postgrest = _Postgrest()
        self.auth = _Auth(self)
        self.storage = _Storage()
        self._rpc_handlers: dict[str, Any] = {}

    # ── Public test helpers ────────────────────────────────────────────────
    def seed(self, table: str, rows: list[dict]) -> None:
        self.tables[table] = [copy.deepcopy(r) for r in rows]

    def register_rpc(self, name: str, fn) -> None:
        self._rpc_handlers[name] = fn

    # ── PostgREST surface ──────────────────────────────────────────────────
    def table(self, name: str) -> _QueryBuilder:
        return _QueryBuilder(self, name)

    def from_(self, name: str) -> _QueryBuilder:
        return _QueryBuilder(self, name)

    def rpc(self, name: str, params: dict | None = None):
        handler = self._rpc_handlers.get(name)
        result = handler(params or {}) if handler else []
        return _RpcQuery(result)


class _RpcQuery:
    def __init__(self, data: Any) -> None:
        self._data = data

    def execute(self) -> _Result:
        return _Result(data=self._data)
