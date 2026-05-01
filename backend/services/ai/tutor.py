import logging
from typing import List, Dict, Optional, Any
from .orchestrator import generate_text

logger = logging.getLogger(__name__)

async def chat_with_lecture(
    slide_text: str, 
    user_message: str, 
    chat_history: Optional[List[Dict[str, str]]] = None, 
    ai_model: str = "llama3"
) -> str:
    """
    Socratic AI Tutor interaction logic.
    Grounds the response in the provided slide content and chat history.
    """
    history_str = ""
    if chat_history:
        for msg in chat_history[-5:]: # Keep last 5 messages for context
            role = "Student" if msg.get("role") == "user" else "Tutor"
            history_str += f"{role}: {msg.get('content')}\n"

    prompt = f"""You are a Socratic AI Tutor for university students. 
Your goal is to guide the student towards understanding using the provided slide content.
Be concise, encouraging, and ask leading questions when appropriate.

[SLIDE CONTENT]
{slide_text}

[CHAT HISTORY]
{history_str}

Student: {user_message}
Tutor:"""

    try:
        # Use the async generate_text wrapper which handles timeouts and retries
        return await generate_text(prompt, ai_model)
    except Exception as e:
        logger.error("Socratic chat failed: %s", e)
        return "I'm sorry, I'm having trouble connecting right now. Please try again in a moment."
