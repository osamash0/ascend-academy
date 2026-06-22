"""
Chat Session Memory service using Redis.
Provides stateful conversation tracking for the Socratic AI Tutor.
"""
import json
import logging
import uuid
from typing import Any, Dict, List, Optional
from datetime import datetime

from backend.core.redis import get_redis_client

logger = logging.getLogger(__name__)

SESSION_TTL = 30 * 24 * 60 * 60  # 30 days in seconds

def _get_meta_key(session_id: str) -> str:
    return f"chat_session:{session_id}:meta"

def _get_messages_key(session_id: str) -> str:
    return f"chat_session:{session_id}:messages"

def _get_user_sessions_key(user_id: str) -> str:
    return f"user_sessions:{user_id}"

async def create_session(user_id: str, lecture_id: Optional[str] = None, title: Optional[str] = None) -> str:
    """Create a new chat session in Redis."""
    session_id = str(uuid.uuid4())
    redis_client = get_redis_client()
    
    meta_key = _get_meta_key(session_id)
    user_sessions_key = _get_user_sessions_key(user_id)
    
    now = datetime.utcnow().isoformat()
    if not title:
        title = f"Chat - {now[:10]}"
        
    meta = {
        "id": session_id,
        "user_id": user_id,
        "lecture_id": lecture_id or "",
        "title": title,
        "created_at": now,
        "updated_at": now
    }
    
    # Store metadata
    await redis_client.hset(meta_key, mapping=meta)
    await redis_client.expire(meta_key, SESSION_TTL)
    
    # Add to user sessions set
    await redis_client.sadd(user_sessions_key, session_id)
    await redis_client.expire(user_sessions_key, SESSION_TTL)
    
    return session_id

async def get_session_metadata(session_id: str) -> Optional[Dict[str, str]]:
    """Retrieve session metadata from Redis."""
    redis_client = get_redis_client()
    meta_key = _get_meta_key(session_id)
    meta = await redis_client.hgetall(meta_key)
    if not meta:
        return None
    return meta

async def get_user_sessions(user_id: str) -> List[Dict[str, Any]]:
    """Get all active chat sessions for a user, sorted by updated_at descending."""
    redis_client = get_redis_client()
    user_sessions_key = _get_user_sessions_key(user_id)
    
    session_ids = await redis_client.smembers(user_sessions_key)
    sessions = []
    expired_ids = []
    
    for sid in session_ids:
        meta = await get_session_metadata(sid)
        if meta:
            # Convert empty lecture_id back to None for clarity
            if meta.get("lecture_id") == "":
                meta["lecture_id"] = None
            sessions.append(meta)
        else:
            # Session metadata expired, clean up index
            expired_ids.append(sid)
            
    if expired_ids:
        await redis_client.srem(user_sessions_key, *expired_ids)
        
    # Sort by updated_at descending
    sessions.sort(key=lambda s: s.get("updated_at", ""), reverse=True)
    return sessions

async def append_message(session_id: str, role: str, content: str) -> None:
    """Append a message to the session's list in Redis and update timestamps."""
    redis_client = get_redis_client()
    meta_key = _get_meta_key(session_id)
    messages_key = _get_messages_key(session_id)
    
    # Verify metadata exists to update it
    meta = await get_session_metadata(session_id)
    if not meta:
        logger.warning(f"Attempted to append message to non-existent session: {session_id}")
        return
        
    # Append message to list
    msg_data = json.dumps({"role": role, "content": content})
    await redis_client.rpush(messages_key, msg_data)
    await redis_client.expire(messages_key, SESSION_TTL)
    
    # Update updated_at metadata
    now = datetime.utcnow().isoformat()
    await redis_client.hset(meta_key, "updated_at", now)
    await redis_client.expire(meta_key, SESSION_TTL)
    
    # Refresh user sessions set TTL
    user_sessions_key = _get_user_sessions_key(meta["user_id"])
    await redis_client.expire(user_sessions_key, SESSION_TTL)

async def get_history(session_id: str, limit: int = 20) -> List[Dict[str, str]]:
    """Retrieve the last N messages of a session in chronological order."""
    redis_client = get_redis_client()
    messages_key = _get_messages_key(session_id)
    
    # Retrieve last `limit` elements
    raw_msgs = await redis_client.lrange(messages_key, -limit, -1)
    
    history = []
    for raw in raw_msgs:
        try:
            history.append(json.loads(raw))
        except Exception as e:
            logger.error(f"Failed to parse chat message JSON: {e}")
            
    return history

async def delete_session(session_id: str, user_id: str) -> bool:
    """Delete a session's metadata and messages, verifying user ownership."""
    redis_client = get_redis_client()
    meta = await get_session_metadata(session_id)
    if not meta:
        return False
        
    if meta.get("user_id") != user_id:
        # Unauthorized access
        return False
        
    meta_key = _get_meta_key(session_id)
    messages_key = _get_messages_key(session_id)
    user_sessions_key = _get_user_sessions_key(user_id)
    
    # Delete keys
    await redis_client.delete(meta_key, messages_key)
    # Remove from user set
    await redis_client.srem(user_sessions_key, session_id)
    
    return True
