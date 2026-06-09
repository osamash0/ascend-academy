"""CatalogSource interface + a tiny registry.

Add a new university by subclassing CatalogSource, implementing fetch(), and
registering it. ingest.run("<key>") then works with zero other changes.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Dict, Type

from backend.services.academic.models import ScrapedCatalog


class CatalogSource(ABC):
    #: Stable provenance key, also written to every row's `source` column.
    source_key: str = ""

    @abstractmethod
    async def fetch(self) -> ScrapedCatalog:
        """Fetch + normalize the catalog. Should tolerate partial failures and
        return whatever was parsed rather than raising on a single bad field."""
        raise NotImplementedError


_REGISTRY: Dict[str, Type[CatalogSource]] = {}


def register_source(cls: Type[CatalogSource]) -> Type[CatalogSource]:
    """Class decorator: register an adapter under its source_key."""
    if not cls.source_key:
        raise ValueError(f"{cls.__name__} must define a non-empty source_key")
    _REGISTRY[cls.source_key] = cls
    # Allow a short alias too: "scraper:marburg" -> "marburg"
    if ":" in cls.source_key:
        _REGISTRY[cls.source_key.split(":", 1)[1]] = cls
    return cls


def get_source(key: str) -> CatalogSource:
    """Resolve an adapter by full source_key or short alias."""
    # Import adapters lazily so registration happens on first use.
    from backend.services.academic import marburg_cs  # noqa: F401

    cls = _REGISTRY.get(key)
    if cls is None:
        available = sorted({k for k in _REGISTRY})
        raise KeyError(f"Unknown catalog source '{key}'. Available: {available}")
    return cls()
