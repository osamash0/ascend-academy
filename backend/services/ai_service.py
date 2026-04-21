import os
import json
import re
from pathlib import Path
from dotenv import load_dotenv
from pydantic import BaseModel

# Load environment variables explicitly from the project root
# Path: backend/services/ai_service.py -> ../../.env
_env_path = Path(__file__).resolve().parent.parent.parent / ".env"
load_dotenv(dotenv_path=_env_path, override=True)

OLLAMA_MODEL = "llama3"
GEMINI_MODEL = "gemini-1.5-flash"
GROQ_MODEL = "llama-3.3-70b-versatile"

try:
    import ollama
except ImportError:
    ollama = None

try:
    from google import genai
    from google.genai import types
    _gemini_key = os.environ.get("GOOGLE_API_KEY")
    gemini_client = genai.Client(api_key=_gemini_key) if _gemini_key else None
except Exception:
    genai = None
    gemini_client = None

try:
    from groq import Groq
    _groq_key = os.environ.get("GROQ_API_KEY")
    groq_client = Groq(api_key=_groq_key) if _groq_key and _groq_key != "your_groq_api_key_here" else None
    if groq_client:
        print("✅ Groq client initialized successfully.")
    else:
        print("⚠️  Groq client NOT initialized — GROQ_API_KEY missing or placeholder.")
except ImportError:
    Groq = None
    groq_client = None

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
    elif ai_model == "groq" and groq_client:
        try:
            res = groq_client.chat.completions.create(model=GROQ_MODEL, messages=[{"role": "user", "content": prompt}])
            return res.choices[0].message.content.strip()
        except Exception as e:
            print(f"DEBUG Groq error: {e}")
            return raw_text
    else:
        if ollama is None:
            return raw_text
        try:
            res = ollama.chat(model=OLLAMA_MODEL, messages=[{"role": "user", "content": prompt}])
            text = res["message"]["content"].strip()
            return _strip_conversational_wrapper(text)
        except Exception as e:
            print(f"DEBUG Ollama error: {e}")
            return raw_text

# --- Summary ---
def generate_summary(slide_text: str, ai_model: str = "llama3") -> str:
    prompt = f"""You are an educational assistant. Given the following slide content, write a concise 2-3 sentence summary suitable for a student. 
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
    elif ai_model == "groq" and groq_client:
        try:
            res = groq_client.chat.completions.create(model=GROQ_MODEL, messages=[{"role": "user", "content": prompt}])
            return res.choices[0].message.content.strip()
        except Exception as e:
            print(f"DEBUG Groq summary error: {e}")
            return "Failed to generate summary."
    else:
        if ollama is None:
            return "Failed to generate summary. Ollama SDK is not installed in the backend environment."
        try:
            res = ollama.chat(model=OLLAMA_MODEL, messages=[{"role": "user", "content": prompt}])
            return res["message"]["content"].strip()
        except Exception as e:
            print(f"DEBUG Ollama summary error: {e}")
            return "Failed to generate summary."

# --- Quiz ---
def generate_quiz(slide_text: str, ai_model: str = "llama3") -> dict:
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
    elif ai_model == "groq" and groq_client:
        prompt = f"""You are an educational assistant. Based on the following slide content, create one multiple-choice quiz question with exactly 4 options (A, B, C, D).
Return your answer as valid JSON with this exact structure:
{{
  "question": "your question here",
  "options": ["option A text", "option B text", "option C text", "option D text"],
  "correctAnswer": 0
}}
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
    else:
        if ollama is None:
            return {
                "question": "Failed to generate quiz question. Ollama SDK not installed.",
                "options": ["Option A", "Option B", "Option C", "Option D"],
                "correctAnswer": 0
            }
        prompt = f"""You are an educational assistant. Based on the following slide content, create one multiple-choice quiz question with exactly 4 options (A, B, C, D).

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
            if json_match: content = json_match.group()
            return json.loads(content)
        except Exception as e:
            print(f"DEBUG Ollama quiz error: {e}")

    return {
        "question": "Failed to generate quiz question.",
        "options": ["Option A", "Option B", "Option C", "Option D"],
        "correctAnswer": 0
    }

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
    elif ai_model == "groq" and groq_client:
        try:
            res = groq_client.chat.completions.create(model=GROQ_MODEL, messages=[{"role": "user", "content": prompt}])
            return res.choices[0].message.content.strip().strip('"\'') or None
        except Exception as e:
            print(f"DEBUG Groq title error: {e}")
            return None
    else:
        try:
            res = ollama.chat(model=OLLAMA_MODEL, messages=[{"role": "user", "content": prompt}])
            title = res["message"]["content"].strip().strip('"\'')
            return title if title else None
        except Exception as e:
            print(f"DEBUG Ollama title error: {e}")
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
    elif ai_model == "groq" and groq_client:
        prompt += """\nReturn ONLY valid JSON with this exact structure:
{
  "summary": "...",
  "suggestions": ["suggestion 1", "suggestion 2", "suggestion 3"]
}"""
        try:
            res = groq_client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"}
            )
            return json.loads(res.choices[0].message.content)
        except Exception as e:
            print(f"DEBUG Groq analytics error: {e}")
    else:
        if ollama is None:
            return {
                "summary": "We couldn't generate an AI summary at this time. Ollama SDK is missing.",
                "suggestions": [
                    "Wait for the backend administrator to install missing python dependencies."
                ]
            }
        prompt += """\\nReturn ONLY valid JSON with this exact structure:
{
  "summary": "...",
  "suggestions": ["suggestion 1", "suggestion 2", "suggestion 3"]
}
No extra text outside the JSON."""
        try:
            res = ollama.chat(model=OLLAMA_MODEL, messages=[{"role": "user", "content": prompt}])
            content = res["message"]["content"].strip()
            json_match = re.search(r'\{.*\}', content, re.DOTALL)
            if json_match: content = json_match.group()
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
    with open("/tmp/chat_debug.log", "a") as f:
        f.write(f"\\n--- NEW CALL ---\\nMODEL: {ai_model}\\nTEXT LEN: {len(slide_text)}\\nMSG: {user_message}\\n")

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
    elif ai_model == "groq" and groq_client:
        try:
            res = groq_client.chat.completions.create(model=GROQ_MODEL, messages=[{"role": "user", "content": prompt}])
            return res.choices[0].message.content.strip()
        except Exception as e:
            print(f"DEBUG Groq chat error: {e}")
            return "I'm sorry, I'm having trouble connecting to my knowledge base right now. Please try again in a moment!"
    else:
        if ollama is None:
            return "Ollama SDK is not installed in the backend environment. Please restart the backend using: `pip install -r backend/requirements.txt && .venv/bin/python -m uvicorn backend.main:app --reload`"
        try:
            with open("/tmp/chat_debug.log", "a") as f:
                f.write(f"Calling Ollama...\\n")
            res = ollama.chat(model=OLLAMA_MODEL, messages=[{"role": "user", "content": prompt}])
            with open("/tmp/chat_debug.log", "a") as f:
                f.write(f"Ollama SUCCESS\\n")
            return res["message"]["content"].strip()
        except Exception as e:
            import traceback
            with open("/tmp/chat_debug.log", "a") as f:
                f.write(f"Ollama EXCEPTION: {e}\\n")
                traceback.print_exc(file=f)
            print(f"DEBUG Ollama chat error: {e}")
            return "I'm sorry, I'm having trouble connecting to my knowledge base right now. Please try again in a moment!"
