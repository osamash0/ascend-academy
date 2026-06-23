import logging
import json
import asyncio
from typing import Any, List, Dict, Optional, AsyncGenerator
from uuid import UUID
from fastapi import UploadFile

from backend.services.file_parse_service import parse_pdf_stream, import_pdf_lazy, _safe_embedding_task
from backend.services.slide_synth_service import synthesize_slide
from backend.core.database import get_client, supabase_admin  # ADMIN: required for background storage operations
from backend.services.cache import (
    compute_pdf_hash,
    get_cached_parse,
    store_cached_parse,
)
from backend.core.file_validation import validate_pdf_content, sanitize_filename

logger = logging.getLogger(__name__)

MAX_FILE_MB = 25
MAX_PAGES = 300

_arq_pool = None

async def get_arq_pool():
    global _arq_pool
    if _arq_pool is None:
        from arq.connections import create_pool, RedisSettings
        from backend.core.config import settings
        _arq_pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    return _arq_pool

async def upload_pdf_to_storage(pdf_hash: str, content: bytes) -> None:
    """Upload PDF bytes to Supabase Storage keyed by sha256 (idempotent)."""
    path = f"{pdf_hash}.pdf"
    try:
        sb = get_client(use_admin=True)
        sb.storage.from_("pdf-uploads").upload(
            path,
            content,
            file_options={"content-type": "application/pdf", "upsert": "true"},
        )
    except Exception as e:
        if "Bucket not found" in str(e):
            try:
                sb = get_client(use_admin=True)
                sb.storage.create_bucket("pdf-uploads", options={"public": False})
                sb.storage.from_("pdf-uploads").upload(
                    path,
                    content,
                    file_options={"content-type": "application/pdf", "upsert": "true"},
                )
                return
            except Exception as create_e:
                logger.warning("Failed to create pdf-uploads bucket: %s", create_e)
        logger.warning("PDF storage upload failed for %s: %s — worker will retry", pdf_hash, e)

async def validate_upload(filename: Optional[str], content: bytes) -> int:
    """
    Validates the uploaded PDF file.
    Returns the page count if valid, otherwise raises ValueError.
    """
    safe_filename = sanitize_filename(filename)
    if not safe_filename.lower().endswith(".pdf"):
        raise ValueError("Only PDF files are supported.")

    # Validate size and magic bytes
    validate_pdf_content(content)

    def _get_info():
        try:
            import fitz
            with fitz.open(stream=content, filetype="pdf") as doc:
                return len(doc)
        except Exception:
            return -1

    page_count = await asyncio.wait_for(asyncio.to_thread(_get_info), timeout=30.0)
    
    if page_count == -1:
        raise ValueError("File appears to be corrupted or password-protected.")
    if page_count == 0:
        raise ValueError("PDF has no pages.")
    if page_count > MAX_PAGES:
        raise ValueError(f"Maximum {MAX_PAGES} pages supported. This file has {page_count}.")
        
    return page_count

async def _v3_sse_stream(pdf_hash: str, run_id: str) -> AsyncGenerator[str, None]:
    import redis.asyncio as aioredis
    from backend.core.config import settings
    from backend.services.parser import repos
    from backend.domain.parse_models import RunStatus

    redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
    channel = f"parse:{pdf_hash}"

    try:
        async with redis_client.pubsub() as pubsub:
            await pubsub.subscribe(channel)

            try:
                run = await repos.get_run_by_id(UUID(run_id))
                if run:
                    completed = await repos.get_completed_pages(run.run_id)
                    for slide in completed:
                        yield f"data: {json.dumps({'type': 'slide_ready', 'data': slide.model_dump()})}\n\n"
                    if run.status == RunStatus.COMPLETED:
                        yield f"data: {json.dumps({'type': 'complete', 'data': {'run_id': run_id}})}\n\n"
                        return
            except Exception as e:
                logger.warning("v3 SSE replay failed: %s", e)

            async for message in pubsub.listen():
                if message.get("type") != "message":
                    continue
                try:
                    event = json.loads(message["data"])
                    yield f"data: {json.dumps(event)}\n\n"
                    if event.get("type") in ("complete", "error", "deck_complete"):
                        if event.get("type") in ("complete", "error"):
                            break
                except Exception:
                    continue
    finally:
        await redis_client.aclose()

async def process_pdf_stream(
    content: bytes,
    filename: str,
    pdf_hash: str,
    page_count: int,
    ai_model: str,
    use_blueprint: bool,
    parsing_mode: str,
    parser: str,
    lecture_id: Optional[str]
) -> AsyncGenerator[str, None]:
    collected_slides: List[Dict[str, Any]] = []
    collected_deck: Dict[str, Any] = {}
    odl_pages = None
    odl_succeeded = False
    parser_used = "pymupdf"

    if parser == "llamaparse":
        from backend.services import llamaparse_service
        odl_pages = await llamaparse_service.extract_pages(content, filename)
        odl_succeeded = True
        parser_used = "llamaparse"
    elif parser == "mineru":
        from backend.services import mineru_service
        odl_pages = await mineru_service.extract_pages(content, filename)
        odl_succeeded = True
        parser_used = "mineru"
    elif parser == "opendataloader":
        from backend.services.odl_service import extract_pages as _odl
        odl_pages = await _odl(content, filename)
        odl_succeeded = True
        parser_used = "opendataloader-pdf"

    from backend.core.config import settings as _cfg
    if parser in ("v4", "llamaparse", "mineru", "opendataloader") or (parser == "auto" and str(_cfg.parser_version) == "4"):
        import uuid
        run_id = str(uuid.uuid4())
        await upload_pdf_to_storage(pdf_hash, content)
        
        lecture_uuid = UUID(lecture_id) if lecture_id else None
        use_arq = True
        try:
            pool = await get_arq_pool()
            await pool.enqueue_job(
                "parse_pdf_v4",
                pdf_hash=pdf_hash,
                lecture_id=str(lecture_uuid) if lecture_uuid else "",
                run_id=run_id,
                ai_model=ai_model,
                odl_pages=odl_pages,
                parser_used=parser_used,
            )
        except Exception as e:
            logger.warning("Redis connection failed, running v4 synchronously: %s", e)
            use_arq = False

        if use_arq:
            import redis.asyncio as aioredis
            redis_client = aioredis.from_url(_cfg.redis_url, decode_responses=True)
            channel = f"parse:{pdf_hash}"
            try:
                async with redis_client.pubsub() as pubsub:
                    await pubsub.subscribe(channel)
                    async for message in pubsub.listen():
                        if message.get("type") != "message":
                            continue
                        try:
                            event = json.loads(message["data"])
                            yield f"data: {json.dumps(event)}\n\n"
                            if event.get("type") in ("complete", "error"):
                                break
                        except Exception:
                            continue
            finally:
                await redis_client.aclose()
            return
        else:
            q = asyncio.Queue()
            async def emit_fn(event_type: str, data: dict):
                await q.put({"type": event_type, **data})
            from backend.services.parser.v4_orchestrator import parse_pdf_v4
            task = asyncio.create_task(parse_pdf_v4(
                ctx={}, pdf_hash=pdf_hash, lecture_id=str(lecture_uuid) if lecture_uuid else "",
                run_id=run_id, ai_model=ai_model, emit_fn=emit_fn,
                odl_pages=odl_pages, parser_used=parser_used,
            ))
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=1.0)
                    if event.get("type") == "slide":
                        collected_slides.append(event["slide"])
                    elif event.get("type") == "deck_complete":
                        collected_deck.update({
                            "deck_summary": event.get("deck_summary", ""),
                            "deck_quiz": event.get("deck_quiz", []),
                        })
                    yield f"data: {json.dumps(event)}\n\n"
                    if event.get("type") in ("complete", "error"):
                        if collected_slides:
                            await store_cached_parse(
                                pdf_hash,
                                {"slides": collected_slides, "deck": collected_deck, "parser": "v4"}
                            )
                        break
                except asyncio.TimeoutError:
                    if task.done():
                        if task.exception():
                            yield f"data: {json.dumps({'type': 'error', 'message': str(task.exception())})}\n\n"
                        break
                    continue
            return

    if parser == "v3" or (parser == "auto" and str(_cfg.parser_version) == "3"):
        await upload_pdf_to_storage(pdf_hash, content)
        from backend.services.parser import repos as _repos
        from backend.domain.parse_models import PIPELINE_VERSION as _PV
        lecture_uuid = UUID(lecture_id) if lecture_id else None
        run = await _repos.get_or_create_run(pdf_hash, lecture_uuid, _PV)
        pool = await get_arq_pool()
        await pool.enqueue_job(
            "parse_pdf",
            pdf_hash=pdf_hash,
            lecture_id=str(lecture_uuid) if lecture_uuid else "",
            run_id=str(run.run_id),
        )
        async for msg in _v3_sse_stream(pdf_hash, str(run.run_id)):
            yield msg
        return

    if parser == "auto":
        try:
            from backend.services.odl_service import extract_pages as _odl
            odl_pages = await _odl(content, filename)
            odl_succeeded = True
        except Exception:
            pass
        parser_used = "opendataloader-pdf" if odl_succeeded else "pymupdf"

    yield f"data: {json.dumps({'type': 'info', 'parser': parser_used})}\n\n"
    try:
        async for update in parse_pdf_stream(content, filename=filename, ai_model=ai_model, use_blueprint=use_blueprint, odl_pages=odl_pages, parsing_mode=parsing_mode):
            if update.get("type") == "slide":
                collected_slides.append(update["slide"])
            elif update.get("type") == "deck_complete":
                collected_deck = {
                    "deck_summary": update.get("deck_summary", ""),
                    "deck_quiz": update.get("deck_quiz", []),
                }
            yield f"data: {json.dumps(update)}\n\n"
    except Exception as e:
        logger.error("Streaming parse failed after %d slides: %s", len(collected_slides), e, exc_info=True)
        if collected_slides:
            yield f"data: {json.dumps({'type': 'partial_complete', 'slides_processed': len(collected_slides), 'total_expected': page_count})}\n\n"
        yield f"data: {json.dumps({'type': 'error', 'message': str(e), 'recoverable': len(collected_slides) > 0})}\n\n"
    finally:
        if collected_slides:
            await store_cached_parse(
                pdf_hash,
                {"slides": collected_slides, "deck": collected_deck, "parser": parser_used, "parsing_mode": parsing_mode},
                parsing_mode=parsing_mode,
            )

async def process_pdf_lazy(content: bytes, filename: str, ai_model: str) -> AsyncGenerator[str, None]:
    yield f"data: {json.dumps({'type': 'info', 'parser': 'pymupdf-lazy'})}\n\n"
    try:
        async for update in import_pdf_lazy(content, filename=filename, ai_model=ai_model):
            yield f"data: {json.dumps(update)}\n\n"
    except Exception as e:
        logger.error("Lazy import failed: %s", e, exc_info=True)
        yield f"data: {json.dumps({'type': 'error', 'message': str(e), 'recoverable': False})}\n\n"

async def extract_raw_pages(content: bytes, filename: str, parser: str) -> Dict[str, Any]:
    pages_raw: Dict[int, dict] = {}
    parser_used = "pymupdf"

    if parser == "llamaparse":
        from backend.services import llamaparse_service
        pages_raw = await llamaparse_service.extract_pages(content, filename)
        parser_used = "llamaparse"
    elif parser == "mineru":
        from backend.services import mineru_service
        pages_raw = await mineru_service.extract_pages(content, filename)
        parser_used = "mineru"
    elif parser == "opendataloader":
        from backend.services.odl_service import extract_pages as _odl
        pages_raw = await _odl(content, filename)
        parser_used = "opendataloader-pdf"
    elif parser == "pymupdf":
        def _pymupdf_extract() -> Dict[int, dict]:
            import fitz
            result: Dict[int, dict] = {}
            with fitz.open(stream=content, filetype="pdf") as doc:
                for i, page in enumerate(doc):
                    text = page.get_text("text") or ""
                    result[i + 1] = {"text": text, "title": None}
            return result
        pages_raw = await asyncio.wait_for(asyncio.to_thread(_pymupdf_extract), timeout=60.0)
        parser_used = "pymupdf"
    else:  # auto
        try:
            from backend.services.odl_service import extract_pages as _odl
            pages_raw = await _odl(content, filename)
            parser_used = "opendataloader-pdf"
        except Exception:
            def _pymupdf_extract_auto() -> Dict[int, dict]:
                import fitz
                result: Dict[int, dict] = {}
                with fitz.open(stream=content, filetype="pdf") as doc:
                    for i, page in enumerate(doc):
                        text = page.get_text("text") or ""
                        result[i + 1] = {"text": text, "title": None}
                return result
            pages_raw = await asyncio.wait_for(asyncio.to_thread(_pymupdf_extract_auto), timeout=60.0)
            parser_used = "pymupdf"

    pages_out = []
    for page_num in sorted(pages_raw):
        entry = pages_raw[page_num]
        text = entry.get("text") or ""
        pages_out.append({
            "page_num": page_num,
            "title": entry.get("title"),
            "text": text,
            "char_count": len(text),
            "word_count": len(text.split()),
        })

    return {
        "parser_used": parser_used,
        "total_pages": len(pages_out),
        "pages": pages_out,
    }
