"""Which ideas of a course build on which — the prerequisite links behind the course map.

One model call per course, cached: it reads every idea of every lecture, in
teaching order, and names, for each idea, the earlier ideas a student must
understand first. The answer is kept only where it is checkable:

* both ends must be real ideas of this course (by the ids the prompt gave);
* a prerequisite must be taught *before* what builds on it — so the links
  can never form a cycle, whatever the model says;
* at most three prerequisites per idea, duplicates dropped.

The cache key carries a digest of the ideas themselves, so regrouping a
lecture (a new IDEAS_VERSION, a new deck revision) asks again.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import re
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, Field, ValidationError

from backend.services.cache import get_cache, set_cache
from backend.services.v4_reader_service import course_map

logger = logging.getLogger(__name__)

LINKS_VERSION = "links-v2"  # v2: compact "to<needs" strings — long JSON objects broke mid-answer
LINKS_TTL = 60 * 60 * 24 * 60
MAX_PREREQS = 3
#: Lectures per model call: each answer stays short enough never to be cut off.
BATCH = 3


class _Link(BaseModel):
    to: str = Field(min_length=2, max_length=12)
    needs: list[str] = Field(default_factory=list)
    why: str = Field(default="", max_length=160)


PROMPT = """Below are the ideas of a university course, in the order it teaches them,
each with an id. For each idea that genuinely builds on earlier ones, name the
earlier ideas a student must understand first — its prerequisites.

Rules: only real dependencies (you cannot follow B without A), not mere
"same topic"; a prerequisite is always an EARLIER id; at most 3 per idea; most
ideas need 0-2. Leave out ideas with none.

Course: {course}
{listing}

Answer ONLY for the ideas of lectures {first} to {last} (ids L{first}.* to L{last}.*);
their prerequisites may come from any earlier lecture.

Answer with ONE JSON object only, one string per idea that has prerequisites,
written as the idea's id, "<", then its prerequisites' ids separated by commas:
{{"links":["L4.6<L4.5,L4.2","L5.1<L4.6", ...]}}"""


def _ids(lectures: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Every idea with a short id (L<lecture order>.<n>) and its place in teaching order."""
    out = []
    for li, lec in enumerate(lectures, start=1):
        for ii, idea in enumerate(sorted(lec["ideas"] or [], key=lambda i: i["first_page"]), start=1):
            out.append(
                {"id": f"L{li}.{ii}", "rank": len(out), "lecture_id": lec["id"], "lecture": lec["title"], **idea}
            )
    return out


#: One link as the compact form writes it: "L4.6<L4.5,L4.2".
_LINE = re.compile(r"(L\d+\.\d+)\s*<\s*((?:L\d+\.\d+\s*,?\s*)+)")


def salvage(raw: str) -> dict[str, Any]:
    """Every complete link in the text, even when the JSON around it was cut off."""
    return {"links": [f"{m.group(1)}<{m.group(2)}" for m in _LINE.finditer(raw or "")]}


def keep_links(ideas: list[dict[str, Any]], data: Any) -> list[dict[str, Any]]:
    """The model's links, kept only where checkable: real ids, earlier prerequisites, at most three."""
    raw = data.get("links") if isinstance(data, dict) else data
    if not isinstance(raw, list):
        return []
    # One malformed entry costs only itself, never the whole answer.
    parsed: list[_Link] = []
    for item in raw[:200]:
        if isinstance(item, str):
            # The compact form: "L4.6<L4.5,L4.2".
            to, sep, needs = item.partition("<")
            if not sep:
                continue
            item = {"to": to.strip(), "needs": [n.strip() for n in needs.split(",") if n.strip()]}
        try:
            parsed.append(_Link.model_validate(item))
        except ValidationError:
            continue
    by_id = {i["id"]: i for i in ideas}
    out: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for link in parsed:
        to = by_id.get(link.to.strip())
        if not to:
            continue
        kept = 0
        for need in link.needs[:8]:
            pre = by_id.get(need.strip())
            if not pre or pre["rank"] >= to["rank"] or (pre["id"], to["id"]) in seen:
                continue
            seen.add((pre["id"], to["id"]))
            out.append(
                {
                    "from": {"lecture_id": pre["lecture_id"], "first_page": pre["first_page"]},
                    "to": {"lecture_id": to["lecture_id"], "first_page": to["first_page"]},
                    "why": link.why.strip()[:160],
                }
            )
            kept += 1
            if kept >= MAX_PREREQS:
                break
    return out


async def course_links(course_id: UUID, *, user_id: str) -> dict[str, Any]:
    course = await course_map(course_id, user_id)
    lectures = [lec for lec in course["lectures"] if lec.get("ideas")]
    if len(lectures) < max(2, (len(course["lectures"]) + 1) // 2):
        raise HTTPException(status_code=409, detail="The lectures' ideas are still being grouped.")
    ideas = _ids(lectures)
    digest = hashlib.sha1("|".join(f"{i['lecture_id']}:{i['first_page']}:{i['name']}" for i in ideas).encode()).hexdigest()[:16]
    key = f"v4reader:{LINKS_VERSION}:{course_id}:{digest}"
    cached = await get_cache(key)
    if isinstance(cached, list):
        return {"links": cached, "cached": True, "complete": len(lectures) == len(course["lectures"])}

    listing = "\n".join(f"{i['id']} {i['name']} ({i['lecture']})" for i in ideas)

    from backend.services.ai.orchestrator import generate_text

    gate = asyncio.Semaphore(2)  # two at a time: the free tiers' per-minute limits trip on four
    failed: list[tuple[int, int]] = []

    async def batch(first: int, last: int) -> list[dict[str, Any]]:
        """The links into lectures first..last — short answers, so none is cut off."""
        async with gate:
            return await ask(first, last)

    async def ask(first: int, last: int) -> list[dict[str, Any]]:
        prompt = PROMPT.format(course=course.get("title") or "", listing=listing, first=first, last=last)
        for prefer in ("gemini", "groq"):
            try:
                raw = await generate_text(
                    prompt, prefer, json_mode=True, user_id=user_id, course_id=str(course_id), feature="v4_links"
                )
            except Exception as exc:  # noqa: BLE001 — any failure tries the next provider
                if exc.__class__.__name__ == "LLMBudgetExceededError":
                    raise HTTPException(status_code=429, detail="You have reached this month's AI allowance.")
                logger.warning("links L%s-L%s via %s failed for %s: %s", first, last, prefer, course_id, exc)
                continue
            found = keep_links(ideas, salvage(raw))
            if found:
                return found
        failed.append((first, last))
        return []

    spans = [(a, min(a + BATCH - 1, len(lectures))) for a in range(1, len(lectures) + 1, BATCH)]
    links = [link for part in await asyncio.gather(*(batch(a, b) for a, b in spans)) for link in part]
    if not links:
        raise HTTPException(status_code=502, detail="Couldn't map how the ideas connect just now.")
    # Only a complete map is cached — every lecture grouped, every batch answered —
    # or a gap would stick after the rest arrives.
    complete = len(lectures) == len(course["lectures"]) and not failed
    if complete:
        await set_cache(key, links, ttl_seconds=LINKS_TTL)
    return {"links": links, "cached": False, "complete": complete}
