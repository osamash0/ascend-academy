"""What Luna knows about you stays small enough to read at a glance."""
from __future__ import annotations

MEMORY_CAP = 20


def choose_retirements(active: list[dict], incoming: int, asked: list[str], cap: int = MEMORY_CAP) -> list[str]:
    """Ids to retire: the ones the wrap-up asked for, then the oldest until `incoming` fits."""
    ids = {m["id"] for m in active}
    retire = [i for i in dict.fromkeys(asked) if i in ids]
    remaining = [m for m in active if m["id"] not in retire]
    overflow = len(remaining) + incoming - cap
    if overflow > 0:
        retire += [m["id"] for m in sorted(remaining, key=lambda m: m["updated_at"])[:overflow]]
    return retire
