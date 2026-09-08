"""Build a golden-set template from real ingested lectures (thesis Section 6).

Writing 50-80 golden questions is the most expensive step of the evaluation
and the one only a human can do. This script removes everything about it
that is not actually human work: it lists which lectures are usable, then
emits a JSON skeleton with `lecture_id`, `course_id` and `slide_index`
already filled in and each slide's real title and text preview alongside,
so the author only writes the question and the anchor phrase.

Two things it checks that are easy to get wrong
-----------------------------------------------
**Index convention.** `slides.slide_number` is 1-based;
`retrieve_relevant_slides` returns a 0-based `slide_index`
(`retrieval.py:345` looks up `slide_number == slide_index + 1`). The golden
set must use the 0-based form. Getting this backwards puts every question
off by one and scores the whole evaluation near zero while looking
perfectly plausible. This script does the conversion and labels both values
in the output.

**Embedding coverage.** Embeddings are written fire-and-forget during
ingestion (`unified_orchestrator.py:795`), so a lecture can hold slides and
no vectors. Retrieval over such a lecture returns nothing and scores 0.0
regardless of how good the retriever is. `--list` reports embedding
coverage per lecture; select only well-covered decks, and record that as
the selection criterion — it is a threat to validity worth stating in the
thesis rather than hiding.

Usage
-----
    # 1. See what is usable, and pick decks from this list.
    python -m backend.eval.make_golden_template --list

    # 2. Emit a skeleton for the chosen lectures.
    python -m backend.eval.make_golden_template \\
        --lectures <uuid>,<uuid>,<uuid> \\
        --per-lecture 8 \\
        --out backend/eval/data/golden_set.json

    # 3. Fill in "question" and "anchor" by hand, then run:
    python -m backend.eval.retrieval_grid --golden backend/eval/data/golden_set.json

Needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (service role reads
bypass RLS, which is what makes a cross-course corpus survey possible).
"""
from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

PREVIEW_CHARS = 320


def _client():
    """Import lazily so `--help` works without backend deps installed."""
    from backend.core.database import supabase_admin

    return supabase_admin


def survey_lectures(min_slides: int = 5, limit: int = 200) -> List[Dict[str, Any]]:
    """List lectures with their slide and embedding counts.

    Embedding coverage is the column that decides usability: a lecture at
    0% is unusable for retrieval evaluation no matter how good its content.
    """
    client = _client()

    lectures = (
        client.table("lectures")
        .select("id, title, course_id, total_slides, is_archived")
        .eq("is_archived", False)
        .limit(limit)
        .execute()
    ).data or []

    rows: List[Dict[str, Any]] = []
    for lec in lectures:
        lecture_id = lec["id"]

        # `lectures.total_slides` is a denormalised counter and is known to
        # drift from the real row count, so count the slides themselves.
        slides = (
            client.table("slides")
            .select("slide_number", count="exact")
            .eq("lecture_id", lecture_id)
            .execute()
        )
        slide_count = slides.count if slides.count is not None else len(slides.data or [])
        if slide_count < min_slides:
            continue

        embeddings = (
            client.table("slide_embeddings")
            .select("slide_index", count="exact")
            .eq("lecture_id", lecture_id)
            .execute()
        )
        embedding_count = (
            embeddings.count if embeddings.count is not None else len(embeddings.data or [])
        )

        rows.append({
            "lecture_id": lecture_id,
            "title": (lec.get("title") or "").strip() or "(untitled)",
            "course_id": lec.get("course_id") or "",
            "slides": slide_count,
            "embeddings": embedding_count,
            "coverage": (embedding_count / slide_count) if slide_count else 0.0,
            "reported_total_slides": lec.get("total_slides"),
        })

    rows.sort(key=lambda r: (-r["coverage"], -r["slides"]))
    return rows


def print_survey(rows: List[Dict[str, Any]]) -> None:
    print(f"\n{len(rows)} candidate lectures (sorted by embedding coverage)\n")
    print(f"{'coverage':>9}  {'slides':>6}  {'emb':>6}  {'drift':>6}  lecture_id / title")
    print("-" * 100)
    for r in rows:
        reported = r["reported_total_slides"]
        drift = "" if reported == r["slides"] else f"{reported}!"
        print(
            f"{r['coverage']*100:8.1f}%  {r['slides']:6d}  {r['embeddings']:6d}  "
            f"{drift:>6}  {r['lecture_id']}  {r['title'][:48]}"
        )
    print(
        "\nPick decks at or near 100% coverage. A `drift` value means "
        "`lectures.total_slides` disagrees with the real slide count "
        "(a finding in its own right — see the thesis's built-vs-deployed section)."
    )
    print("Prefer several lectures from ONE course so the course-scoped "
          "hybrid regime has a meaningful search space.\n")


def build_template(
    lecture_ids: List[str], per_lecture: int, min_chars: int = 40
) -> Dict[str, Any]:
    """Emit a golden-set skeleton with real ids and slide text to write against.

    Slides are sampled evenly across each deck rather than taken from the
    front, so the question set covers the whole lecture instead of clustering
    on title and agenda slides.
    """
    client = _client()
    questions: List[Dict[str, Any]] = []
    corpus: List[Dict[str, Any]] = []

    for lecture_id in lecture_ids:
        lec = (
            client.table("lectures")
            .select("id, title, course_id")
            .eq("id", lecture_id)
            .limit(1)
            .execute()
        ).data or []
        if not lec:
            logger.warning("lecture %s not found — skipping", lecture_id)
            continue
        lec = lec[0]
        course_id = lec.get("course_id") or ""

        slides = (
            client.table("slides")
            .select("slide_number, title, content_text, summary")
            .eq("lecture_id", lecture_id)
            .order("slide_number")
            .execute()
        ).data or []

        # Skip slides with too little text to ask a fair question about. A
        # near-empty slide is exactly what the pipeline routes to the vision
        # model, so tag those `visual` and write questions about the figure.
        usable = [
            s for s in slides
            if len((s.get("content_text") or s.get("summary") or "").strip()) >= min_chars
        ]
        if not usable:
            logger.warning("lecture %s has no slides with >= %d chars", lecture_id, min_chars)
            continue

        step = max(1, len(usable) // per_lecture)
        chosen = usable[::step][:per_lecture]

        for slide in chosen:
            slide_number = int(slide["slide_number"])          # 1-based, as stored
            slide_index = slide_number - 1                     # 0-based, as retrieved
            text = (slide.get("content_text") or slide.get("summary") or "").strip()
            questions.append({
                "id": f"{lecture_id[:8]}-s{slide_index}",
                "question": "",                                 # <- YOU WRITE THIS
                "anchor": "",                                   # <- AND THIS
                "category": "text",
                "lecture_id": lecture_id,
                "course_id": course_id,
                "slide_index": slide_index,
                "expected_answer": "",
                "_slide_number_1based": slide_number,
                "_slide_title": slide.get("title") or "",
                "_slide_preview": text[:PREVIEW_CHARS],
            })

        corpus.append({
            "lecture_id": lecture_id,
            "title": lec.get("title") or "",
            "course_id": course_id,
            "slides_total": len(slides),
            "slides_usable": len(usable),
            "questions": len(chosen),
        })

    return {
        "_instructions": [
            "Fill in 'question' and 'anchor' for every entry. Delete entries you do not want.",
            "anchor = a short VERBATIM phrase from that slide. It is matched "
            "case- and whitespace-insensitively against the retrieved text.",
            "Set category to 'visual' for diagram-heavy slides — those probe "
            "the 25-character vision-routing threshold.",
            "slide_index is 0-BASED and already correct. Do not 'fix' it to "
            "match _slide_number_1based; retrieval returns the 0-based form.",
            "Verify every expectation against the real slide yourself. A golden "
            "set graded against the model's own opinion is not a regression detector.",
            "Fields prefixed with _ are context for writing and are ignored by the runner.",
        ],
        "_corpus": corpus,
        "questions": questions,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Survey ingested lectures and emit a golden-set template."
    )
    parser.add_argument("--list", action="store_true",
                        help="list candidate lectures with embedding coverage and exit")
    parser.add_argument("--lectures", default="",
                        help="comma-separated lecture UUIDs to build a template for")
    parser.add_argument("--per-lecture", type=int, default=8,
                        help="slides to sample per lecture (default 8)")
    parser.add_argument("--min-slides", type=int, default=5,
                        help="ignore lectures with fewer slides than this when listing")
    parser.add_argument("--out", default="backend/eval/data/golden_set.template.json")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING,
                        format="%(levelname)s %(message)s")

    if args.list or not args.lectures:
        rows = survey_lectures(min_slides=args.min_slides)
        print_survey(rows)
        if not args.lectures:
            print("Re-run with --lectures <uuid>,<uuid>,... to emit a template.")
            return

    lecture_ids = [x.strip() for x in args.lectures.split(",") if x.strip()]
    template = build_template(lecture_ids, per_lecture=args.per_lecture)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(template, indent=2, ensure_ascii=False), encoding="utf-8")

    n = len(template["questions"])
    print(f"\nWrote {n} question stubs across {len(template['_corpus'])} lectures to {out}")
    print("Now fill in 'question' and 'anchor' for each, then run:")
    print(f"  python -m backend.eval.retrieval_grid --golden {out}")


if __name__ == "__main__":
    main()
