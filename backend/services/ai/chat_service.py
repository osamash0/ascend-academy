import logging
from typing import Any, Dict, List, Optional
from backend.core.database import supabase_admin
from backend.services.ai_service import chat_with_lecture
from backend.services import chat_memory

logger = logging.getLogger(__name__)

async def process_chat_request(
    user_id: str,
    user_role: Optional[str],
    slide_text: str,
    user_message: str,
    chat_history: Optional[List[Dict[str, Any]]],
    ai_model: str,
    lecture_id: Optional[str] = None,
    pdf_hash: Optional[str] = None,
    current_slide_index: Optional[int] = None,
    session_id: Optional[str] = None,
) -> Dict[str, Any]:
    safe_lecture_id = None
    safe_pdf_hash = None

    if lecture_id or pdf_hash:
        try:
            q = supabase_admin.table("lectures").select("id, professor_id, pdf_hash")
            if lecture_id:
                q = q.eq("id", lecture_id)
            else:
                q = q.eq("pdf_hash", pdf_hash)
            res = q.limit(1).execute()
            rows = res.data or []
            if not rows:
                raise FileNotFoundError("Lecture not found.")
            row = rows[0]
            if user_role == "professor" and row.get("professor_id") != user_id:
                raise PermissionError("Not your lecture.")
            safe_lecture_id = row.get("id")
            safe_pdf_hash = row.get("pdf_hash")
        except (FileNotFoundError, PermissionError):
            raise
        except Exception as e:
            logger.error("Lecture authorization check failed: %s", e)
            raise ValueError("Authorization check failed.")

    history = None
    if session_id:
        meta = await chat_memory.get_session_metadata(session_id)
        if not meta:
            raise FileNotFoundError("Chat session not found.")
        if meta.get("user_id") != user_id:
            raise PermissionError("Unauthorized to access this session.")
        
        session_lecture_id = meta.get("lecture_id")
        if session_lecture_id and not safe_lecture_id:
            safe_lecture_id = session_lecture_id
            try:
                q = supabase_admin.table("lectures").select("id, professor_id, pdf_hash").eq("id", safe_lecture_id)
                res = q.limit(1).execute()
                rows = res.data or []
                if not rows:
                    raise FileNotFoundError("Lecture not found.")
                row = rows[0]
                if user_role == "professor" and row.get("professor_id") != user_id:
                    raise PermissionError("Not your lecture.")
                safe_pdf_hash = row.get("pdf_hash")
            except (FileNotFoundError, PermissionError):
                raise
            except Exception as e:
                logger.error("Session lecture authorization check failed: %s", e)
                raise ValueError("Authorization check failed.")

        history = await chat_memory.get_history(session_id, limit=20)
    else:
        history = chat_history

    try:
        result = await chat_with_lecture(
            slide_text=slide_text,
            user_message=user_message,
            chat_history=history,
            ai_model=ai_model,
            lecture_id=safe_lecture_id,
            pdf_hash=safe_pdf_hash,
            current_slide_index=current_slide_index,
        )
        reply_text = result if isinstance(result, str) else result.get("reply", "")
        
        if session_id:
            await chat_memory.append_message(session_id, "user", user_message)
            await chat_memory.append_message(session_id, "model", reply_text)

        if isinstance(result, str):
            return {"reply": result, "citations": [], "session_id": session_id}
        return {
            "reply": reply_text,
            "citations": result.get("citations", []),
            "session_id": session_id
        }
    except Exception as e:
        logger.error("AI tutor failed: %s", e)
        raise ValueError("AI tutor failed to respond.")
