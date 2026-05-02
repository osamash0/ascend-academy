"""
Concept Graph ingestion + query service.

Builds a persistent, cross-course catalog of canonicalized concepts so the
nudge engine, optimal-scheduling, and overall-stats features have a single
source of truth for what each student knows across their whole degree.

Pipeline (per lecture publish):
    1. Pull raw concept tags from quiz_questions.metadata.concept and from the
       cached blueprint (slide_plans[].concepts + cross_slide_quiz_concepts).
    2. Embed each unique normalized concept name.
    3. Find the nearest existing concept in `concepts` via cosine similarity.
    4. If similarity >= MATCH_THRESHOLD reuse the row (and append the raw
       string to its aliases); otherwise insert a new canonical concept.
    5. Upsert one `concept_lectures` row per (concept_id, lecture_id) capturing
       the slide indices and weight.

Idempotent on re-run.  Writes use supabase_admin so the backend can populate
the catalog regardless of caller authorization.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Optional, Tuple

from backend.core.database import supabase_admin
from backend.services.ai.embeddings import generate_embeddings

logger = logging.getLogger(__name__)

# A pair of strings whose embeddings cosine-similar above this are treated
# as the same concept.  0.86 keeps "Linear Regression" and "Linear regression
# model" together but separates "Backpropagation" from "Forward propagation".
MATCH_THRESHOLD = 0.86
MAX_ALIASES = 24


# ─── Helpers ────────────────────────────────────────────────────────────────

_WS = re.compile(r"\s+")


def _normalize(name: str) -> str:
    """Lowercase, collapse whitespace, strip punctuation that shouldn't matter."""
    if not name:
        return ""
    s = name.strip().lower()
    s = _WS.sub(" ", s)
    # Trim leading/trailing punctuation that shouldn't gate equality.
    s = s.strip(" -–—:;,.()[]\"'")
    return s


def _cosine(a: List[float], b: List[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 0.0 or nb <= 0.0:
        return 0.0
    return dot / ((na ** 0.5) * (nb ** 0.5))


# ─── Dedupe (testable, side-effect-free) ────────────────────────────────────

def find_match(
    candidate_embedding: List[float],
    catalog: Iterable[Dict[str, Any]],
    threshold: float = MATCH_THRESHOLD,
) -> Optional[Dict[str, Any]]:
    """Return the catalog entry most similar to ``candidate_embedding``.

    ``catalog`` is an iterable of ``{"id", "canonical_name", "name_key",
    "embedding"}`` dicts.  Returns the best match if its cosine similarity
    is >= ``threshold``, otherwise ``None``.

    Pure function: no Supabase, no network — the integration layer fetches
    the catalog and passes it in.  This keeps the dedupe rule unit-testable
    without spinning up pgvector.
    """
    best: Optional[Dict[str, Any]] = None
    best_sim = -1.0
    for row in catalog:
        emb = row.get("embedding")
        sim = _cosine(candidate_embedding, emb or [])
        if sim > best_sim:
            best_sim = sim
            best = row
    if best is None or best_sim < threshold:
        return None
    out = dict(best)
    out["similarity"] = best_sim
    return out


# ─── Tag harvesting ─────────────────────────────────────────────────────────

def _gather_tags_from_blueprint(blueprint: Optional[Dict[str, Any]]) -> Dict[str, List[int]]:
    """Return ``{normalized_name: [slide_indices...]}`` from a blueprint."""
    out: Dict[str, List[int]] = {}
    if not blueprint:
        return out
    for plan in blueprint.get("slide_plans", []) or []:
        idx = plan.get("index")
        for c in plan.get("concepts", []) or []:
            key = _normalize(c)
            if not key:
                continue
            bucket = out.setdefault(key, [])
            if isinstance(idx, int) and idx not in bucket:
                bucket.append(idx)
    for c in blueprint.get("cross_slide_quiz_concepts", []) or []:
        key = _normalize(c)
        if key and key not in out:
            out[key] = []
    return out


def _gather_tags_from_questions(
    questions: List[Dict[str, Any]],
    slide_id_to_index: Dict[str, int],
) -> Dict[str, List[int]]:
    """Pull concept tags from quiz_questions.metadata.concept."""
    out: Dict[str, List[int]] = {}
    for q in questions or []:
        meta = q.get("metadata") or {}
        if not isinstance(meta, dict):
            continue
        concept = meta.get("concept")
        if not concept:
            continue
        key = _normalize(concept)
        if not key:
            continue
        bucket = out.setdefault(key, [])
        # Anchor slide first, then any cross-linked slides
        sid = q.get("slide_id")
        if sid and sid in slide_id_to_index:
            sx = slide_id_to_index[sid]
            if sx not in bucket:
                bucket.append(sx)
        for li in meta.get("linked_slides", []) or []:
            if isinstance(li, int) and li not in bucket:
                bucket.append(li)
    return out


def _merge_tags(
    a: Dict[str, List[int]], b: Dict[str, List[int]]
) -> Dict[str, List[int]]:
    out = {k: list(v) for k, v in a.items()}
    for k, v in b.items():
        bucket = out.setdefault(k, [])
        for i in v:
            if i not in bucket:
                bucket.append(i)
    return out


def collect_concept_tags(
    blueprint: Optional[Dict[str, Any]],
    questions: List[Dict[str, Any]],
    slide_id_to_index: Dict[str, int],
) -> Dict[str, Tuple[str, List[int]]]:
    """Return ``{name_key: (display_name, [slide_indices])}`` for one lecture.

    The display name is the *first* raw casing observed for that key — it's
    the string we'll persist as the canonical name when a brand new concept
    row is inserted.
    """
    raw_to_display: Dict[str, str] = {}
    # Display name preference: blueprint plans → cross-slide list → questions
    for source in (blueprint or {}).get("slide_plans", []) or []:
        for c in source.get("concepts", []) or []:
            key = _normalize(c)
            if key and key not in raw_to_display:
                raw_to_display[key] = c.strip()
    for c in (blueprint or {}).get("cross_slide_quiz_concepts", []) or []:
        key = _normalize(c)
        if key and key not in raw_to_display:
            raw_to_display[key] = c.strip()
    for q in questions or []:
        meta = q.get("metadata") or {}
        if not isinstance(meta, dict):
            continue
        c = meta.get("concept")
        if not c:
            continue
        key = _normalize(c)
        if key and key not in raw_to_display:
            raw_to_display[key] = c.strip()

    bp_tags = _gather_tags_from_blueprint(blueprint)
    q_tags = _gather_tags_from_questions(questions, slide_id_to_index)
    merged = _merge_tags(bp_tags, q_tags)

    return {
        key: (raw_to_display.get(key, key), sorted(set(slides)))
        for key, slides in merged.items()
    }


# ─── Catalog access (Supabase-bound) ────────────────────────────────────────

def _load_catalog(client=None) -> List[Dict[str, Any]]:
    """Fetch every concept row.  Cheap until we cross a few thousand rows;
    swap to an RPC + per-candidate query if/when that becomes a problem."""
    cli = client or supabase_admin
    try:
        res = cli.table("concepts").select(
            "id, canonical_name, name_key, aliases, embedding"
        ).execute()
        return res.data or []
    except Exception as e:
        logger.error("Failed to load concept catalog: %s", e)
        return []


async def _ensure_concept(
    *,
    name_key: str,
    display_name: str,
    embedding: List[float],
    catalog: List[Dict[str, Any]],
    client=None,
    embed_fn: Optional[Callable[[str], Awaitable[List[float]]]] = None,
) -> Optional[str]:
    """Find or create a canonical concept row.  Returns its id."""
    cli = client or supabase_admin

    # Fast-path: name_key collision → reuse without touching pgvector.
    for row in catalog:
        if row.get("name_key") == name_key:
            _maybe_add_alias(cli, row, display_name)
            return row["id"]

    # Embedding-similarity dedupe.
    match = find_match(embedding, catalog)
    if match:
        _maybe_add_alias(cli, match, display_name)
        return match["id"]

    # Insert new canonical concept.
    try:
        res = cli.table("concepts").insert({
            "canonical_name": display_name,
            "name_key": name_key,
            "aliases": [display_name],
            "embedding": embedding,
        }).execute()
        rows = res.data or []
        if not rows:
            logger.warning("Concept insert returned no row for %s", name_key)
            return None
        new_row = {
            "id": rows[0]["id"],
            "canonical_name": display_name,
            "name_key": name_key,
            "aliases": [display_name],
            "embedding": embedding,
        }
        catalog.append(new_row)
        return new_row["id"]
    except Exception as e:
        logger.error("Failed to insert concept %s: %s", name_key, e)
        return None


def _maybe_add_alias(client, concept_row: Dict[str, Any], alias: str) -> None:
    """Append ``alias`` to a concept's aliases array if not already present."""
    aliases = list(concept_row.get("aliases") or [])
    alias_norm = (alias or "").strip()
    if not alias_norm:
        return
    if alias_norm in aliases:
        return
    if len(aliases) >= MAX_ALIASES:
        return
    aliases.append(alias_norm)
    concept_row["aliases"] = aliases
    try:
        client.table("concepts").update(
            {"aliases": aliases, "updated_at": "now()"}
        ).eq("id", concept_row["id"]).execute()
    except Exception as e:
        logger.warning("Failed to extend aliases for %s: %s", concept_row.get("id"), e)


async def _upsert_concept_lecture(
    *,
    concept_id: str,
    lecture_id: str,
    slide_indices: List[int],
    weight: float,
    client=None,
) -> bool:
    cli = client or supabase_admin
    try:
        cli.table("concept_lectures").upsert({
            "concept_id": concept_id,
            "lecture_id": lecture_id,
            "slide_indices": slide_indices,
            "weight": weight,
        }, on_conflict="concept_id,lecture_id").execute()
        return True
    except Exception as e:
        logger.error(
            "Failed to upsert concept_lectures (%s, %s): %s",
            concept_id, lecture_id, e,
        )
        return False


# ─── Public ingestion entrypoint ────────────────────────────────────────────

async def ingest_lecture_concepts(
    lecture_id: str,
    *,
    blueprint: Optional[Dict[str, Any]] = None,
    questions: Optional[List[Dict[str, Any]]] = None,
    slide_id_to_index: Optional[Dict[str, int]] = None,
    client=None,
    embed_fn: Optional[Callable[[str], Awaitable[List[float]]]] = None,
) -> Dict[str, Any]:
    """Run the per-lecture concept-graph ingestion job.

    All inputs are optional — the function will fetch them from Supabase if
    not provided so callers from the publish pipeline (which has them in
    hand) and the backfill script (which doesn't) can both use one entry
    point.

    Returns a small report dict for logging and tests.
    """
    cli = client or supabase_admin
    embed = embed_fn or generate_embeddings

    if blueprint is None or questions is None or slide_id_to_index is None:
        ctx = await _load_lecture_context(lecture_id, client=cli)
        if blueprint is None:
            blueprint = ctx["blueprint"]
        if questions is None:
            questions = ctx["questions"]
        if slide_id_to_index is None:
            slide_id_to_index = ctx["slide_id_to_index"]

    tags = collect_concept_tags(blueprint, questions or [], slide_id_to_index or {})
    if not tags:
        return {"lecture_id": lecture_id, "concepts": 0, "linked": 0, "created": 0}

    catalog = _load_catalog(cli)
    pre_count = len(catalog)
    linked = 0

    for name_key, (display_name, slide_indices) in tags.items():
        try:
            embedding = await embed(display_name)
        except Exception as e:
            logger.warning("Embedding failed for concept %s: %s", name_key, e)
            continue
        if not embedding or all(v == 0.0 for v in embedding):
            # Embedding service degraded — fall back to the name_key path
            # only.  We can still link if a name_key collision exists.
            embedding = []
        cid = await _ensure_concept(
            name_key=name_key,
            display_name=display_name,
            embedding=embedding,
            catalog=catalog,
            client=cli,
        )
        if not cid:
            continue
        weight = 1.0 + 0.5 * len(slide_indices)
        ok = await _upsert_concept_lecture(
            concept_id=cid,
            lecture_id=lecture_id,
            slide_indices=slide_indices,
            weight=weight,
            client=cli,
        )
        if ok:
            linked += 1

    created = max(0, len(catalog) - pre_count)
    logger.info(
        "Concept graph: lecture=%s tags=%d linked=%d created=%d",
        lecture_id, len(tags), linked, created,
    )
    return {
        "lecture_id": lecture_id,
        "concepts": len(tags),
        "linked": linked,
        "created": created,
    }


async def _load_lecture_context(lecture_id: str, *, client=None) -> Dict[str, Any]:
    """Fetch blueprint + questions + slide-index map needed for ingestion."""
    cli = client or supabase_admin
    blueprint: Optional[Dict[str, Any]] = None
    questions: List[Dict[str, Any]] = []
    slide_id_to_index: Dict[str, int] = {}

    try:
        lec = cli.table("lectures").select("pdf_hash").eq("id", lecture_id).execute()
        rows = lec.data or []
        pdf_hash = rows[0].get("pdf_hash") if rows else None
        if pdf_hash:
            bp = cli.table("lecture_blueprints").select("blueprint_json").eq(
                "pdf_hash", pdf_hash
            ).execute()
            bp_rows = bp.data or []
            if bp_rows:
                blueprint = bp_rows[0].get("blueprint_json")
    except Exception as e:
        logger.warning("Could not load blueprint for lecture %s: %s", lecture_id, e)

    try:
        slides_res = cli.table("slides").select(
            "id, slide_number"
        ).eq("lecture_id", lecture_id).execute()
        for s in slides_res.data or []:
            sn = s.get("slide_number")
            if sn is None:
                continue
            slide_id_to_index[s["id"]] = int(sn) - 1
    except Exception as e:
        logger.warning("Could not load slides for lecture %s: %s", lecture_id, e)

    if slide_id_to_index:
        try:
            qres = cli.table("quiz_questions").select(
                "id, slide_id, metadata"
            ).in_("slide_id", list(slide_id_to_index.keys())).execute()
            questions = qres.data or []
        except Exception as e:
            logger.warning("Could not load questions for lecture %s: %s", lecture_id, e)

    return {
        "blueprint": blueprint,
        "questions": questions,
        "slide_id_to_index": slide_id_to_index,
    }


# ─── Mastery + related-lectures queries ─────────────────────────────────────

def _mastery_score(correct: int, attempts: int) -> float:
    """Laplace-smoothed mastery in [0, 1]."""
    if attempts <= 0:
        return 0.0
    return (correct + 1.0) / (attempts + 2.0)


async def compute_student_mastery(
    user_id: str,
    *,
    client=None,
) -> Dict[str, Any]:
    """Aggregate quiz_attempt events into per-concept mastery for one user.

    Resolves each attempt's question → concept via quiz_questions.metadata.concept
    → matching `concepts.aliases` (or canonical_name).  Returns the full vector
    plus convenience lists of top mastered + top weak concepts so the dashboard
    card can render with one round-trip.
    """
    cli = client or supabase_admin

    # 1. All quiz_attempt + quiz_retry_attempt events for this user.
    try:
        ev = cli.table("learning_events").select("event_type, event_data").eq(
            "user_id", user_id
        ).in_("event_type", ["quiz_attempt", "quiz_retry_attempt"]).execute()
        events = ev.data or []
    except Exception as e:
        logger.error("Failed to load learning_events for %s: %s", user_id, e)
        return {"vector": [], "mastered": [], "weak": []}

    if not events:
        return {"vector": [], "mastered": [], "weak": []}

    # 2. Resolve question_id → concept text.
    qids = sorted({
        ed.get("event_data", {}).get("questionId")
        for ed in events
        if isinstance(ed.get("event_data"), dict)
        and ed.get("event_data", {}).get("questionId")
    })
    if not qids:
        return {"vector": [], "mastered": [], "weak": []}

    try:
        qres = cli.table("quiz_questions").select(
            "id, metadata, slide_id"
        ).in_("id", qids).execute()
        question_rows = qres.data or []
    except Exception as e:
        logger.error("Failed to load quiz_questions for mastery: %s", e)
        return {"vector": [], "mastered": [], "weak": []}

    qid_to_concept_norm: Dict[str, str] = {}
    for q in question_rows:
        meta = q.get("metadata") or {}
        if not isinstance(meta, dict):
            continue
        c = meta.get("concept")
        key = _normalize(c) if c else ""
        if key:
            qid_to_concept_norm[q["id"]] = key

    if not qid_to_concept_norm:
        return {"vector": [], "mastered": [], "weak": []}

    # 3. Resolve concept text → canonical concept row via name_key + aliases.
    try:
        cres = cli.table("concepts").select(
            "id, canonical_name, name_key, aliases"
        ).execute()
        concept_rows = cres.data or []
    except Exception as e:
        logger.error("Failed to load concepts catalog: %s", e)
        return {"vector": [], "mastered": [], "weak": []}

    norm_to_concept: Dict[str, Dict[str, Any]] = {}
    for cr in concept_rows:
        nk = cr.get("name_key")
        if nk:
            norm_to_concept[nk] = cr
        for al in cr.get("aliases") or []:
            ak = _normalize(al)
            if ak and ak not in norm_to_concept:
                norm_to_concept[ak] = cr

    # 4. Aggregate.
    bucket: Dict[str, Dict[str, Any]] = {}
    for ev_row in events:
        ed = ev_row.get("event_data") or {}
        if not isinstance(ed, dict):
            continue
        qid = ed.get("questionId")
        if not qid:
            continue
        concept_key = qid_to_concept_norm.get(qid)
        if not concept_key:
            continue
        cr = norm_to_concept.get(concept_key)
        if not cr:
            continue
        cid = cr["id"]
        b = bucket.setdefault(cid, {
            "concept_id": cid,
            "name": cr.get("canonical_name") or concept_key,
            "attempts": 0,
            "correct": 0,
        })
        b["attempts"] += 1
        if ed.get("correct"):
            b["correct"] += 1

    vector: List[Dict[str, Any]] = []
    for b in bucket.values():
        b["mastery_score"] = round(_mastery_score(b["correct"], b["attempts"]), 4)
        vector.append(b)

    # Stable, deterministic order.
    vector.sort(key=lambda r: (-r["mastery_score"], -r["attempts"], r["name"].lower()))
    mastered = [v for v in vector if v["attempts"] >= 2 and v["mastery_score"] >= 0.7][:5]
    weak = sorted(
        [v for v in vector if v["attempts"] >= 1],
        key=lambda r: (r["mastery_score"], -r["attempts"], r["name"].lower()),
    )[:5]

    return {"vector": vector, "mastered": mastered, "weak": weak}


async def related_lectures_for_concept(
    concept_id: str,
    *,
    exclude_lecture_id: Optional[str] = None,
    limit: int = 10,
    client=None,
) -> List[Dict[str, Any]]:
    """Return lectures that touch ``concept_id`` ranked by overlap weight."""
    cli = client or supabase_admin
    try:
        cl = cli.table("concept_lectures").select(
            "lecture_id, slide_indices, weight"
        ).eq("concept_id", concept_id).execute()
        links = cl.data or []
    except Exception as e:
        logger.error("Failed to load concept_lectures for %s: %s", concept_id, e)
        return []

    if not links:
        return []

    if exclude_lecture_id:
        links = [l for l in links if l.get("lecture_id") != exclude_lecture_id]

    lecture_ids = list({l["lecture_id"] for l in links if l.get("lecture_id")})
    if not lecture_ids:
        return []

    try:
        lres = cli.table("lectures").select(
            "id, title, description, total_slides"
        ).in_("id", lecture_ids).execute()
        lec_rows = {r["id"]: r for r in (lres.data or [])}
    except Exception as e:
        logger.error("Failed to load lectures for related-lectures: %s", e)
        return []

    out: List[Dict[str, Any]] = []
    for link in links:
        lec = lec_rows.get(link["lecture_id"])
        if not lec:
            continue
        out.append({
            "lecture_id": lec["id"],
            "title": lec.get("title"),
            "description": lec.get("description"),
            "total_slides": lec.get("total_slides"),
            "slide_indices": link.get("slide_indices") or [],
            "weight": float(link.get("weight") or 0.0),
        })

    out.sort(key=lambda r: (-r["weight"], -len(r["slide_indices"])))
    return out[:limit]
