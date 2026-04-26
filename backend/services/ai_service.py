import os
import json
import re
from pathlib import Path
from pydantic import BaseModel
from dotenv import load_dotenv

# Load root .env first, then backend/.env (backend/.env takes precedence)
_root_env = Path(__file__).resolve().parent.parent.parent / ".env"
_backend_env = Path(__file__).resolve().parent.parent / ".env"
if _root_env.exists():
    load_dotenv(dotenv_path=_root_env, override=True)
if _backend_env.exists():
    load_dotenv(dotenv_path=_backend_env, override=True)

OLLAMA_MODEL = "llama3"
GEMINI_MODEL = "models/gemini-2.5-flash"
GROQ_MODEL = "llama-3.1-8b-instant"

try:
    import ollama
except ImportError:
    ollama = None

try:
    from groq import Groq
    _groq_api_key = os.environ.get("GROQ_API_KEY")
    if _groq_api_key and _groq_api_key != "your_groq_api_key_here":
        groq_client = Groq(api_key=_groq_api_key, max_retries=0)
        print("✅ Groq client initialized successfully.")
    else:
        groq_client = None
        print("⚠️  Groq client NOT initialized — GROQ_API_KEY missing or placeholder.")
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
                print(f"DEBUG Gemini error: {e}")
        return raw_text
    elif ai_model == "groq":
        if not groq_client:
            return raw_text + "\n\n(Error: Groq API key is missing from .env)"
        try:
            res = groq_client.chat.completions.create(model=GROQ_MODEL, messages=[{"role": "user", "content": prompt}])
            return res.choices[0].message.content.strip()
        except Exception as e:
            print(f"DEBUG Groq error: {e}")
            return raw_text
    elif ai_model == "llama3":
        if ollama is None:
            return raw_text + "\n\n(Error: Ollama not installed)"
        try:
            res = ollama.chat(model=OLLAMA_MODEL, messages=[{"role": "user", "content": prompt}])
            text = res["message"]["content"].strip()
            return _strip_conversational_wrapper(text)
        except Exception as e:
            print(f"DEBUG Ollama error: {e}")
            return raw_text
    return raw_text

# --- Batch Processing (Upload optimization) ---
def process_slide_batch(raw_text: str, ai_model: str = "llama3") -> dict:
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
                print(f"DEBUG Gemini batch error: {e}")
        return default_res
    elif ai_model == "groq":
        if not groq_client:
            default_res["quiz"]["question"] = "Error: GROQ_API_KEY is missing from .env file!"
            return default_res
        try:
            res = groq_client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"}
            )
            return json.loads(res.choices[0].message.content)
        except Exception as e:
            print(f"DEBUG Groq batch error: {e}")
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
            print(f"DEBUG Ollama batch error: {e}")
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
                print(f"DEBUG Gemini summary error: {e}")
        return "Failed to generate summary."
    elif ai_model == "groq":
        if not groq_client:
            return "Error: GROQ_API_KEY missing from .env!"
        try:
            res = groq_client.chat.completions.create(model=GROQ_MODEL, messages=[{"role": "user", "content": prompt}])
            return res.choices[0].message.content.strip()
        except Exception as e:
            print(f"DEBUG Groq summary error: {e}")
            return "Failed to generate summary."
    elif ai_model == "llama3":
        if ollama is None:
            return "Failed to generate summary. Ollama SDK is not installed in the backend environment."
        try:
            res = ollama.chat(model=OLLAMA_MODEL, messages=[{"role": "user", "content": prompt}])
            return res["message"]["content"].strip()
        except Exception as e:
            print(f"DEBUG Ollama summary error: {e}")
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
                print(f"DEBUG Gemini quiz error: {e}")
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
            print(f"DEBUG Groq quiz error: {e}")
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
            print(f"DEBUG Ollama quiz error: {e}")
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
                print(f"DEBUG Gemini title error: {e}")
        return None
    elif ai_model == "groq":
        if not groq_client:
            return None
        try:
            res = groq_client.chat.completions.create(model=GROQ_MODEL, messages=[{"role": "user", "content": prompt}])
            title = res.choices[0].message.content.strip().strip('"\'')
            return title if title else None
        except Exception as e:
            print(f"DEBUG Groq title error: {e}")
            return None
    elif ai_model == "llama3":
        if ollama is None:
            return None
        try:
            res = ollama.chat(model=OLLAMA_MODEL, messages=[{"role": "user", "content": prompt}])
            title = res["message"]["content"].strip().strip('"\'')
            return title if title else None
        except Exception as e:
            print(f"DEBUG Ollama title error: {e}")
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
                print(f"DEBUG Gemini analytics error: {e}")
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
            print(f"DEBUG Groq analytics error: {e}")

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
        print(f"DEBUG Ollama analytics error: {e}")

    return {
        "summary": "We couldn't generate an AI summary at this time. Please check your AI model.",
        "suggestions": [
            "Review slides with the lowest quiz correct rates and consider simplifying the content.",
            "Engage students who haven't attempted any quizzes yet.",
            "Consider adding more examples to slides where students spend less time."
        ]
    }

# --- Chat ---
def chat_with_lecture(slide_text: str, user_message: str, chat_history: list = None, ai_model: str = "llama3") -> str:
    """
    Acts as a personalized AI tutor answering a student's question based on the slide's context.
    """
    print(f"DEBUG chat_with_lecture: MODEL={ai_model}, TEXT_LEN={len(slide_text)}, MSG={user_message[:50]}")

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
                print(f"DEBUG Gemini chat error: {e}")
        return "I'm sorry, I'm having trouble connecting to my knowledge base right now. Please try again in a moment!"
    elif ai_model == "groq":
        if not groq_client:
            return "Error: GROQ_API_KEY is missing from your .env!"
        try:
            res = groq_client.chat.completions.create(model=GROQ_MODEL, messages=[{"role": "user", "content": prompt}])
            return res.choices[0].message.content.strip()
        except Exception as e:
            print(f"DEBUG Groq chat error: {e}")
            return "I'm sorry, I'm having trouble connecting to my knowledge base right now. Please try again in a moment!"
    elif ai_model == "llama3":
        if ollama is None:
            return "Ollama SDK is not installed in the backend environment."
        try:
            res = ollama.chat(model=OLLAMA_MODEL, messages=[{"role": "user", "content": prompt}])
            return res["message"]["content"].strip()
        except Exception as e:
            print(f"DEBUG Ollama chat error: {e}")
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
