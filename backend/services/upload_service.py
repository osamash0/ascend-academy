import logging
import json
import asyncio
from typing import Any, Dict, Optional, AsyncGenerator
from fastapi import UploadFile

from backend.services.file_parse_service import import_pdf_lazy
from backend.core.database import get_client  # ADMIN: required for background storage operations
from backend.core.file_validation import validate_pdf_content, sanitize_filename

logger = logging.getLogger(__name__)

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

async def _validate_pptx(content: bytes) -> int:
    """Validate a PowerPoint upload and return its slide count.

    .pptx is an OOXML (ZIP) container — magic bytes "PK\\x03\\x04".
    """
    from backend.core.file_validation import MAX_FILE_BYTES
    if len(content) > MAX_FILE_BYTES:
        raise ValueError(f"File exceeds the {MAX_FILE_BYTES // (1024 * 1024)}MB limit.")
    if len(content) < 4 or content[:4] != b"PK\x03\x04":
        raise ValueError("Invalid PowerPoint file.")

    def _count_slides() -> int:
        try:
            import io
            from pptx import Presentation
            return len(Presentation(io.BytesIO(content)).slides)
        except Exception:
            return -1

    slides = await asyncio.wait_for(asyncio.to_thread(_count_slides), timeout=30.0)
    if slides == -1:
        raise ValueError("File appears to be corrupted or is not a valid .pptx.")
    if slides == 0:
        raise ValueError("Presentation has no slides.")
    if slides > MAX_PAGES:
        raise ValueError(f"Maximum {MAX_PAGES} slides supported. This file has {slides}.")
    return slides


async def validate_upload(filename: Optional[str], content: bytes) -> int:
    """
    Validates the uploaded file (PDF or .pptx).
    Returns the page/slide count if valid, otherwise raises ValueError.
    """
    safe_filename = sanitize_filename(filename)
    lower = safe_filename.lower()

    # PowerPoint decks are imported via markitdown (text) + LibreOffice→PDF
    # (rendering); validate the OOXML container and count slides here.
    if lower.endswith(".pptx"):
        return await _validate_pptx(content)

    if not lower.endswith(".pdf"):
        raise ValueError("Only PDF and PowerPoint (.pptx) files are supported.")

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

async def process_pdf_stream(
    content: bytes,
    filename: str,
    pdf_hash: str,
    page_count: int,
    ai_model: str,
    use_blueprint: bool,
    parsing_mode: str,
    parser: str,
    lecture_id: Optional[str],
    user_id: Optional[str] = None,
    force_reparse: bool = False,
) -> AsyncGenerator[str, None]:
    odl_pages = None
    odl_succeeded = False
    parser_used = "pymupdf"

    # PowerPoint uploads are handled only by the markitdown path (clean
    # per-slide text + LibreOffice render), whatever parser was requested.
    if (filename or "").lower().endswith(".pptx"):
        parser = "markitdown"

    if parser == "markitdown":
        from backend.services import markitdown_service, office_convert
        # Per-slide text from the original deck (the orchestrator's text layer)…
        odl_pages = await markitdown_service.extract_pages(content, filename)
        # …and a rendered PDF so the downstream PDF-centric logic (fitz pages,
        # vision OCR, storage) keeps working unchanged.
        content = await office_convert.to_pdf(content, filename)
        odl_succeeded = True
        parser_used = "markitdown"
    elif parser == "llamaparse":
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

    if str(_cfg.parser_version) != "5":
        logger.warning(
            "PARSER_VERSION=%s is retired; running the unified (v5) pipeline instead.",
            _cfg.parser_version,
        )

    # ── Unified pipeline (the only parse path) ─────────────────────────────────
    # Server-authoritative: parse_pdf_unified creates the lecture + persists
    # slides/quizzes itself and emits the lecture_id on the `meta` event.
    import uuid
    run_id = str(uuid.uuid4())
    await upload_pdf_to_storage(pdf_hash, content)
    unified_parser_label = parser_used if odl_succeeded else "unified"
    # The unified pipeline's text LLM is server-configured by default
    # (e.g. OpenAI), but explicitly selected models in the UI take precedence.
    # Falls back to PARSER_LLM_MODEL if 'auto' or not provided.
    if ai_model and ai_model.lower() != "auto":
        unified_ai_model = ai_model
    else:
        unified_ai_model = _cfg.parser_llm_model or "cerebras"

    use_arq = True
    try:
        pool = await get_arq_pool()
        await pool.enqueue_job(
            "parse_pdf_unified",
            pdf_hash=pdf_hash,
            lecture_id="",          # unified creates + owns the lecture
            run_id=run_id,
            ai_model=unified_ai_model,
            user_id=str(user_id),
            filename=filename,
            odl_pages=odl_pages,
            parser_used=unified_parser_label,
            force_reparse=force_reparse,
            parsing_mode=parsing_mode,
        )
    except Exception as e:
        logger.warning("Redis connection failed, running unified synchronously: %s", e)
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

        from backend.services.parser.unified_orchestrator import parse_pdf_unified

        task = asyncio.create_task(parse_pdf_unified(
            ctx={},
            pdf_hash=pdf_hash,
            lecture_id="",
            run_id=run_id,
            ai_model=unified_ai_model,
            user_id=str(user_id),
            filename=filename,
            emit_fn=emit_fn,
            odl_pages=odl_pages,
            parser_used=unified_parser_label,
            force_reparse=force_reparse,
            parsing_mode=parsing_mode,
        ))

        while True:
            try:
                event = await asyncio.wait_for(q.get(), timeout=1.0)
                yield f"data: {json.dumps(event)}\n\n"
                if event.get("type") in ("complete", "error"):
                    break
            except asyncio.TimeoutError:
                if task.done():
                    if task.exception():
                        logger.error("Sync unified parser failed: %s", task.exception())
                        yield f"data: {json.dumps({'type': 'error', 'message': str(task.exception())})}\n\n"
                    break
                continue
        return

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
