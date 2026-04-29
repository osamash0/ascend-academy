import os
import logging
from typing import Any
import json
import re
from pathlib import Path
from pydantic import BaseModel
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# Load root .env first, then backend/.env (backend/.env takes precedence)
_root_env = Path(__file__).resolve().parent.parent.parent / ".env"
_backend_env = Path(__file__).resolve().parent.parent / ".env"
if _root_env.exists():
    load_dotenv(dotenv_path=_root_env, override=True)
if _backend_env.exists():
    load_dotenv(dotenv_path=_backend_env, override=True)

OLLAMA_MODEL = "llama3"
GEMINI_MODEL = "gemini-2.5-flash"
GROQ_MODEL = "llama-3.1-8b-instant"
GROQ_VISION_MODEL = "llama-3.2-11b-vision-preview"

try:
    import ollama
except ImportError:
    ollama = None

try:
    from groq import Groq
    _groq_api_key = os.environ.get("GROQ_API_KEY")
    if _groq_api_key and _groq_api_key != "your_groq_api_key_here":
        groq_client = Groq(api_key=_groq_api_key, max_retries=0)
        logger.info("Groq client initialized successfully.")
    else:
        groq_client = None
        logger.warning("Groq client not initialized: GROQ_API_KEY missing or placeholder.")
except Exception:
    groq_client = None

try:
    from google import genai
    from google.genai import types
    _api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    gemini_client = genai.Client(api_key=_api_key) if _api_key else None
except Exception:
    genai = None
    gemini_client = None

# Ollama helper
_PREAMBLE_PATTERNS = [
    r"^here'?s? .*?:\s*",
    r"^sure[!,.].*?\n",
    r"^of course[!,.].*?\n",
    r"^certainly[!,.].*?\n",
    r"^below is.*?:\s*",
    r"^the following.*?:\s*",
]
_POSTAMBLE_PATTERNS = [
    r"\n?let me know if.*$",
    r"\n?feel free to.*$",
    r"\n?i hope this helps.*$",
    r"\n?please note.*conversational.*$",
    r"\n?if you (need|want|have).*$",
]
def _strip_conversational_wrapper(text: str) -> str:
    for pattern in _PREAMBLE_PATTERNS:
        text = re.sub(pattern, "", text, flags=re.IGNORECASE | re.DOTALL)
    for pattern in _POSTAMBLE_PATTERNS:
        text = re.sub(pattern, "", text, flags=re.IGNORECASE)
    return text.strip()

# Slide text truncation — keeps prompt within safe token limits for free-tier models
_MAX_SLIDE_CHARS = 4000

def _truncate_slide_text(text: str) -> str:
    if len(text) <= _MAX_SLIDE_CHARS:
        return text
    return text[:_MAX_SLIDE_CHARS] + "\n...[truncated]"


def _call_with_retry(fn, *args, max_attempts: int = 3, **kwargs):
    """Call fn with exponential backoff on rate-limit (429) errors."""
    import time as _time
    delay = 2.0
    last_exc = None
    for attempt in range(1, max_attempts + 1):
        try:
            return fn(*args, **kwargs)
        except Exception as exc:
            last_exc = exc
            msg = str(exc).lower()
            is_rate_limit = "429" in msg or "rate_limit" in msg or "rate limit" in msg
            if is_rate_limit and attempt < max_attempts:
                logger.warning("Rate-limit hit (attempt %s/%s), retrying in %.0fs...", attempt, max_attempts, delay)
                _time.sleep(delay)
                delay *= 2
            else:
                raise
    raise last_exc


# Gemini Schema
class QuizQuestion(BaseModel):
    question: str
    options: list[str]
    correctAnswer: int

class SlideBatchResult(BaseModel):
    enhanced_content: str
    summary: str
    title: str
    quiz: QuizQuestion

class AnalyticsInsights(BaseModel):
    summary: str
    suggestions: list[str]

# --- Enhance Slide ---
def enhance_slide_content(raw_text: str, ai_model: str = "llama3") -> str:
    prompt = f"""You are an expert educational content designer.
Transform the following raw lecture slide text into structured, educational Markdown for students.

Rules:
- Output ONLY the Markdown content. No preamble, no postamble.
- Do NOT add any commentary, greetings, or sign-offs.
- Use clear headings (##, ###).
- Use bullet points for key concepts.
- Bold important terms.
- Use numbered lists for steps or sequences.
- Preserve all critical information.

Raw Slide Text:
{raw_text}

Markdown Output:"""

    if ai_model == "gemini-2.5-flash" or ai_model == "gemini-1.5-flash":
        if gemini_client:
            try:
                res = gemini_client.models.generate_content(model=GEMINI_MODEL, contents=prompt)
                return res.text.strip()
            except Exception as e:
                logger.error("Gemini error: %s", e, exc_info=True)
        return raw_text
    elif ai_model == "groq":
        if not groq_client:
            return raw_text + "\n\n(Error: Groq API key is missing from .env)"
        try:
            res = groq_client.chat.completions.create(model=GROQ_MODEL, messages=[{"role": "user", "content": prompt}])
            return res.choices[0].message.content.strip()
        except Exception as e:
            logger.error("Groq error: %s", e, exc_info=True)
            return raw_text
    elif ai_model == "llama3":
        if ollama is None:
            return raw_text + "\n\n(Error: Ollama not installed)"
        try:
            res = ollama.chat(model=OLLAMA_MODEL, messages=[{"role": "user", "content": prompt}])
            text = res["message"]["content"].strip()
            return _strip_conversational_wrapper(text)
        except Exception as e:
            logger.error("Ollama error: %s", e, exc_info=True)
            return raw_text
    return raw_text

# --- Vision Analysis (primary upload pipeline) ---

_SLIDE_VISION_PROMPT = """You are an expert educational assistant analyzing a university lecture slide.

Analyze the slide image and return ONLY a valid JSON object. Do not include any text outside the JSON.

{
  "slide_type": "content_slide",
  "metadata": {
    "lecture_title": null,
    "lecturer_name": null,
    "course_code": null,
    "university_logo_present": false,
    "slide_number": null
  },
  "content_extraction": {
    "main_topic": null,
    "key_points": [],
    "summary": "",
    "example": null
  },
  "quiz": null
}

slide_type values — pick exactly one:
- "title_slide"  : course/lecture name, professor info, date, university branding
- "meta_slide"   : only logo, page number, "Thank you", "Questions?", references list, or blank slide
- "content_slide": educational concepts, definitions, theory, processes
- "example_slide": demonstrates a worked example, problem, or case study
- "diagram_slide": chart, diagram, figure, or equation is the primary element

Quiz format (required for content_slide / example_slide / diagram_slide):
{"question": "...", "options": ["...", "...", "...", "..."], "correctAnswer": 0}
correctAnswer is the 0-indexed position of the correct option (0-3).

Rules:
1. For title_slide and meta_slide: set quiz to null and key_points to [].
2. For content_slide: fill key_points with the main bullet points and write a 2-3 sentence summary.
3. For example_slide: fill the example field with the complete example text.
4. For diagram_slide: describe the diagram's key takeaway in summary; key_points can list axes/labels.
5. Use null for absent strings, false for absent booleans, [] for empty arrays."""


_VISION_SLIDE_TYPES_METADATA = {"title_slide", "meta_slide"}


def _vision_default() -> dict:
    return {
        "slide_type": "content_slide",
        "metadata": {
            "lecture_title": None, "lecturer_name": None,
            "course_code": None, "university_logo_present": False, "slide_number": None,
        },
        "content_extraction": {"main_topic": None, "key_points": [], "summary": "", "example": None},
        "quiz": None,
    }


def _parse_vision_json(raw: str) -> dict:
    """Extract JSON from vision model response, handling markdown code fences."""
    raw = raw.strip()
    # Strip ```json ... ``` wrappers if present
    match = re.search(r"```(?:json)?\s*([\s\S]+?)```", raw)
    if match:
        raw = match.group(1).strip()
    # Find outermost JSON object
    match = re.search(r"\{[\s\S]*\}", raw)
    if match:
        return json.loads(match.group())
    return json.loads(raw)


def analyze_slide_vision(base64_image: str, raw_text: str = "", ai_model: str = "groq") -> dict:
    """
    Analyze a slide image with a vision model.
    Returns a rich dict: slide_type, metadata, content_extraction, quiz.
    Falls back to _vision_default() on any error.
    """
    if ai_model == "groq":
        if not groq_client:
            return _vision_default()

        user_content: list = [
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"},
            }
        ]
        # Provide supplemental text so the model can read small/low-contrast text
        if raw_text.strip():
            user_content.append({
                "type": "text",
                "text": f"Supplemental extracted text from this slide:\n{raw_text[:2000]}",
            })

        try:
            res = _call_with_retry(
                groq_client.chat.completions.create,
                model=GROQ_VISION_MODEL,
                messages=[
                    {"role": "system", "content": _SLIDE_VISION_PROMPT},
                    {"role": "user", "content": user_content},
                ],
                temperature=0.2,
                max_tokens=1024,
                response_format={"type": "json_object"},
            )
            return _parse_vision_json(res.choices[0].message.content)
        except Exception as e:
            logger.error("Groq vision error: %s", e, exc_info=True)
            return _vision_default()

    elif ai_model in ("gemini-2.5-flash", "gemini-1.5-flash"):
        if not gemini_client:
            return _vision_default()
        try:
            import base64 as _b64
            image_bytes = _b64.b64decode(base64_image)
            prompt = _SLIDE_VISION_PROMPT + "\n\nAnalyze the following lecture slide:"
            res = gemini_client.models.generate_content(
                model=GEMINI_MODEL,
                contents=[
                    types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                    prompt,
                ],
                config=types.GenerateContentConfig(response_mime_type="application/json"),
            )
            return _parse_vision_json(res.text)
        except Exception as e:
            logger.error("Gemini vision error: %s", e, exc_info=True)
            return _vision_default()

    # Ollama / unknown model — vision not supported, caller should fall back to text
    return _vision_default()


def format_slide_content(content_extraction: dict) -> str:
    """Convert vision content_extraction dict into readable Markdown."""
    parts = []
    topic = content_extraction.get("main_topic")
    if topic:
        parts.append(f"## {topic}")
    key_points = content_extraction.get("key_points") or []
    if key_points:
        parts.append("\n".join(f"- {kp}" for kp in key_points))
    example = content_extraction.get("example")
    if example:
        parts.append(f"**Example:**\n\n{example}")
    return "\n\n".join(parts)


# --- Batch Processing (Upload optimization) ---
def process_slide_batch(raw_text: str, ai_model: str = "llama3") -> dict:
    raw_text = _truncate_slide_text(raw_text)
    prompt = f"""You are an educational assistant. Given the following raw lecture slide text, perform 4 tasks based ONLY on the educational content:
1. "enhanced_content": Transform the text into clear Markdown formatting suitable for students (bullet points, bold terms, headings).
2. "summary": Write a concise 2-3 sentence summary.
3. "title": Generate a short, descriptive title (3-7 words).
4. "quiz": Create one multiple-choice quiz question with exactly 4 options about the slide content.

Return ONLY valid JSON with this exact structure:
{{
  "enhanced_content": "...",
  "summary": "...",
  "title": "...",
  "quiz": {{
    "question": "...",
    "options": ["A", "B", "C", "D"],
    "correctAnswer": 0
  }}
}}
The correctAnswer must be the 0-indexed position of the correct option (0-3).

Raw Slide Text:
{raw_text}"""

    default_res = {
        "enhanced_content": raw_text,
        "summary": "",
        "title": "Slide Title",
        "quiz": {"question": "Could not generate quiz.", "options": ["", "", "", ""], "correctAnswer": 0}
    }

    if ai_model == "gemini-2.5-flash" or ai_model == "gemini-1.5-flash":
        if gemini_client:
            try:
                res = gemini_client.models.generate_content(
                    model=GEMINI_MODEL,
                    contents=prompt,
                    config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=SlideBatchResult)
                )
                return json.loads(res.text)
            except Exception as e:
                logger.error("Gemini batch error: %s", e, exc_info=True)
        return default_res
    elif ai_model == "groq":
        if not groq_client:
            default_res["quiz"]["question"] = "Error: GROQ_API_KEY is missing from .env file!"
            return default_res
        try:
            res = _call_with_retry(
                groq_client.chat.completions.create,
                model=GROQ_MODEL,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"}
            )
            return json.loads(res.choices[0].message.content)
        except Exception as e:
            logger.error("Groq batch error: %s", e, exc_info=True)
            return default_res
    elif ai_model == "llama3":
        if ollama is None:
            return default_res
        try:
            res = ollama.chat(model=OLLAMA_MODEL, messages=[{"role": "user", "content": prompt}])
            content = res["message"]["content"].strip()
            json_match = re.search(r'\{.*\}', content, re.DOTALL)
            if json_match:
                content = json_match.group()
            return json.loads(content)
        except Exception as e:
            logger.error("Ollama batch error: %s", e, exc_info=True)
            return default_res
    return default_res

# --- Summary ---
def generate_summary(slide_text: str, ai_model: str = "llama3") -> str:
    prompt = f"""You are an educational assistant. Given the following slide content, write a concise 2-3 sentence summary suitable for a student.
Focus ONLY on the educational/academic content (concepts, definitions, formulas, examples, algorithms).
Completely ignore any administrative metadata such as instructor names, emails, contact info, office hours, dates, university names, department names, grading policies, or logistics.
Return ONLY the summary text, no preamble.

Slide content:
{slide_text}

Summary:"""

    if ai_model == "gemini-2.5-flash" or ai_model == "gemini-1.5-flash":
        if gemini_client:
            try:
                res = gemini_client.models.generate_content(model=GEMINI_MODEL, contents=prompt)
                return res.text.strip()
            except Exception as e:
                logger.error("Gemini summary error: %s", e, exc_info=True)
        return "Failed to generate summary."
    elif ai_model == "groq":
        if not groq_client:
            return "Error: GROQ_API_KEY missing from .env!"
        try:
            res = groq_client.chat.completions.create(model=GROQ_MODEL, messages=[{"role": "user", "content": prompt}])
            return res.choices[0].message.content.strip()
        except Exception as e:
            logger.error("Groq summary error: %s", e, exc_info=True)
            return "Failed to generate summary."
    elif ai_model == "llama3":
        if ollama is None:
            return "Failed to generate summary. Ollama SDK is not installed in the backend environment."
        try:
            res = ollama.chat(model=OLLAMA_MODEL, messages=[{"role": "user", "content": prompt}])
            return res["message"]["content"].strip()
        except Exception as e:
            logger.error("Ollama summary error: %s", e, exc_info=True)
            return "Failed to generate summary."
    return "Failed to generate summary."

# --- Quiz ---
def generate_quiz(slide_text: str, ai_model: str = "llama3") -> dict:
    default_quiz = {"question": "Failed to generate quiz question.", "options": ["Option A", "Option B", "Option C", "Option D"], "correctAnswer": 0}

    if ai_model == "gemini-2.5-flash" or ai_model == "gemini-1.5-flash":
        if gemini_client:
            prompt = f"""You are an educational assistant. Based on the following slide content, create one multiple-choice quiz question with exactly 4 options. The options should be plausibly confusing except for the single correct answer.

Slide content:
{slide_text}"""
            try:
                res = gemini_client.models.generate_content(
                    model=GEMINI_MODEL,
                    contents=prompt,
                    config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=QuizQuestion)
                )
                return json.loads(res.text)
            except Exception as e:
                logger.error("Gemini quiz error: %s", e, exc_info=True)
        return default_quiz
    elif ai_model == "groq":
        if not groq_client:
            default_quiz["question"] = "Error: GROQ_API_KEY missing from .env!"
            return default_quiz
        prompt = f"""You are an educational assistant. Based on the following slide content, create one multiple-choice quiz question with exactly 4 options (A, B, C, D).
Return your answer as valid JSON with this exact structure:
{{
  "question": "your question here",
  "options": ["option A text", "option B text", "option C text", "option D text"],
  "correctAnswer": 0
}}
The correctAnswer field must be the 0-indexed position of the correct option (0=A, 1=B, 2=C, 3=D). Return ONLY the JSON object.
Slide content:
{slide_text}"""
        try:
            res = groq_client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"}
            )
            return json.loads(res.choices[0].message.content)
        except Exception as e:
            logger.error("Groq quiz error: %s", e, exc_info=True)
            return default_quiz
    elif ai_model == "llama3":
        if ollama is None:
            return {
                "question": "Failed to generate quiz question. Ollama SDK not installed.",
                "options": ["Option A", "Option B", "Option C", "Option D"],
                "correctAnswer": 0
            }
        prompt = f"""You are an educational assistant. Based on the following slide content, create one multiple-choice quiz question with exactly 4 options (A, B, C, D).
Focus ONLY on the educational/academic content (concepts, definitions, formulas, examples, algorithms).
Do NOT create questions about instructor names, emails, dates, university names, or any administrative/logistical information.

Return your answer as valid JSON with this exact structure:
{{
  "question": "your question here",
  "options": ["option A text", "option B text", "option C text", "option D text"],
  "correctAnswer": 0
}}

The correctAnswer field must be the 0-indexed position of the correct option (0=A, 1=B, 2=C, 3=D).
Return ONLY the JSON object, no extra text.

Slide content:
{slide_text}"""
        try:
            res = ollama.chat(model=OLLAMA_MODEL, messages=[{"role": "user", "content": prompt}])
            content = res["message"]["content"].strip()
            json_match = re.search(r'\{.*\}', content, re.DOTALL)
            if json_match:
                content = json_match.group()
            return json.loads(content)
        except Exception as e:
            logger.error("Ollama quiz error: %s", e, exc_info=True)
            return default_quiz

    return default_quiz

# --- Title ---
def generate_slide_title(slide_text: str, ai_model: str = "llama3") -> str:
    prompt = f"""You are an educational assistant. Given the following slide content, generate a concise, descriptive title of 3 to 7 words that captures the main topic.
Return ONLY the title text, no quotes, no punctuation at the end, no extra explanation.

Slide content:
{slide_text[:1000]}

Title:"""

    if ai_model == "gemini-2.5-flash" or ai_model == "gemini-1.5-flash":
        if gemini_client:
            try:
                res = gemini_client.models.generate_content(model=GEMINI_MODEL, contents=prompt)
                return res.text.strip().strip('"\'') or None
            except Exception as e:
                logger.error("Gemini title error: %s", e, exc_info=True)
        return None
    elif ai_model == "groq":
        if not groq_client:
            return None
        try:
            res = groq_client.chat.completions.create(model=GROQ_MODEL, messages=[{"role": "user", "content": prompt}])
            title = res.choices[0].message.content.strip().strip('"\'')
            return title if title else None
        except Exception as e:
            logger.error("Groq title error: %s", e, exc_info=True)
            return None
    elif ai_model == "llama3":
        if ollama is None:
            return None
        try:
            res = ollama.chat(model=OLLAMA_MODEL, messages=[{"role": "user", "content": prompt}])
            title = res["message"]["content"].strip().strip('"\'')
            return title if title else None
        except Exception as e:
            logger.error("Ollama title error: %s", e, exc_info=True)
            return None
    return None

# --- Analytics ---
def generate_analytics_insights(stats: dict, ai_model: str = "llama3") -> dict:
    prompt = f"""You are an expert educational data analyst and teaching coach.
A professor has shared the following statistics about their students' performance:

- Total students: {stats.get('total_students', 0)}
- Average quiz score: {stats.get('average_score', 0)}%
- Total quiz attempts: {stats.get('total_attempts', 0)}
- Total correct answers: {stats.get('total_correct', 0)}
- Hardest slides (lowest correct rate): {stats.get('hard_slides', 'N/A')}
- Most engaging slides (longest avg time): {stats.get('engaging_slides', 'N/A')}
- Weekly quiz activity trend: {stats.get('weekly_trend', 'N/A')}
- Confidence ratings: {stats.get('confidence_summary', 'N/A')}

Your task:
1. Write a SHORT, friendly 2-3 sentence paragraph that summarises what is happening (use plain English, no jargon, as if talking to the professor directly).
2. List exactly 3 concrete, actionable suggestions the professor can do to improve student outcomes, based on this data.
"""

    if ai_model == "gemini-2.5-flash" or ai_model == "gemini-1.5-flash":
        if gemini_client:
            try:
                res = gemini_client.models.generate_content(
                    model=GEMINI_MODEL, contents=prompt,
                    config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=AnalyticsInsights)
                )
                return json.loads(res.text)
            except Exception as e:
                logger.error("Gemini analytics error: %s", e, exc_info=True)
    elif ai_model == "groq":
        if not groq_client:
            return {"summary": "Error: GROQ_API_KEY is missing from .env!", "suggestions": []}
        groq_prompt = prompt + """\nReturn ONLY valid JSON with this exact structure:\n{\n  "summary": "...",\n  "suggestions": ["suggestion 1", "suggestion 2", "suggestion 3"]\n}"""
        try:
            res = groq_client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[{"role": "user", "content": groq_prompt}],
                response_format={"type": "json_object"}
            )
            return json.loads(res.choices[0].message.content)
        except Exception as e:
            logger.error("Groq analytics error: %s", e, exc_info=True)

    if ollama is None:
        return {
            "summary": "We couldn't generate an AI summary at this time. Ollama SDK is missing.",
            "suggestions": ["Wait for the backend administrator to install missing python dependencies."]
        }
    ollama_prompt = prompt + """\nReturn ONLY valid JSON with this exact structure:\n{\n  "summary": "...",\n  "suggestions": ["suggestion 1", "suggestion 2", "suggestion 3"]\n}\nNo extra text outside the JSON."""
    try:
        res = ollama.chat(model=OLLAMA_MODEL, messages=[{"role": "user", "content": ollama_prompt}])
        content = res["message"]["content"].strip()
        json_match = re.search(r'\{.*\}', content, re.DOTALL)
        if json_match:
            content = json_match.group()
        return json.loads(content)
    except Exception as e:
        logger.error("Ollama analytics error: %s", e, exc_info=True)

    return {
        "summary": "We couldn't generate an AI summary at this time. Please check your AI model.",
        "suggestions": [
            "Review slides with the lowest quiz correct rates and consider simplifying the content.",
            "Engage students who haven't attempted any quizzes yet.",
            "Consider adding more examples to slides where students spend less time."
        ]
    }

def generate_metric_feedback(metric_name: str, metric_value: Any, context_stats: dict, ai_model: str = "llama3") -> str:
    prompt = f"""You are an expert educational teaching coach.
Give a SHORT (max 2 sentences), sharp, and professional feedback to a professor about this specific metric:
- Metric Name: {metric_name}
- Current Value: {metric_value}

Context of the rest of the lecture:
- Avg Score: {context_stats.get('average_score', 0)}%
- Total Students: {context_stats.get('total_students', 0)}
- Hardest slides: {context_stats.get('hard_slides', 'N/A')}

Your feedback should be context-aware. If the metric is good, give a quick 'why'. If it's low, give a quick 'how to fix' relative to the slides.
Return ONLY the 1-2 sentence feedback string. No preamble.
"""

    if ai_model == "gemini-2.5-flash" or ai_model == "gemini-1.5-flash":
        if gemini_client:
            try:
                res = gemini_client.models.generate_content(model=GEMINI_MODEL, contents=prompt)
                return res.text.strip()
            except Exception:
                pass
    elif ai_model == "groq":
        if groq_client:
            try:
                res = groq_client.chat.completions.create(model=GROQ_MODEL, messages=[{"role": "user", "content": prompt}])
                return res.choices[0].message.content.strip()
            except Exception:
                pass

    if ollama:
        try:
            res = ollama.chat(model=OLLAMA_MODEL, messages=[{"role": "user", "content": prompt}])
            return res["message"]["content"].strip()
        except Exception:
            pass
            
    return f"This metric ({metric_value}) indicates the current level of student interaction for {metric_name}."

# --- Chat ---
def chat_with_lecture(slide_text: str, user_message: str, chat_history: list = None, ai_model: str = "llama3") -> str:
    """
    Acts as a personalized AI tutor answering a student's question based on the slide's context.
    """
    logger.debug("chat_with_lecture: model=%s text_len=%d", ai_model, len(slide_text))

    if chat_history is None:
        chat_history = []

    history_str = ""
    if chat_history:
        history_str = "\n--- Previous Conversation ---\n"
        for msg in chat_history:
            role = "Student" if msg.get("role") == "user" else "Tutor"
            history_str += f"{role}: {msg.get('content')}\n"
        history_str += "-----------------------------\n"

    prompt = f"""You are an expert, encouraging, and highly knowledgeable interactive AI Tutor.
A student is asking you a question about a specific lecture slide they are currently viewing.

Rules:
1. Answer the question using PRIMARILY the provided Slide Context.
2. If the slide doesn't contain the answer, you can use your general knowledge, but keep it highly relevant to the topic.
3. Be encouraging, concise, and easy to understand. Use markdown formatting (like bolding and bullet points) to make it readable.
4. Do NOT hallucinate facts not related to the topic.

--- Slide Context ---
{slide_text}
{history_str}
Student: {user_message}
Tutor:"""

    if ai_model == "gemini-2.5-flash" or ai_model == "gemini-1.5-flash":
        if gemini_client:
            try:
                res = gemini_client.models.generate_content(model=GEMINI_MODEL, contents=prompt)
                return res.text.strip()
            except Exception as e:
                logger.error("Gemini chat error: %s", e, exc_info=True)
        return "I'm sorry, I'm having trouble connecting to my knowledge base right now. Please try again in a moment!"
    elif ai_model == "groq":
        if not groq_client:
            return "Error: GROQ_API_KEY is missing from your .env!"
        try:
            res = groq_client.chat.completions.create(model=GROQ_MODEL, messages=[{"role": "user", "content": prompt}])
            return res.choices[0].message.content.strip()
        except Exception as e:
            logger.error("Groq chat error: %s", e, exc_info=True)
            return "I'm sorry, I'm having trouble connecting to my knowledge base right now. Please try again in a moment!"
    elif ai_model == "llama3":
        if ollama is None:
            return "Ollama SDK is not installed in the backend environment."
        try:
            res = ollama.chat(model=OLLAMA_MODEL, messages=[{"role": "user", "content": prompt}])
            return res["message"]["content"].strip()
        except Exception as e:
            logger.error("Ollama chat error: %s", e, exc_info=True)
            return "I'm sorry, I'm having trouble connecting to my knowledge base right now. Please try again in a moment!"


    return "No AI model selected or unknown AI model."

# --- TTS (Speech Synthesis) ---
async def generate_speech(text: str, voice: str = "en-US-AvaNeural") -> bytes:
    """
    Generates audio bytes for the given text using edge-tts (free AI voice).
    """
    import edge_tts
    import io

    communicate = edge_tts.Communicate(text, voice)
    audio_data = io.BytesIO()
    
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_data.write(chunk["data"])
            
    audio_data.seek(0)
    return audio_data.getvalue()


# --- Mind Map Generation ---
class MindMapNode(BaseModel):
    id: str
    label: str
    type: str
    summary: str | None = None
    children: list["MindMapNode"] = []

MindMapNode.model_rebuild()

class MindMapRoot(BaseModel):
    id: str
    label: str
    type: str
    children: list[MindMapNode]

def generate_mind_map(lecture_title: str, slides: list[dict], ai_model: str = "groq") -> dict:
    """
    Generate a hierarchical mind map tree from lecture slides.
    
    slides: list of {"id": str, "title": str, "summary": str}
    Returns: tree_data dict matching MindMapRoot schema.
    """
    slides_text = "\n".join(
        f"- Slide {i+1}: \"{s.get('title', 'Untitled')}\" — {s.get('summary', 'No summary')}"
        for i, s in enumerate(slides)
    )

    prompt = f"""You are an educational knowledge architect.
Given the following lecture slides, build a hierarchical mind map tree.

Rules:
1. The root node represents the whole lecture.
2. Group the slides into 2-4 thematic clusters (intermediate nodes with type "cluster").
3. Each slide becomes a child node of its closest cluster (type "slide").
4. Extract 2-3 key concepts from each slide as leaf children (type "concept"). Keep labels under 6 words.
5. Return ONLY valid JSON. No preamble, no postamble.

JSON Schema:
{{
  "id": "root",
  "label": "{lecture_title}",
  "type": "root",
  "children": [
    {{
      "id": "cluster-1",
      "label": "Cluster Theme",
      "type": "cluster",
      "children": [
        {{
          "id": "slide-1",
          "label": "Slide Title",
          "type": "slide",
          "summary": "one sentence summary",
          "children": [
            {{"id": "c-1-1", "label": "Key Concept", "type": "concept"}}
          ]
        }}
      ]
    }}
  ]
}}

Lecture Title: {lecture_title}
Slides:
{slides_text}

JSON Output:"""

    default_tree = {
        "id": "root",
        "label": lecture_title,
        "type": "root",
        "children": [
            {
                "id": f"slide-{i}",
                "label": s.get("title", f"Slide {i+1}"),
                "type": "slide",
                "summary": s.get("summary", ""),
                "children": []
            }
            for i, s in enumerate(slides)
        ]
    }

    if ai_model in ("gemini-2.5-flash", "gemini-1.5-flash"):
        if gemini_client:
            try:
                res = gemini_client.models.generate_content(
                    model=GEMINI_MODEL,
                    contents=prompt,
                    config=types.GenerateContentConfig(response_mime_type="application/json")
                )
                return json.loads(res.text)
            except Exception as e:
                logger.error("Gemini mind map error: %s", e, exc_info=True)
        return default_tree

    elif ai_model == "groq":
        if not groq_client:
            return default_tree
        try:
            res = groq_client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"}
            )
            return json.loads(res.choices[0].message.content)
        except Exception as e:
            logger.error("Groq mind map error: %s", e, exc_info=True)
            return default_tree

    elif ai_model == "llama3":
        if ollama is None:
            return default_tree
        try:
            res = ollama.chat(model=OLLAMA_MODEL, messages=[{"role": "user", "content": prompt}])
            content = res["message"]["content"].strip()
            json_match = re.search(r'\{.*\}', content, re.DOTALL)
            if json_match:
                content = json_match.group()
            return json.loads(content)
        except Exception as e:
            logger.error("Ollama mind map error: %s", e, exc_info=True)
            return default_tree

    return default_tree

