"""What people asked on a page, as up to three themes. Never their words.

Only for a page where at least `MIN_READERS` different members asked (the
owner excluded): the model sees the questions, the owner sees only the themes
(spec §0). The call is metered to the owner, since their view asks for it,
and cached per page and per number of askers, so it runs again only when
someone new has asked. A failed call yields no themes and is not cached.
"""
from __future__ import annotations

import logging
from typing import Any

from backend.services import analytics_cache
from backend.services.insights.space_engine import MIN_READERS

logger = logging.getLogger(__name__)

THEMES_VERSION = "themes-v1"
#: Themes change only when someone new asks (the key holds the asker count).
THEMES_TTL = 60 * 60 * 24 * 30
MAX_THEMES = 3
#: The most recent questions the model sees for one page.
MAX_TEXTS = 60

_LANGUAGE = {"en": "English", "de": "German (address no one, no exclamation marks)"}


def themes_prompt(texts: list[str], lang: str) -> str:
    questions = "\n".join(f"- {t[:300]}" for t in texts[-MAX_TEXTS:])
    return (
        "You help the person who runs a learning group see what one page of a lesson left open.\n"
        f"Below are questions members asked about that page. Write at most {MAX_THEMES} short themes in "
        f"{_LANGUAGE.get(lang, 'English')}, each a phrase under 12 words naming what was unclear.\n"
        "Never quote a question. Never include a name or anything that could tell who asked.\n"
        'Return JSON only: {"themes": ["..."]}\n\n'
        f"Questions:\n{questions}"
    )


def clean_themes(data: Any, texts: list[str]) -> list[str]:
    """At most three short, distinct themes; anything that repeats a question is dropped."""
    raw = data.get("themes") if isinstance(data, dict) else None
    if not isinstance(raw, list):
        return []
    asked = {t.strip().lower() for t in texts}
    out: list[str] = []
    for item in raw:
        if not isinstance(item, str):
            continue
        theme = " ".join(item.split())[:120]
        if theme and theme.lower() not in asked and theme not in out:
            out.append(theme)
    return out[:MAX_THEMES]


async def themes_for(
    *, space_id: str, owner_id: str, lesson_id: str, page: int, texts: list[str], askers: int, lang: str
) -> list[str]:
    if askers < MIN_READERS or not texts:
        return []
    from backend.services.v4_reader_service import _generate_json

    async def compute() -> list[str]:
        data = await _generate_json(
            themes_prompt(texts, lang),
            user_id=owner_id, course_id=space_id, feature="v4_landing_themes", prefer="openai",
        )
        return clean_themes(data, texts)

    try:
        return await analytics_cache.get_or_compute_async(
            space_id,
            "themes",
            compute,
            params={"lesson": lesson_id, "page": page, "askers": askers, "lang": lang, "v": THEMES_VERSION},
            ttl_seconds=THEMES_TTL,
        )
    except Exception:  # noqa: BLE001 — a theme never costs the owner their view
        logger.warning("landing: themes for %s p%s not made", lesson_id, page, exc_info=True)
        return []
