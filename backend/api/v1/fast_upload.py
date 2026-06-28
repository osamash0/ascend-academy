import logging
import json
import asyncio
import uuid
from typing import Any, List, Dict, Optional

from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Request
from backend.core.config import settings
from backend.core.database import supabase_admin, get_client, get_db_connection, db_transaction, handle_db_errors
from backend.core.auth_middleware import verify_token, require_professor
from backend.services.cache import compute_pdf_hash
from backend.services.ai_service import generate_deck_summary, generate_deck_quiz

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/fast-upload", tags=["fast-upload"])

MAX_FILE_MB = 50


# Strong references to in-flight background tasks.  asyncio.create_task only
# keeps a weak reference to the task, so without holding one here a long-running
# upload task can be garbage-collected and silently cancelled mid-flight.
_BACKGROUND_TASKS: "set[asyncio.Task]" = set()


def _on_background_task_done(task: "asyncio.Task") -> None:
    """Drop the task reference and surface any exception that escaped the
    handler inside process_upload_isolated (otherwise asyncio swallows it)."""
    _BACKGROUND_TASKS.discard(task)
    if task.cancelled():
        logger.warning("Background upload task was cancelled before completion.")
        return
    exc = task.exception()
    if exc is not None:
        logger.error("Background upload task crashed: %s", exc, exc_info=exc)

# --- Helper logic similar to pipeline.ts ---

async def execute_query(query: str, *args):
    async with handle_db_errors():
        async with await get_db_connection() as conn:
            return await conn.fetch(query, *args)

async def analyze_slide_fast(page_num: int, raw_text: str, lecture_context: str) -> dict:
    from litellm import acompletion
    
    prompt = f"""You are an expert at analyzing university lecture slides. Given raw text extracted from a PDF slide, analyze it and return a JSON object.
    
Return ONLY valid JSON, no markdown, no code blocks. Keys:
- title: string (short descriptive title for this slide, max 60 chars)
- slideType: one of "text", "image-only", "math-diagram", "graph", "mixed", "title-slide", "table-of-contents"  
- aiInsight: string (2-3 sentence insight about what this slide teaches, connecting it to the broader topic)
- contextNote: string (1 sentence about where this slide fits in the lecture narrative)

Lecture context: {lecture_context[:500]}

Slide {page_num} raw text:
{raw_text[:1500]}
"""
    try:
        resp = await acompletion(
            model=settings.fast_upload_model,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            max_tokens=800,
        )
        content = resp.choices[0].message.content
        return json.loads(content)
    except Exception as e:
        logger.error(f"Slide {page_num} analysis failed: {e}")
        return {
            "title": f"Slide {page_num}",
            "slideType": "text",
            "aiInsight": "",
            "contextNote": ""
        }

async def analyze_lecture_meta_fast(pages: List[dict]) -> dict:
    from litellm import acompletion
    combined = "\n\n".join([f"[Slide {p['page_num']}]: {p['text'][:400]}" for p in pages[:15]])
    
    prompt = f"""You are an expert at understanding university lecture slides. Analyze the provided slide texts and return a JSON object.

Return ONLY valid JSON, no markdown. Keys:
- title: string (the lecture title)
- lectureType: one of "introduction", "exam-prep", "theory", "lab", "review", "case-study", "overview", "workshop"
- subject: string (academic subject, e.g. "Computer Science", "Mathematics", "Biology")
- courseCode: string (course code if visible, else "")
- summary: string (3-4 sentence summary of what this entire lecture covers)
- keyTopics: array of strings (5-8 key topics/concepts covered)

Analyze these lecture slides:
{combined}
"""
    try:
        resp = await acompletion(
            model=settings.fast_upload_model,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            max_tokens=1000,
        )
        content = resp.choices[0].message.content
        return json.loads(content)
    except Exception as e:
        logger.error(f"Lecture meta analysis failed: {e}")
        return {
            "title": "Untitled Lecture",
            "lectureType": "theory",
            "subject": "",
            "courseCode": "",
            "summary": "",
            "keyTopics": []
        }

async def generate_quiz_questions_fast(slides: List[dict], lecture_title: str) -> List[dict]:
    from litellm import acompletion
    content_slides = [s for s in slides if len(s.get('rawText', '')) > 50][:10]
    if not content_slides:
        return []
    
    slide_summary = "\n\n".join([f"[Slide {s['slideNumber']} id:{s['dbId']}]: {s['rawText'][:500]}" for s in content_slides])
    
    prompt = f"""Generate quiz questions for a university lecture. Return ONLY a valid JSON array of question objects, no markdown.

Each object has:
- question: string
- options: array of 4 strings (A, B, C, D options — do NOT include "A)", "B)" prefixes, just the text)
- correctAnswer: string (must match one of the options exactly)
- explanation: string (brief explanation of why the answer is correct)
- difficulty: "easy" | "medium" | "hard"
- slideId: string (the slide id from the context)

Lecture: "{lecture_title}"

Slides:
{slide_summary}

Generate 5-8 diverse, well-formed multiple choice questions covering key concepts. Mix difficulties."""
    try:
        resp = await acompletion(
            model=settings.fast_upload_model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=2000,
        )
        content = resp.choices[0].message.content
        if content.startswith("```json"):
            content = content.split("```json")[1].split("```")[0].strip()
        parsed = json.loads(content)
        return parsed if isinstance(parsed, list) else []
    except Exception as e:
        logger.error(f"Quiz generation failed: {e}")
        return []

async def process_upload_isolated(run_id: str, pdf_hash: str, filename: str, content: bytes, user_id: str):
    try:
        logger.info(f"Starting isolated pipeline for run_id: {run_id}")
        
        # Upload PDF to storage
        path = f"{pdf_hash}.pdf"
        sb = get_client(use_admin=True)
        try:
            sb.storage.from_("pdf-uploads").upload(path, content, file_options={"content-type": "application/pdf", "upsert": "true"})
        except Exception:
            pass # ignore bucket creation issues for now

        # Extract using pymupdf
        import fitz
        raw_slides = []
        with fitz.open(stream=content, filetype="pdf") as doc:
            for i, page in enumerate(doc):
                raw_slides.append({"page_num": i + 1, "text": page.get_text().strip()})
        
        if not raw_slides:
            raw_slides = [{"page_num": 1, "text": "Empty PDF"}]

        # Analyze lecture meta
        lecture_meta = await analyze_lecture_meta_fast(raw_slides)
        
        # Pre-generate IDs
        lecture_id_obj = uuid.uuid4()
        lecture_id = str(lecture_id_obj)
        lecture_context = f"{lecture_meta.get('title', '')}: {lecture_meta.get('summary', '')}"

        # Analyze Slides in parallel
        tasks = [analyze_slide_fast(s["page_num"], s["text"], lecture_context) for s in raw_slides]
        analyses = await asyncio.gather(*tasks)

        # Build inserted_slides list with generated slide UUIDs
        inserted_slides = []
        for i, slide in enumerate(raw_slides):
            analysis = analyses[i]
            slide_id_obj = uuid.uuid4()
            slide_id = str(slide_id_obj)
            inserted_slides.append({
                "dbId": slide_id,
                "dbIdObj": slide_id_obj,
                "slideNumber": slide["page_num"],
                "rawText": slide["text"],
                "title": analysis.get("title", f"Slide {slide['page_num']}"),
                "summary": analysis.get("aiInsight", ""),
                "slideType": analysis.get("slideType"),
                "contextNote": analysis.get("contextNote")
            })

        # Generate Quiz
        quizzes = await generate_quiz_questions_fast(inserted_slides, lecture_meta.get("title", ""))

        # Perform atomic database writes in a single transaction
        async with db_transaction() as conn:
            # 1. Insert Lecture Record
            await conn.execute(
                "INSERT INTO lectures (id, title, description, professor_id, total_slides, pdf_url, pdf_hash, lecture_type, subject, course_code, key_topics) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
                lecture_id_obj,
                lecture_meta.get("title", filename),
                lecture_meta.get("summary", ""),
                uuid.UUID(user_id) if isinstance(user_id, str) else user_id,
                len(raw_slides),
                path,
                pdf_hash,
                lecture_meta.get("lectureType"),
                lecture_meta.get("subject"),
                lecture_meta.get("courseCode"),
                json.dumps(lecture_meta.get("keyTopics", []))
            )

            # 2. Insert Slides
            for s in inserted_slides:
                await conn.execute(
                    "INSERT INTO slides (id, lecture_id, slide_number, title, content_text, summary, slide_type, context_note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
                    s["dbIdObj"],
                    lecture_id_obj,
                    s["slideNumber"],
                    s["title"],
                    s["rawText"],
                    s["summary"],
                    s["slideType"],
                    s["contextNote"]
                )

            # 3. Insert Quiz Questions
            from backend.services.ai.quiz_validator import _normalize_answer_index
            for q in quizzes:
                options = q.get("options", [])
                correct_idx = _normalize_answer_index(q)
                if correct_idx is None:
                    logger.warning(
                        "fast_upload quiz: dropping question with unresolvable correctAnswer=%r",
                        q.get("correctAnswer"),
                    )
                    continue

                target_slide_obj = inserted_slides[0]["dbIdObj"]
                if q.get("slideId"):
                    for s in inserted_slides:
                        if s["dbId"] == q.get("slideId"):
                            target_slide_obj = s["dbIdObj"]
                            break

                await conn.execute(
                    "INSERT INTO quiz_questions (slide_id, question_text, options, correct_answer, metadata) VALUES ($1, $2, $3, $4, $5::jsonb)",
                    target_slide_obj,
                    q.get("question", ""),
                    options,
                    correct_idx,
                    json.dumps({
                        "explanation": q.get("explanation", ""),
                        "difficulty": q.get("difficulty", "medium")
                    })
                )

            # 4. Update parse run status
            await conn.execute(
                "UPDATE parse_runs SET status = 'completed', lecture_id = $1, finished_at = now() WHERE run_id = $2",
                lecture_id_obj,
                uuid.UUID(run_id)
            )

        logger.info(f"Isolated pipeline complete for run_id: {run_id}")
    except Exception as e:
        logger.error(f"Isolated pipeline failed for run_id: {run_id}: {e}")
        await execute_query(
            "UPDATE parse_runs SET status = 'error', error = $1, finished_at = now() WHERE run_id = $2",
            str(e),
            uuid.UUID(run_id)
        )


@router.post("/")
async def upload_fast_endpoint(
    request: Request,
    file: UploadFile = File(...),
    user: Any = Depends(require_professor),
):
    content = await file.read()
    if len(content) > MAX_FILE_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File exceeds {MAX_FILE_MB}MB.")
    
    pdf_hash = compute_pdf_hash(content)
    run_id_obj = uuid.uuid4()
    run_id = str(run_id_obj)
    user_id = user.id if hasattr(user, "id") else (user.get("id") if isinstance(user, dict) else None)
    # Validate the authenticated user id is a well-formed UUID before spawning
    # the background task — otherwise a malformed id would only surface much
    # later as a failed run row instead of an immediate, actionable error.
    try:
        uuid.UUID(str(user_id))
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid user identity.")

    # Insert pending state in parse_runs
    await execute_query(
        "INSERT INTO parse_runs (run_id, pdf_hash, pipeline_version, status, user_id) VALUES ($1, $2, $3, $4, $5)",
        run_id_obj,
        pdf_hash,
        "isolated_v1",
        "processing",
        uuid.UUID(str(user_id))
    )

    # Process async.  Retain a strong reference (see _BACKGROUND_TASKS) and
    # attach a done-callback so a crash that escapes the handler is logged
    # rather than silently swallowed by asyncio.
    task = asyncio.create_task(
        process_upload_isolated(run_id, pdf_hash, file.filename or "upload.pdf", content, user_id)
    )
    _BACKGROUND_TASKS.add(task)
    task.add_done_callback(_on_background_task_done)

    return {"id": run_id, "status": "processing"}

@router.get("/status/{run_id}")
async def get_upload_status(run_id: str, user: Any = Depends(require_professor)):
    try:
        run_uuid = uuid.UUID(run_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid run id.")
    res = await execute_query("SELECT run_id, status, lecture_id, error FROM parse_runs WHERE run_id = $1 AND user_id = $2", run_uuid, uuid.UUID(str(user.id if hasattr(user, "id") else (user.get("id") if isinstance(user, dict) else None))))
    if not res:
        raise HTTPException(status_code=404, detail="Run not found")
    
    row = res[0]
    return {
        "id": str(row["run_id"]),
        "status": row["status"],
        "lectureId": str(row["lecture_id"]) if row["lecture_id"] else None,
        "errorMessage": "Internal processing error" if row["error"] else None
    }
