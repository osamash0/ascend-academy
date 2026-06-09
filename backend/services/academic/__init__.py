"""Academic catalog scraping + ingestion.

One real adapter (University of Marburg CS) behind a clean `CatalogSource`
interface so more universities can be added later without touching ingest.
See `ingest.run(source_key)` for the entry point.
"""
from backend.services.academic.base import CatalogSource, get_source, register_source
from backend.services.academic.models import (
    ScrapedCatalog,
    ScrapedCourse,
    ScrapedFaculty,
    ScrapedProgram,
)

__all__ = [
    "CatalogSource",
    "get_source",
    "register_source",
    "ScrapedCatalog",
    "ScrapedCourse",
    "ScrapedFaculty",
    "ScrapedProgram",
]
