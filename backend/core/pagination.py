from dataclasses import dataclass
from typing import Callable, Generic, List, Optional, TypeVar
from pydantic import BaseModel, Field

T = TypeVar('T')
Row = TypeVar('Row', bound=dict)

class PaginationParams(BaseModel):
    cursor: Optional[str] = Field(default=None, description="Cursor for pagination (e.g., ID or timestamp of the last seen item).")
    limit: int = Field(default=20, ge=1, le=100, description="Maximum number of items to return.")

class PaginatedResponse(BaseModel, Generic[T]):
    success: bool = Field(default=True)
    data: List[T]
    cursor: Optional[str] = Field(default=None, description="Cursor for the next page of results. Null if no more results.")
    has_more: bool = Field(default=False, description="Whether there are more items to fetch.")


@dataclass
class FilteredPage(Generic[Row]):
    """Result of `paginate_with_predicate`: a page whose rows have ALREADY
    passed the caller's visibility/authorization predicate, with `cursor`/
    `has_more` computed against that same filtered set."""

    rows: List[Row]
    cursor: Optional[str]
    has_more: bool


def paginate_with_predicate(
    fetch_batch: Callable[[Optional[str], int], List[Row]],
    predicate: Callable[[Row], bool],
    cursor_field: str,
    limit: int,
    initial_cursor: Optional[str] = None,
    max_batches: int = 50,
) -> FilteredPage[Row]:
    """Cursor-paginate a source whose authorization/visibility filter cannot
    be pushed into the SQL query itself (e.g. it depends on cross-table
    enrollment lookups resolved in Python), without the classic "filter after
    limit" bug.

    THE BUG THIS PREVENTS (see `backend/api/v1/courses.py` `list_courses`
    pre-fix): fetching `limit + 1` rows, slicing to `limit`, and only THEN
    applying a Python-side visibility `predicate` returns fewer than `limit`
    rows whenever some fetched rows fail the predicate — while `has_more` and
    the next `cursor` are computed against the PRE-filter set. That silently
    mispaginates: a page can under-fill even though more visible rows exist
    further on, and in the worst case returns zero rows with `has_more=True`
    and `cursor=None` — a dead end the client cannot page past.

    This helper instead fetches in batches of `limit` rows (ordered
    consistently by `cursor_field`), applies `predicate` to every row in a
    batch, and keeps requesting further batches — resuming exactly where the
    previous one left off — until either `limit` PASSING rows have been
    collected or the source is exhausted (a batch came back shorter than
    requested). `has_more`/`cursor` are therefore always computed against the
    filtered result, never the raw one.

    `fetch_batch(cursor, batch_limit)` must return up to `batch_limit` rows
    ordered by the same field `cursor_field` names, continuing strictly after
    `cursor` (or from the start, if `cursor` is None) — i.e. the same
    contract a single paginated DB query already has today.

    `max_batches` bounds worst-case round-trips when almost every row fails
    the predicate (e.g. a student enrolled in almost nothing out of a huge
    catalog) — every external call must stay bounded (roadmap §4).
    """
    kept: List[Row] = []
    scan_cursor = initial_cursor

    for _ in range(max_batches):
        batch = fetch_batch(scan_cursor, limit)
        if not batch:
            break  # source exhausted, nothing left to scan

        kept.extend(row for row in batch if predicate(row))
        scan_cursor = batch[-1][cursor_field]

        if len(kept) > limit:
            break
        if len(batch) < limit:
            break  # source exhausted before filling this window

    has_more = len(kept) > limit
    page = kept[:limit]
    next_cursor = page[-1][cursor_field] if page else None
    return FilteredPage(rows=page, cursor=next_cursor, has_more=has_more)
