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
            # More embedding rows than slides means duplicates. The upsert
            # constraint (migration 20260719000002) is evidently not in force:
            # store_slide_embedding emulated an upsert with delete-then-insert,
            # which races, and that migration's own header warns a prod backfill
            # must dedup FIRST or the ALTER TABLE fails. Such a lecture is unfit
            # for the golden set — a duplicated slide occupies several top-k
            # slots and depresses precision for reasons unrelated to retrieval.
            "duplicated": embedding_count > slide_count,
            "reported_total_slides": lec.get("total_slides"),
        })

    rows.sort(key=lambda r: (-r["coverage"], -r["slides"]))
    return rows


def print_survey(rows: List[Dict[str, Any]]) -> None:
    print(f"\n{len(rows)} candidate lectures (sorted by embedding coverage)\n")
    print(f"{'coverage':>9} {'dup':>4}  {'slides':>6}  {'emb':>6}  {'drift':>6}  "
          f"{'course':>8}  lecture_id / title")
    print("-" * 118)
    for r in rows:
        reported = r["reported_total_slides"]
        drift = "" if reported == r["slides"] else f"{reported}!"
        dup = "DUP" if r["duplicated"] else ""
        course = (r["course_id"] or "")[:8]
        print(
            f"{r['coverage']*100:8.1f}% {dup:>4}  {r['slides']:6d}  {r['embeddings']:6d}  "
            f"{drift:>6}  {course:>8}  {r['lecture_id']}  {r['title'][:44]}"
        )
    print(
        "\nPick decks at 100% coverage and WITHOUT a DUP marker. `DUP` means more "
        "embedding rows than slides, so a slide can occupy several top-k slots and "
        "depress precision for reasons unrelated to retrieval. `drift` means "
        "`lectures.total_slides` disagrees with the real slide count. Both are "
        "findings in their own right — see the built-vs-deployed section."
    )
    print("Group by the `course` column: several lectures from ONE course give the "
          "course-scoped hybrid regime a meaningful search space.\n")


def print_corpus_stats(rows: List[Dict[str, Any]], min_coverage: float = 0.97) -> None:
    """Corpus-level embedding coverage — reproducible evidence for the thesis.

    Two findings are quantified here rather than counted by hand, so the
    numbers in the Evaluation chapter can be regenerated from a committed
    script instead of trusted:

    1. Lectures with ZERO embeddings. Embeddings are written fire-and-forget
       during ingestion (`unified_orchestrator.py`, the embedding call is not
       awaited), so a parse can report success with its vectors still in
       flight or lost. Such a lecture holds slides and is invisible to every
       retrieval path in the system.

    2. Lectures with MORE embeddings than slides. `store_slide_embedding`
       emulated an upsert with delete-then-insert, which races; migration
       20260719000002 added UNIQUE(pdf_hash, slide_index, pipeline_version)
       to close it, and warns in its own header that a production backfill
       must dedup first or the ALTER TABLE fails. Duplicates surviving in
       production are evidence the constraint is not in force there.

    Note this surveys non-archived lectures only, which is the population the
    retrieval paths can actually reach.
    """
    if not rows:
        print("no lectures surveyed")
        return

    total = len(rows)
    total_slides = sum(r["slides"] for r in rows)
    zero = [r for r in rows if r["embeddings"] == 0]
    dup = [r for r in rows if r["duplicated"]]
    complete = [r for r in rows if not r["duplicated"] and r["coverage"] >= 1.0]
    partial = [r for r in rows if 0 < r["coverage"] < 1.0]
    # Usable is NOT the same as complete. A lecture at 98.9% is missing one or
    # two slides out of eighty-seven; excluding it wastes most of the corpus.
    # The only consequence is a small ceiling: a question about an unembedded
    # slide can never be answered, which shows up as a handful of misses rather
    # than as a distortion. Duplicates are excluded outright, because those DO
    # distort — a repeated slide consumes several top-k slots.
    usable = [r for r in rows if not r["duplicated"] and r["coverage"] >= min_coverage]
    drift = [r for r in rows if r["reported_total_slides"] != r["slides"]]

    def pct(n: int) -> str:
        return f"{n / total * 100:.1f}%"

    print("\n=== Corpus embedding coverage ===")
    print(f"lectures surveyed              {total:5d}   ({total_slides} slides)")
    print(f"  zero embeddings              {len(zero):5d}   {pct(len(zero)):>7}   "
          f"{sum(r['slides'] for r in zero)} slides unreachable by retrieval")
    print(f"  partial coverage (0<c<1)     {len(partial):5d}   {pct(len(partial)):>7}")
    print(f"  complete (100%), no dupes    {len(complete):5d}   {pct(len(complete)):>7}")
    print(f"  usable (>={min_coverage:.0%}), no dupes      {len(usable):5d}   {pct(len(usable)):>7}   <- corpus candidates")
    print(f"  MORE embeddings than slides  {len(dup):5d}   {pct(len(dup)):>7}   <- upsert constraint not in force")
    print(f"  total_slides drift           {len(drift):5d}   {pct(len(drift)):>7}")

    if dup:
        print("\nDuplicated lectures (embeddings / slides):")
        for r in sorted(dup, key=lambda x: -x["coverage"]):
            print(f"  {r['coverage']*100:7.1f}%  {r['embeddings']:4d}/{r['slides']:<4d}  "
                  f"{r['lecture_id']}  {r['title'][:44]}")

    # Courses that could supply a corpus: several clean lectures in one course.
    by_course: Dict[str, List[Dict[str, Any]]] = {}
    for r in usable:
        by_course.setdefault(r["course_id"] or "(none)", []).append(r)
    viable = {c: v for c, v in by_course.items() if len(v) >= 4 and c != "(none)"}
    if viable:
        print("\nCourses with >=4 clean lectures (candidate corpora):")
        for c, v in sorted(viable.items(), key=lambda kv: -sum(x["slides"] for x in kv[1])):
            print(f"\n  course {c}  —  {len(v)} lectures, {sum(x['slides'] for x in v)} slides")
            for r in sorted(v, key=lambda x: -x["slides"]):
                print(f"    {r['slides']:4d} slides  {r['lecture_id']}  {r['title'][:44]}")
    else:
        print(f"\nNo single course has >=4 lectures at >={min_coverage:.0%} coverage. "
              f"Re-run with a lower --min-coverage, or accept a corpus spanning "
              f"courses and state that as a threat to validity — the course-scoped "
              f"hybrid regime then searches a narrower space than it would in use.")
    print()


def print_course(course_id: str, min_slides: int = 5) -> None:
    """Every lecture in one course, with coverage — build a corpus FROM a course.

    Picking lectures by coverage and then discovering their course is the wrong
    order: `lectures.course_id` is nullable, and a lecture that belongs to no
    course cannot be reached by course-scoped retrieval at all, so the hybrid
    regime silently loses those questions. Starting from the course guarantees
    every question can run in both regimes.
    """
    client = _client()
    lectures = (
        client.table("lectures")
        .select("id, title, total_slides, is_archived")
        .eq("course_id", course_id)
        .eq("is_archived", False)
        .execute()
    ).data or []

    rows = []
    for lec in lectures:
        lid = lec["id"]
        s = client.table("slides").select("slide_number", count="exact").eq("lecture_id", lid).execute()
        n = s.count if s.count is not None else len(s.data or [])
        if n < min_slides:
            continue
        e = client.table("slide_embeddings").select("slide_index", count="exact").eq("lecture_id", lid).execute()
        m = e.count if e.count is not None else len(e.data or [])
        rows.append({"id": lid, "title": (lec.get("title") or "").strip(),
                     "slides": n, "emb": m, "cov": m / n if n else 0.0})

    rows.sort(key=lambda r: (-r["cov"], -r["slides"]))
    print(f"\n{len(rows)} lectures in course {course_id}\n")
    print(f"{'coverage':>9} {'dup':>4}  {'slides':>6}  {'emb':>6}  lecture_id / title")
    print("-" * 104)
    usable = []
    for r in rows:
        dup = "DUP" if r["emb"] > r["slides"] else ""
        print(f"{r['cov']*100:8.1f}% {dup:>4}  {r['slides']:6d}  {r['emb']:6d}  {r['id']}  {r['title'][:44]}")
        if not dup and r["cov"] >= 0.97:
            usable.append(r)

    if usable:
        print(f"\n{len(usable)} usable lectures, {sum(r['slides'] for r in usable)} slides.")
        print("Every question drawn from these can run in BOTH regimes. Command:\n")
        print("python -m backend.eval.make_golden_template --lectures "
              + ",".join(r["id"] for r in usable) + " --per-lecture 10 "
              "--out backend/eval/data/golden_set.json")
    else:
        print("\nNo lecture in this course reaches 97% coverage without duplicates.")
    print()


def dump_slides(golden_path: str, out_path: str = "slides_full.txt") -> None:
    """Emit the FULL text of every slide a golden question points at.

    The template previews are truncated at 320 characters, so a question drafted
    from one may rest on a slide that continued past the cut. This prints the
    whole slide so each expectation can be checked against what the slide
    actually says.

    Written to a UTF-8 file rather than stdout: extracted slide text carries
    private-use codepoints (PowerPoint symbol fonts render the algebra operators
    as glyphs in U+E000-U+F8FF), and a Windows console using cp1252 raises
    UnicodeEncodeError on the first one. Those characters are themselves a
    finding about extraction quality, so they should be inspected rather than
    crashed on.
    """
    cases = json.loads(Path(golden_path).read_text(encoding="utf-8"))
    qs = cases["questions"] if isinstance(cases, dict) else cases
    client = _client()
    lines: List[str] = []
    pua_hits = 0
    for q in qs:
        res = (client.table("slides")
               .select("title, content_text, summary")
               .eq("lecture_id", q["lecture_id"])
               .eq("slide_number", int(q["slide_index"]) + 1)  # stored 1-based
               .limit(1).execute()).data or []
        body = ""
        if res:
            body = (res[0].get("content_text") or res[0].get("summary") or "").strip()
        n_pua = sum(1 for ch in body if 0xE000 <= ord(ch) <= 0xF8FF)
        pua_hits += n_pua
        lines.append(f"\n===== {q['id']} | slide_index={q['slide_index']} =====")
        lines.append(f"Q: {q['question']}")
        lines.append(f"ANCHOR: {q['anchor']}")
        lines.append(f"EXPECTED (to check): {q['expected_answer']}")
        if n_pua:
            lines.append(f"[!] {n_pua} private-use characters — symbol-font glyphs lost in extraction")
        lines.append(f"--- FULL SLIDE ---\n{body if body else '(no text found)'}")

    Path(out_path).write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {len(qs)} slides to {out_path}")
    if pua_hits:
        print(f"{pua_hits} private-use codepoints across the corpus: mathematical "
              f"notation is being lost at extraction. Quantify this for the "
              f"Evaluation chapter — it bears directly on retrieval over a "
              f"symbol-heavy course.")


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
    parser.add_argument("--stats", action="store_true",
                        help="print corpus-level coverage statistics and candidate corpora")
    parser.add_argument("--course", default="",
                        help="list every lecture in this course with coverage, and emit "
                             "the --lectures command for the ones usable in both regimes")
    parser.add_argument("--dump", default="",
                        help="write the FULL text of every slide a golden set points at "
                             "to --dump-out, for checking expectations against "
                             "untruncated slides")
    parser.add_argument("--dump-out", default="slides_full.txt",
                        help="where --dump writes (UTF-8; default slides_full.txt)")
    parser.add_argument("--min-coverage", type=float, default=0.97,
                        help="embedding coverage a lecture needs to count as a corpus "
                             "candidate (default 0.97; 1.0 demands every slide embedded)")
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

    if args.course:
        print_course(args.course, min_slides=args.min_slides)
        return

    if args.dump:
        dump_slides(args.dump, args.dump_out)
        return

    if args.stats:
        # Survey everything, not just decks big enough to write questions about:
        # the coverage finding is about the whole corpus.
        print_corpus_stats(survey_lectures(min_slides=1), min_coverage=args.min_coverage)
        if not args.lectures:
            return

    if args.list or not args.lectures:
        rows = survey_lectures(min_slides=args.min_slides)
        print_survey(rows)
        if not args.lectures:
            print("Re-run with --stats for corpus statistics, or "
                  "--lectures <uuid>,<uuid>,... to emit a template.")
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
