"""
Bring every lecture a student can open up to the launch quality gate.

The visible catalog (2026-10-11) already had its slides, posters and most
quizzes, but almost no lecture blueprints, so no concept graph (concepts = 0
everywhere) and thin v4 "key ideas". Re-uploading would create new lecture ids
and orphan students' progress, so this script enriches lectures IN PLACE:

  1. blueprint  — generated from the slide text already in the database (no
                  PDF download, so no Storage egress), only where missing;
  2. concepts   — concept-graph ingestion from the blueprint + quiz tags;
  3. quizzes    — a cross-slide deck quiz where a lecture has fewer than 5;
  4. review     — spaced-repetition cards (idempotent).

Posters and the search index have their own backfills and are printed as
next steps, because both are better run once over the whole catalog:
  python -m backend.scripts.backfill_lecture_posters --local-dir ~/Downloads
  python -m backend.scripts.backfill_slide_embeddings --force   (after openai_only)

Same quality gate as Launch Control (backend/services/launch_control_service.py).
Dry run by default — it prints what it would do and touches nothing.

Usage:
    python -m backend.scripts.launch_catalog                     # status + plan
    python -m backend.scripts.launch_catalog --apply             # enrich all
    python -m backend.scripts.launch_catalog --apply --course "Datenbanksysteme"
    python -m backend.scripts.launch_catalog --apply --lecture-id <uuid>
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from backend.services.launch_control_service import (  # noqa: E402
    MIN_CONCEPTS, MIN_QUIZZES, LectureHealth, fetch_catalog,
)

logger = logging.getLogger("launch_catalog")

# Same per-slide budget as file_parse_service._stage_planning.
_PER_SLIDE_CHARS = 300


def plan_for(lecture: LectureHealth, has_blueprint: bool) -> List[str]:
    """The enrichment steps this lecture needs, in order."""
    steps: List[str] = []
    if lecture.concepts < MIN_CONCEPTS:
        if not has_blueprint:
            steps.append("blueprint")
        steps.append("concepts")
    if lecture.quizzes < MIN_QUIZZES:
        steps.append("quizzes")
    if steps:
        steps.append("review")
    return steps


def _slides(lecture_id: str) -> List[Dict[str, Any]]:
    from backend.core.database import supabase_admin
    res = (
        supabase_admin.table("slides")
        .select("id, slide_number, title, content_text, summary")
        .eq("lecture_id", lecture_id)
        .order("slide_number")
        .execute()
    )
    return res.data or []


async def _blueprint(lecture_id: str, pdf_hash: str, ai_model: str) -> bool:
    from backend.services.cache import store_cached_blueprint
    from backend.services.planner_service import BLUEPRINT_VERSION, generate_blueprint

    texts = [
        f"{(s.get('title') or '').strip()}\n{(s.get('content_text') or s.get('summary') or '').strip()}".strip()
        for s in _slides(lecture_id)
    ]
    summary = "\n".join(
        f"[Slide {i + 1}] {t[:_PER_SLIDE_CHARS]}" for i, t in enumerate(texts) if t
    )
    if not summary:
        return False
    blueprint = None
    async for event in generate_blueprint([], summary, [t for t in texts[:3] if t], ai_model):
        if event["type"] == "result":
            blueprint = event["data"]
    if not blueprint:
        return False
    await store_cached_blueprint(pdf_hash, blueprint, version=BLUEPRINT_VERSION)
    return True


async def _enrich(lecture: LectureHealth, pdf_hash: Optional[str], steps: List[str], ai_model: str) -> Dict[str, Any]:
    from backend.api.v1.slides_ai import build_and_persist_deck_quiz
    from backend.services.concept_graph import ingest_lecture_concepts
    from backend.services.review.card_factory import generate_review_cards

    done: Dict[str, Any] = {}
    for step in steps:
        try:
            if step == "blueprint":
                done[step] = await _blueprint(lecture.id, pdf_hash, ai_model) if pdf_hash else "no pdf_hash"
            elif step == "concepts":
                report = await ingest_lecture_concepts(lecture.id)
                done[step] = report.get("linked", 0)
            elif step == "quizzes":
                res = await build_and_persist_deck_quiz(lecture.id, _slides(lecture.id), ai_model)
                done[step] = res.get("persisted", 0)
            elif step == "review":
                # Arq job signature: (ctx, lecture_id); the script has no ctx.
                done[step] = await generate_review_cards({}, lecture.id)
        except Exception as exc:  # one lecture's failure never stops the run
            logger.error("%s failed for %s: %s", step, lecture.title, exc)
            done[step] = f"failed: {exc}"
    return done


async def run(apply: bool, course: Optional[str], lecture_id: Optional[str], ai_model: str) -> int:
    from backend.core.database import get_db_connection

    conn_cm = await get_db_connection()
    async with conn_cm as conn:
        lectures = await fetch_catalog(conn)
        hashes = {
            r["id"]: r["pdf_hash"]
            for r in await conn.fetch(
                "SELECT id::text, pdf_hash FROM public.lectures WHERE id::text = ANY($1::text[])",
                [l.id for l in lectures],
            )
        }
        with_bp = {
            r["pdf_hash"]
            for r in await conn.fetch(
                "SELECT DISTINCT pdf_hash FROM public.lecture_blueprints WHERE pdf_hash = ANY($1::text[])",
                [h for h in hashes.values() if h],
            )
        }

    if course:
        lectures = [l for l in lectures if l.course == course]
    if lecture_id:
        lectures = [l for l in lectures if l.id == lecture_id]

    todo = []
    print(f"{'course':<34} {'lecture':<40} {'sl':>4} {'qz':>4} {'cn':>4} {'emb':>4}  plan")
    for l in lectures:
        steps = plan_for(l, hashes.get(l.id) in with_bp)
        print(
            f"{l.course[:34]:<34} {l.title[:40]:<40} {l.slides:>4} {l.quizzes:>4} "
            f"{l.concepts:>4} {l.embedded:>4}  {', '.join(steps) or '-'}"
            + (f"   [{', '.join(m for m in l.missing if m in ('poster', 'search index', 'test content'))}]"
               if set(l.missing) & {"poster", "search index", "test content"} else "")
        )
        if steps:
            todo.append((l, steps))

    print(f"\n{len(todo)} of {len(lectures)} lectures need enrichment.")
    if not apply:
        print("Dry run — nothing changed. Re-run with --apply.")
        return 0

    for l, steps in todo:
        result = await _enrich(l, hashes.get(l.id), steps, ai_model)
        print(f"  {l.course[:24]} / {l.title[:40]}: {result}")

    print(
        "\nNext, once for the whole catalog:\n"
        "  python -m backend.scripts.backfill_lecture_posters --local-dir ~/Downloads\n"
        "  python -m backend.scripts.backfill_slide_embeddings --force"
    )
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--apply", action="store_true", help="make changes (default: dry run)")
    p.add_argument("--course", help="only lectures in this course (exact title)")
    p.add_argument("--lecture-id", help="only this lecture")
    p.add_argument("--ai-model", default="auto", help="provider hint (ignored in openai_only)")
    args = p.parse_args(argv)
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    return asyncio.run(run(args.apply, args.course, args.lecture_id, args.ai_model))


if __name__ == "__main__":
    sys.exit(main())
