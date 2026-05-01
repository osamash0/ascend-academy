import logging
from .orchestrator import _llm_generate_text

logger = logging.getLogger(__name__)

def chat_with_lecture(slide_text: str, user_message: str, chat_history: list = None, ai_model: str = "llama3") -> str:
    history_str = ""
    if chat_history:
        for msg in chat_history:
            role = "Student" if msg.get("role") == "user" else "Tutor"
            history_str += f"{role}: {msg.get('content')}\n"

    prompt = f"""You are a Socratic AI Tutor. Answer based on the slide:
{slide_text}
{history_str}
Student: {user_message}
Tutor:"""

    try:
        return _llm_generate_text(prompt, ai_model)
    except Exception as e:
        logger.error("Chat failed: %s", e)
        return "I'm sorry, I'm having trouble connecting right now."
