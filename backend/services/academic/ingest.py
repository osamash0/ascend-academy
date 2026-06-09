"""Normalize a ScrapedCatalog into the catalog tables (idempotent upserts).

Uses the service-role client (bypasses RLS). Upserts are keyed on
(source, external_ref), so re-running refreshes rows in place and never
duplicates. Every touched row gets last_scraped_at = now().

Entry points:
  * await run("marburg")                         — programmatic / API
  * python -m backend.services.academic.ingest marburg   — manual / CI
"""
from __future__ import annotations

import asyncio
import logging
import sys
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi.concurrency import run_in_threadpool

from backend.core.database import supabase_admin
from backend.services.academic.base import get_source
from backend.services.academic.models import ScrapedCatalog

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _upsert_one(table: str, row: Dict[str, Any]) -> str:
    """Upsert a single row on (source, external_ref); return its id."""
    res = (
        supabase_admin.table(table)
        .upsert(row, on_conflict="source,external_ref")
        .execute()
    )
    data = res.data or []
    if data and data[0].get("id"):
        return data[0]["id"]
    # Fallback: some PostgREST configs don't return the row on conflict-update.
    got = (
        supabase_admin.table(table)
        .select("id")
        .eq("source", row["source"])
        .eq("external_ref", row["external_ref"])
        .limit(1)
        .execute()
    )
    if not got.data:
        raise RuntimeError(f"Upsert into {table} returned no id for {row.get('external_ref')}")
    return got.data[0]["id"]


def _ingest_sync(catalog: ScrapedCatalog) -> Dict[str, Any]:
    """Blocking ingestion (runs in a threadpool from async callers)."""
    now = _now_iso()
    counts = {"universities": 0, "faculties": 0, "programs": 0, "courses": 0}
    errors: list[str] = []

    uni_id = _upsert_one("universities", {
        "name": catalog.university_name,
        "country": catalog.country,
        "city": catalog.city,
        "email_domains": catalog.email_domains,
        "source": catalog.source,
        "external_ref": catalog.university_external_ref,
        "last_scraped_at": now,
        "updated_at": now,
    })
    counts["universities"] += 1

    for faculty in catalog.faculties:
        try:
            fac_id = _upsert_one("faculties", {
                "university_id": uni_id,
                "name": faculty.name,
                "source": catalog.source,
                "external_ref": faculty.external_ref,
                "last_scraped_at": now,
                "updated_at": now,
            })
            counts["faculties"] += 1
        except Exception as e:  # one bad faculty shouldn't kill the run
            errors.append(f"faculty {faculty.external_ref}: {e}")
            continue

        for program in faculty.programs:
            try:
                prog_id = _upsert_one("degree_programs", {
                    "faculty_id": fac_id,
                    "name": program.name,
                    "degree_level": program.degree_level,
                    "total_semesters": program.total_semesters,
                    "source": catalog.source,
                    "external_ref": program.external_ref,
                    "last_scraped_at": now,
                    "updated_at": now,
                })
                counts["programs"] += 1
            except Exception as e:
                errors.append(f"program {program.external_ref}: {e}")
                continue

            if not program.courses:
                continue
            course_rows = [{
                "degree_program_id": prog_id,
                "title": c.title,
                "course_code": c.course_code,
                "typical_semester": c.typical_semester,
                "credits": c.credits,
                "language": c.language,
                "is_mandatory": c.is_mandatory,
                "source": catalog.source,
                "external_ref": c.external_ref,
                "last_scraped_at": now,
                "updated_at": now,
            } for c in program.courses]
            try:
                supabase_admin.table("catalog_courses").upsert(
                    course_rows, on_conflict="source,external_ref"
                ).execute()
                counts["courses"] += len(course_rows)
            except Exception as e:
                errors.append(f"courses for {program.external_ref}: {e}")

    return {
        "source": catalog.source,
        "scraped_at": now,
        "counts": counts,
        "errors": errors,
    }


async def run(source_key: str) -> Dict[str, Any]:
    """Fetch a source's catalog and upsert it. Returns an ingestion summary."""
    source = get_source(source_key)
    catalog = await source.fetch()
    logger.info(
        "Ingesting catalog source=%s (%d courses)", catalog.source, catalog.course_count()
    )
    summary = await run_in_threadpool(_ingest_sync, catalog)
    logger.info("Ingest summary: %s", summary)
    return summary


def _main() -> None:
    logging.basicConfig(level=logging.INFO)
    key = sys.argv[1] if len(sys.argv) > 1 else "marburg"
    summary = asyncio.run(run(key))
    print(summary)


if __name__ == "__main__":
    _main()
