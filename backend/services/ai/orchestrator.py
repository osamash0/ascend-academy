import os
import logging
import json
import re
import asyncio
from typing import Any, Optional, Dict, List, Tuple, Union
from pathlib import Path
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# Load environment variables
def _init_env():
    _root_env = Path(__file__).resolve().parent.parent.parent.parent / ".env"
    _backend_env = Path(__file__).resolve().parent.parent.parent / ".env"
    if _root_env.exists(): load_dotenv(dotenv_path=_root_env, override=True)
    if _backend_env.exists(): load_dotenv(dotenv_path=_backend_env, override=True)

_init_env()

# Model Constants
OLLAMA_MODEL = "llama3"
GEMINI_MODEL = "gemini-2.0-flash"
GROQ_MODEL = "llama-3.3-70b-versatile"
GROQ_VISION_MODEL = "llama-3.2-11b-vision-preview"
CEREBRAS_MODEL = "llama-3.3-70b"

# Feature Flags & Metadata
_VISION_SLIDE_TYPES_METADATA = {"title_slide", "meta_slide"}

# --- LLM Clients Initialization ---

try:
    import ollama
except ImportError:
    ollama = None

try:
    from groq import Groq
    _g_key = os.environ.get("GROQ_API_KEY")
    groq_client = Groq(api_key=_g_key, max_retries=0) if (_g_key and len(_g_key) > 20) else None
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
    _gem_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    gemini_client = genai.Client(api_key=_gem_key, http_options={'api_version': 'v1'}) if _gem_key else None
except Exception:
    gemini_client = None

# --- Utility Functions ---

_CTRL_ESCAPE = {'\n': '\\n', '\r': '\\r', '\t': '\\t'}


def _sanitize_json_string(raw: str) -> str:
    """
    Fix common LLM-generated JSON defects:
    1. Strip unrepresentable control chars (U+0000-U+001F except whitespace).
    2. Escape lone backslashes not part of a valid JSON escape sequence
       (e.g. LaTeX \\sigma, \\beta, Windows paths).
    3. Escape literal newlines / tabs / carriage-returns that appear INSIDE
       JSON string values — the LLM sometimes emits them unescaped there,
       which is illegal JSON even though they are valid Python str chars.
    """
    result: list[str] = []
    in_string = False
    escaped = False
    i = 0
    n = len(raw)

    while i < n:
        ch = raw[i]

        if escaped:
            # We're inside a \X sequence — pass it through unchanged.
            result.append(ch)
            escaped = False
            i += 1
            continue

        if in_string:
            if ch == '\\':
                # Peek at the next character.
                nxt = raw[i + 1] if i + 1 < n else ''
                if nxt in ('"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u'):
                    # Valid JSON escape — pass the backslash through and mark
                    # the next char as already-escaped so we skip it cleanly.
                    result.append(ch)
                    escaped = True
                else:
                    # Invalid escape (e.g. \s, \b[not backspace], \sigma).
                    # Double the backslash so it becomes a literal backslash.
                    result.append('\\\\')
                i += 1
                continue

            if ch == '"':
                # End of string.
                result.append(ch)
                in_string = False
                i += 1
                continue

            # Inside a string: control chars must be escaped.
            if ord(ch) < 0x20:
                result.append(_CTRL_ESCAPE.get(ch, f'\\u{ord(ch):04x}'))
                i += 1
                continue

        else:
            # Outside strings: strip non-printable control chars.
            if 0x00 < ord(ch) < 0x20 and ch not in ('\n', '\r', '\t'):
                i += 1
                continue
            if ch == '"':
                in_string = True

        result.append(ch)
        i += 1

    return ''.join(result)


def parse_json_response(raw: str) -> Any:
    """
    Robustly extracts and parses JSON from an LLM response string.
    Handles markdown fences, control characters, and invalid escape sequences.
    """
    raw = raw.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]+?)```", raw)
    if fence:
        raw = fence.group(1).strip()

    raw = _sanitize_json_string(raw)

    match = re.search(r"(\{[\s\S]*\}|\[[\s\S]*\])", raw)
    candidate = match.group(1) if match else raw

    try:
        return json.loads(candidate)
    except json.JSONDecodeError as e:
        logger.warning("JSON parsing failed: %s. Raw: %s", e, candidate[:300])
        return {}

# --- Truncation Logic ---

try:
    import tiktoken
    _enc = tiktoken.get_encoding("cl100k_base")
    MAX_TEXT_TOKENS = 800

    def safe_truncate_text(text: str) -> Tuple[str, int]:
        """Truncates text to fit within token limits using tiktoken."""
        tokens = _enc.encode(text)
        count = len(tokens)
        if count > MAX_TEXT_TOKENS:
            text = _enc.decode(tokens[:MAX_TEXT_TOKENS]).strip() + "\n[content truncated]"
        return text, min(count, MAX_TEXT_TOKENS)
except ImportError:
    def safe_truncate_text(text: str) -> Tuple[str, int]:
        """Naive fallback truncation if tiktoken is missing."""
        trunc = text[:4000] + "\n...[truncated]" if len(text) > 4000 else text
        return trunc, len(trunc) // 4

# --- Generation Logic ---

def _llm_generate_text_sync(prompt: str, ai_model: str) -> str:
    """
    Synchronous implementation of text generation for various providers.
    Designed to be called via thread executors.
    """
    if ai_model == GEMINI_MODEL:
        if not gemini_client: raise RuntimeError("Gemini client not initialized")
        return gemini_client.models.generate_content(model=GEMINI_MODEL, contents=prompt).text
        
    elif ai_model == "cerebras":
        if not cerebras_client: raise RuntimeError("Cerebras client not initialized")
        response = cerebras_client.chat.completions.create(
            model=CEREBRAS_MODEL,
            messages=[{"role": "user", "content": prompt}]
        )
        return response.choices[0].message.content or ""
        
    elif ai_model == "groq":
        if not groq_client: raise RuntimeError("Groq client not initialized")
        try:
            response = groq_client.chat.completions.create(
                model=GROQ_MODEL, 
                messages=[{"role": "user", "content": prompt}]
            )
            return response.choices[0].message.content or ""
        except Exception as e:
            if "429" in str(e) and gemini_client:
                logger.warning("Groq rate limit. Falling back to Gemini.")
                return gemini_client.models.generate_content(model=GEMINI_MODEL, contents=prompt).text
            raise e
            
    elif ai_model == "llama3":
        if not ollama: raise RuntimeError("Ollama not installed")
        res = ollama.chat(model=OLLAMA_MODEL, messages=[{"role": "user", "content": prompt}])
        return res["message"]["content"]
        
    raise ValueError(f"Unsupported model: {ai_model}")

async def generate_text(prompt: str, ai_model: str = "groq") -> str:
    """Async wrapper for text generation."""
    from backend.services.llm_client import call_llm
    return await call_llm(lambda: _llm_generate_text_sync(prompt, ai_model))

# --- Public API Functions ---

def process_slide_batch(text: str, ai_model: str = "groq") -> Dict[str, Any]:
    """Synchronous slide processing (for legacy/internal calls)."""
    prompt = f"Analyze this slide text and return JSON with {{title, content, summary, questions, slide_type, is_metadata}}:\n\n{text}"
    raw = _llm_generate_text_sync(prompt, ai_model)
    return parse_json_response(raw)

async def enhance_slide_content(text: str, ai_model: str = "groq") -> Dict[str, Any]:
    """Enhances raw slide text into structured educational content."""
    from backend.services.ai.prompts import ENHANCE_PROMPT
    prompt = ENHANCE_PROMPT.format(text=text)
    raw = await generate_text(prompt, ai_model=ai_model)
    return parse_json_response(raw)

async def generate_deck_summary(content: str, ai_model: str = "groq") -> str:
    """Generates a high-level summary of the entire lecture deck."""
    prompt = f"Summarize this lecture content into a cohesive narrative:\n\n{content}"
    return await generate_text(prompt, ai_model)

async def generate_deck_quiz(summary: str, ai_model: str = "groq") -> List[Dict[str, Any]]:
    """Generates a comprehensive quiz based on the lecture summary."""
    prompt = f"Create a 5-question multiple choice quiz based on this summary. Return JSON array of {{question, options, answer}}:\n\n{summary}"
    raw = await generate_text(prompt, ai_model)
    return parse_json_response(raw)

async def batch_analyze_text_slides(slides: List[Dict[str, Any]], ai_model: str = "groq", blueprint: Optional[Dict] = None) -> List[Dict[str, Any]]:
    """Analyzes a batch of text-based slides, incorporating blueprint context if available."""
    from backend.services.ai.prompts import BATCH_SLIDE_PROMPT
    
    # Simple serial processing for now, can be optimized further
    results = []
    for s in slides:
        text = s["text"]
        if blueprint:
            from backend.services.planner_service import get_slide_context
            from backend.services.ai.prompts import PEDAGOGICAL_SLIDE_PROMPT
            
            ctx = get_slide_context(blueprint, s["index"])
            prompt = PEDAGOGICAL_SLIDE_PROMPT.format(context=ctx, text=text)
            
            try:
                # Use generate_text directly to handle the custom prompt
                raw = await generate_text(prompt, ai_model=ai_model)
                res = parse_json_response(raw)
                res["index"] = s["index"]
                results.append(res)
                continue # Skip the default process_slide_batch below
            except Exception as e:
                logger.error("Context-aware processing failed: %s", e)

        try:
            res = await asyncio.to_thread(process_slide_batch, text, ai_model=ai_model)
            res["index"] = s["index"]
            results.append(res)
        except Exception as e:
            logger.error("Batch processing failed for slide %d: %s", s["index"], e)
            results.append({"index": s["index"], "title": f"Slide {s['index']+1}", "content": s["text"], "parse_error": str(e)})
            
    return results

# Legacy re-exports
_llm_generate_text = _llm_generate_text_sync
generate_summary = generate_deck_summary
generate_quiz = generate_deck_quiz
generate_slide_title = lambda t: process_slide_batch(t).get("title", "Untitled")
