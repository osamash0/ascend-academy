import os
import json
from google import genai
from google.genai import types
from pydantic import BaseModel

GEMINI_MODEL = "gemini-2.5-flash"

# Initialize the Gemini Client. 
# It will automatically pick up GEMINI_API_KEY from the environment variables.
client = genai.Client()

def enhance_slide_content(raw_text: str) -> str:
    """
    Transforms raw PDF text into structured, educational Markdown content using Gemini.
    """
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

    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
        )
        return response.text.strip()
    except Exception as e:
        print(f"DEBUG: Gemini enhancement error: {e}")
        return raw_text

def generate_summary(slide_text: str) -> str:
    """
    Generates a concise 2-3 sentence summary for a slide's text content.
    """
    prompt = f"""You are an educational assistant. Given the following slide content, write a concise 2-3 sentence summary suitable for a student. 
Return ONLY the summary text, no preamble.

Slide content:
{slide_text}

Summary:"""

    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
        )
        return response.text.strip()
    except Exception as e:
        print(f"DEBUG: Gemini summary error: {e}")
        return "Failed to generate summary."

# Define Pydantic Schema for Quiz Generation
class QuizQuestion(BaseModel):
    question: str
    options: list[str]
    correctAnswer: int

def generate_quiz(slide_text: str) -> dict:
    """
    Generates a multiple-choice quiz question based on slide content using Gemini's structured output.
    Returns dict: { question, options: [A, B, C, D], correctAnswer: int (0-indexed) }
    """
    prompt = f"""You are an educational assistant. Based on the following slide content, create one multiple-choice quiz question with exactly 4 options. The options should be plausibly confusing except for the single correct answer.

Slide content:
{slide_text}"""

    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=QuizQuestion,
            )
        )
        return json.loads(response.text)
    except Exception as e:
        print(f"DEBUG: Gemini quiz error: {e}")
        return {
            "question": "Failed to generate quiz question.",
            "options": ["Option A", "Option B", "Option C", "Option D"],
            "correctAnswer": 0
        }

def generate_slide_title(slide_text: str) -> str:
    """
    Generates a short, descriptive title (3-7 words) for a slide based on its content.
    """
    prompt = f"""You are an educational assistant. Given the following slide content, generate a concise, descriptive title of 3 to 7 words that captures the main topic.
Return ONLY the title text, no quotes, no punctuation at the end, no extra explanation.

Slide content:
{slide_text[:1000]}

Title:"""

    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
        )
        title = response.text.strip()
        # Remove any surrounding quotes the model might add
        title = title.strip('"\'')
        return title if title else None
    except Exception as e:
        print(f"DEBUG: Gemini title error: {e}")
        return None

# Define Pydantic Schema for Analytics Insights
class AnalyticsInsights(BaseModel):
    summary: str
    suggestions: list[str]

def generate_analytics_insights(stats: dict) -> dict:
    """
    Given a statistics summary, returns AI-generated:
    - A friendly, plain-English explanation of the data
    - 3-5 actionable suggestions for the professor
    """
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

    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=AnalyticsInsights,
            )
        )
        return json.loads(response.text)
    except Exception as e:
        print(f"DEBUG: Gemini analytics error: {e}")
        return {
            "summary": "We couldn't generate an AI summary at this time. Please check your Gemini AI integration.",
            "suggestions": [
                "Review slides with the lowest quiz correct rates and consider simplifying the content.",
                "Engage students who haven't attempted any quizzes yet.",
                "Consider adding more examples to slides where students spend less time."
            ]
        }
