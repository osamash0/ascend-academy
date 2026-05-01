import os
import logging
import json
import re
import asyncio
from typing import Any, Optional
from pathlib import Path
from pydantic import BaseModel
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# Load environment
_root_env = Path(__file__).resolve().parent.parent.parent.parent / ".env"
_backend_env = Path(__file__).resolve().parent.parent.parent / ".env"
if _root_env.exists(): load_dotenv(dotenv_path=_root_env, override=True)
if _backend_env.exists(): load_dotenv(dotenv_path=_backend_env, override=True)

OLLAMA_MODEL = "llama3"
GEMINI_MODEL = "gemini-1.5-flash"
GROQ_MODEL = "llama-3.1-8b-instant"
GROQ_VISION_MODEL = "llama-3.2-11b-vision-preview"
CEREBRAS_MODEL = "llama-3.3-70b"
_VISION_SLIDE_TYPES_METADATA = {"title_slide", "meta_slide"}

# Clients
try:
    import ollama
except ImportError:
    ollama = None

try:
    from groq import Groq
    _key = os.environ.get("GROQ_API_KEY")
    groq_client = Groq(api_key=_key, max_retries=0) if (_key and _key != "your_groq_api_key_here") else None
except Exception:
    groq_client = None

try:
    from openai import OpenAI
    _c_key = os.environ.get("CEREBRAS_API_KEY")
    cerebras_client = OpenAI(base_url="https://api.cerebras.ai/v1", api_key=_c_key) if _c_key else None
except Exception:
    cerebras_client = None

try:
    from google import genai
    from google.genai import types
    _api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    gemini_client = genai.Client(api_key=_api_key, http_options={'api_version': 'v1'}) if _api_key else None
except Exception:
    genai = None
    gemini_client = None

# Truncation
try:
    import tiktoken as _tiktoken
    _enc = _tiktoken.get_encoding("cl100k_base")
    MAX_TEXT_TOKENS_PER_SLIDE = 800

    def safe_truncate_text(text: str) -> tuple[str, int]:
        tokens = _enc.encode(text)
        orig = len(tokens)
        if orig > MAX_TEXT_TOKENS_PER_SLIDE:
            text = _enc.decode(tokens[:MAX_TEXT_TOKENS_PER_SLIDE]).strip() + "\n[content truncated]"
        return text, min(orig, MAX_TEXT_TOKENS_PER_SLIDE)
except ImportError:
    def safe_truncate_text(text: str) -> tuple[str, int]:
        trunc = text[:4000] + "\n...[truncated]" if len(text) > 4000 else text
        return trunc, len(trunc) // 4

# Core Generation
def _llm_generate_text(prompt: str, ai_model: str) -> str:
    if ai_model == "gemini-1.5-flash":
        if not gemini_client: raise RuntimeError("Gemini not configured")
        return gemini_client.models.generate_content(model=GEMINI_MODEL, contents=prompt).text
    elif ai_model == "cerebras":
        if not cerebras_client: raise RuntimeError("Cerebras not configured")
        return cerebras_client.chat.completions.create(
            model=CEREBRAS_MODEL,
            messages=[{"role": "user", "content": prompt}]
        ).choices[0].message.content
    elif ai_model == "groq":
        if not groq_client: raise RuntimeError("Groq not configured")
        try:
            return groq_client.chat.completions.create(model=GROQ_MODEL, messages=[{"role":"user", "content":prompt}]).choices[0].message.content
        except Exception as e:
            if "429" in str(e) and gemini_client:
                logger.warning("Groq rate limit. Failing over to Gemini...")
                return gemini_client.models.generate_content(model=GEMINI_MODEL, contents=prompt).text
            raise e
    elif ai_model == "llama3":
        if not ollama: raise RuntimeError("Ollama not installed")
        return ollama.chat(model=OLLAMA_MODEL, messages=[{"role":"user", "content":prompt}])["message"]["content"]
    raise RuntimeError(f"Unknown model: {ai_model}")

def parse_json_response(raw: str) -> Any:
    raw = raw.strip()
    # Strip markdown fences
    match = re.search(r"```(?:json)?\s*([\s\S]+?)```", raw)
    if match: raw = match.group(1).strip()
    
    # Remove control characters that break JSON parsing (e.g. unescaped newlines/tabs inside strings)
    raw = re.sub(r'[\x00-\x1F\x7F]', '', raw)
    
    match = re.search(r"\{[\s\S]*\}|\[[\s\S]*\]", raw)
    return json.loads(match.group()) if match else json.loads(raw)


# Content Generation
def enhance_slide_content(raw_text: str, ai_model: str = "llama3") -> str:
    prompt = f"Transform this raw lecture text into structured Markdown:\n{raw_text}"
    try: return _llm_generate_text(prompt, ai_model)
    except Exception: return raw_text

def generate_summary(slide_text: str, ai_model: str = "llama3") -> str:
    prompt = f"Write a 2-3 sentence educational summary of this slide:\n{slide_text}"
    try: return _llm_generate_text(prompt, ai_model)
    except Exception: return "Summary unavailable."

def generate_quiz(slide_text: str, ai_model: str = "llama3") -> dict:
    prompt = f"Create a 4-option MCQ about this slide. Return ONLY JSON: {{\"question\": \"...\", \"options\": [], \"correctAnswer\": 0}}\n{slide_text}"
    try: return parse_json_response(_llm_generate_text(prompt, ai_model))
    except Exception: return {"question": "Quiz unavailable.", "options": ["","","",""], "correctAnswer": 0}

def generate_slide_title(slide_text: str, ai_model: str = "llama3") -> Optional[str]:
    prompt = f"Generate a 3-7 word title for this slide:\n{slide_text[:1000]}"
    try: return _llm_generate_text(prompt, ai_model).strip('"\'')
    except Exception: return None

def process_slide_batch(raw_text: str, ai_model: str = "llama3", blueprint_context: str = "") -> dict:
    ctx = f"\nContext: {blueprint_context}" if blueprint_context else ""
    prompt = f"Analyze this slide {ctx}. Return ONLY JSON with enhanced_content, summary, title, quiz.\n{raw_text}"
    try: return parse_json_response(_llm_generate_text(prompt, ai_model))
    except Exception: return {"enhanced_content": raw_text, "summary": "", "title": "Slide", "quiz": {}}


async def batch_analyze_text_slides(slides: list[dict], ai_model: str = "groq", blueprint_context: str = "") -> dict[int, dict]:
    from .prompts import BATCH_SLIDE_PROMPT
    from ..llm_client import call_llm
    
    if not slides:
        return {}

    # Chunking: Process slides in windows of 10 to avoid context overflow
    CHUNK_SIZE = 10
    final_output = {}
    
    # Process in chunks
    for i in range(0, len(slides), CHUNK_SIZE):
        chunk = slides[i : i + CHUNK_SIZE]
        logger.info("Processing text slide batch: %d to %d (total %d)", i+1, i+len(chunk), len(slides))
        
        parts = [f"=== SLIDE {s['page_number']} ===\n{s['text']}" for s in chunk]
        prompt = BATCH_SLIDE_PROMPT + (f"\nContext: {blueprint_context}" if blueprint_context else "") + "\n\n".join(parts)
        
        try:
            raw = await call_llm(lambda: _llm_generate_text(prompt, ai_model), timeout_seconds=180.0)
            results = parse_json_response(raw)
            p_to_i = {s["page_number"]: s["index"] for s in chunk}
            
            for r in results:
                pn = r.get("page_number")
                if pn in p_to_i:
                    final_output[p_to_i[pn]] = r
        except Exception as e:
            logger.error("Batch text chunk (%d-%d) failed: %s", i+1, i+len(chunk), e)
            # Fill chunk with error placeholders
            for s in chunk:
                if s["index"] not in final_output:
                    final_output[s["index"]] = {
                        "title": f"Slide {s['page_number']}",
                        "content": s["text"],
                        "summary": "",
                        "questions": [],
                        "slide_type": "content_slide",
                        "is_metadata": False,
                        "parse_error": str(e),
                    }
    
    # Ensure all original slides have an entry
    for s in slides:
        if s["index"] not in final_output:
            final_output[s["index"]] = {
                "title": f"Slide {s['page_number']}",
                "content": s["text"],
                "summary": "",
                "questions": [],
                "slide_type": "content_slide",
                "is_metadata": False,
                "parse_error": "missing_from_batch_response",
            }

    return final_output


async def generate_deck_summary(all_text: str, ai_model: str = "groq") -> str:
    from .prompts import SUMMARIZER_PROMPT
    from ..llm_client import call_llm
    try: return await call_llm(lambda: _llm_generate_text(SUMMARIZER_PROMPT + "\n\n" + all_text, ai_model), timeout_seconds=40.0)
    except Exception: return ""

async def generate_deck_quiz(summary: str, ai_model: str = "groq") -> list[dict]:
    from .prompts import DECK_QUIZ_PROMPT
    from ..llm_client import call_llm
    try:
        raw = await call_llm(lambda: _llm_generate_text(DECK_QUIZ_PROMPT + summary, ai_model))
        return parse_json_response(raw)
    except Exception: return []
