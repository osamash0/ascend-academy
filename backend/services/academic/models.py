"""Normalized data shapes returned by every CatalogSource adapter.

A `ScrapedCatalog` is a fully-normalized tree (university → faculties →
programs → courses). `ingest.py` upserts it into the catalog tables keyed on
(source, external_ref). `external_ref` must be STABLE across runs so re-scrapes
update rows in place instead of duplicating.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class ScrapedCourse:
    external_ref: str
    title: str
    course_code: Optional[str] = None
    typical_semester: Optional[int] = None  # None = elective / unscheduled
    credits: Optional[float] = None
    language: Optional[str] = None
    is_mandatory: bool = True


@dataclass
class ScrapedProgram:
    external_ref: str
    name: str
    degree_level: Optional[str] = None
    total_semesters: Optional[int] = None
    courses: List[ScrapedCourse] = field(default_factory=list)


@dataclass
class ScrapedFaculty:
    external_ref: str
    name: str
    programs: List[ScrapedProgram] = field(default_factory=list)


@dataclass
class ScrapedCatalog:
    source: str                       # e.g. "scraper:marburg"
    university_external_ref: str
    university_name: str
    country: Optional[str] = None
    city: Optional[str] = None
    email_domains: List[str] = field(default_factory=list)
    faculties: List[ScrapedFaculty] = field(default_factory=list)

    def course_count(self) -> int:
        return sum(len(p.courses) for f in self.faculties for p in f.programs)
