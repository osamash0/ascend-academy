"""University of Marburg — B.Sc. Computer Science catalog adapter.

Strategy (FOUNDATION phase): attempt a real fetch + parse of the public module
catalog, but fall back to a built-in static dataset when the network/parse
fails or yields nothing. The static dataset uses the SAME external_ref values
as the seed migration (20260615000100), so ingest is idempotent against it.

This is the "graceful fallback when scraping isn't possible" requirement: the
product is never blocked on a brittle scrape. As real parsing matures, the
parsed rows simply replace the static ones in place (keyed on external_ref).
"""
from __future__ import annotations

import logging
import os
from typing import List, Optional

import httpx

from backend.services.academic.base import CatalogSource, register_source
from backend.services.academic.models import (
    ScrapedCatalog,
    ScrapedCourse,
    ScrapedFaculty,
    ScrapedProgram,
)

logger = logging.getLogger(__name__)

# Public module-catalog URL (overridable via env for testing/fixtures).
DEFAULT_CATALOG_URL = os.environ.get(
    "MARBURG_CS_CATALOG_URL",
    "https://www.uni-marburg.de/de/fb12/studium/studiengaenge/bsc-informatik",
)

# Built-in fallback catalog — mirrors the seed migration's external_refs.
_STATIC_COURSES: List[ScrapedCourse] = [
    ScrapedCourse("marburg-cs-gp",   "Foundations of Programming",               "CS-GP",   1, 9.0, "de", True),
    ScrapedCourse("marburg-cs-la",   "Linear Algebra",                           "CS-LA",   1, 9.0, "de", True),
    ScrapedCourse("marburg-cs-ti",   "Digital Systems & Computer Architecture",  "CS-TI",   1, 6.0, "de", True),
    ScrapedCourse("marburg-cs-ads",  "Algorithms & Data Structures",             "CS-ADS",  2, 9.0, "de", True),
    ScrapedCourse("marburg-cs-an",   "Analysis",                                 "CS-AN",   2, 9.0, "de", True),
    ScrapedCourse("marburg-cs-oop",  "Object-Oriented Programming",              "CS-OOP",  2, 6.0, "de", True),
    ScrapedCourse("marburg-cs-db",   "Database Systems",                         "CS-DB",   3, 6.0, "de", True),
    ScrapedCourse("marburg-cs-os",   "Operating Systems",                        "CS-OS",   3, 6.0, "de", True),
    ScrapedCourse("marburg-cs-sto",  "Probability & Statistics",                 "CS-STO",  3, 6.0, "de", True),
    ScrapedCourse("marburg-cs-se",   "Software Engineering",                     "CS-SE",   4, 9.0, "de", True),
    ScrapedCourse("marburg-cs-net",  "Computer Networks",                        "CS-NET",  4, 6.0, "de", True),
    ScrapedCourse("marburg-cs-theo", "Theoretical Computer Science",             "CS-THEO", 4, 9.0, "de", True),
    ScrapedCourse("marburg-cs-ml",   "Machine Learning",                         "CS-ML",   None, 6.0, "en", False),
    ScrapedCourse("marburg-cs-cg",   "Computer Graphics",                        "CS-CG",   None, 6.0, "en", False),
]


@register_source
class MarburgCsSource(CatalogSource):
    source_key = "scraper:marburg"

    def __init__(self, url: Optional[str] = None) -> None:
        self.url = url or DEFAULT_CATALOG_URL

    async def fetch(self) -> ScrapedCatalog:
        courses = await self._try_scrape_courses()
        if not courses:
            logger.warning(
                "Marburg scrape returned no courses; falling back to static catalog."
            )
            courses = list(_STATIC_COURSES)

        program = ScrapedProgram(
            external_ref="marburg-bsc-informatik",
            name="Computer Science (B.Sc.)",
            degree_level="bachelor",
            total_semesters=6,
            courses=courses,
        )
        faculty = ScrapedFaculty(
            external_ref="marburg-fb12",
            name="Mathematics & Computer Science (FB12)",
            programs=[program],
        )
        return ScrapedCatalog(
            source=self.source_key,
            university_external_ref="uni-marburg",
            university_name="University of Marburg",
            country="Germany",
            city="Marburg",
            email_domains=["students.uni-marburg.de", "uni-marburg.de", "staff.uni-marburg.de"],
            faculties=[faculty],
        )

    async def _try_scrape_courses(self) -> List[ScrapedCourse]:
        """Best-effort live parse. Returns [] on any failure so fetch() can fall
        back to the static catalog. Tolerant per-field parsing."""
        html = await self._download()
        if not html:
            return []
        try:
            import lxml.html as LH  # lazy: declared dep, may be absent in some shells
        except Exception:
            logger.warning("lxml not available; cannot parse Marburg catalog live.")
            return []

        courses: List[ScrapedCourse] = []
        try:
            doc = LH.fromstring(html)
            # Module catalogs commonly render rows in tables; be defensive about
            # structure. We look for table rows and pull (code?, title, ECTS?).
            for row in doc.xpath("//table//tr"):
                cells = [
                    (c.text_content() or "").strip()
                    for c in row.xpath("./td")
                ]
                if len(cells) < 1:
                    continue
                title = next((c for c in cells if len(c) > 3), "").strip()
                if not title:
                    continue
                code = self._first_codeish(cells)
                credits = self._first_number(cells)
                ext = "marburg-live-" + self._slug(code or title)
                courses.append(
                    ScrapedCourse(
                        external_ref=ext,
                        title=title,
                        course_code=code,
                        typical_semester=None,  # live page rarely encodes this reliably
                        credits=credits,
                        language="de",
                        is_mandatory=True,
                    )
                )
        except Exception as e:  # parsing is brittle by nature; never hard-fail
            logger.warning("Marburg catalog parse failed: %s", e)
            return []

        # Guard against junk parses (e.g. layout tables): require a plausible count.
        return courses if len(courses) >= 4 else []

    async def _download(self) -> Optional[str]:
        try:
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                resp = await client.get(self.url, headers={"User-Agent": "LearnstationCatalogBot/1.0"})
                if resp.status_code == 200:
                    return resp.text
                logger.warning("Marburg catalog fetch returned %s", resp.status_code)
        except Exception as e:
            logger.warning("Marburg catalog fetch failed: %s", e)
        return None

    @staticmethod
    def _first_codeish(cells: List[str]) -> Optional[str]:
        import re
        for c in cells:
            m = re.search(r"\b[A-Z]{2,}[- ]?\w*\b", c)
            if m and len(c) <= 20:
                return m.group(0)
        return None

    @staticmethod
    def _first_number(cells: List[str]) -> Optional[float]:
        import re
        for c in cells:
            m = re.search(r"\b(\d{1,2})(?:[.,]\d)?\b", c)
            if m:
                try:
                    return float(m.group(0).replace(",", "."))
                except ValueError:
                    continue
        return None

    @staticmethod
    def _slug(s: str) -> str:
        import re
        return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:48] or "course"
