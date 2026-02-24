import ollama
import json
import re

OLLAMA_MODEL = "llama3"  # Change to whichever model you have pulled


def generate_summary(slide_text: str) -> str:
    """
    Generates a concise 2-3 sentence summary for a slide's text content.
    """
    prompt = f"""You are an educational assistant. Given the following slide content, write a concise 2-3 sentence summary suitable for a student. 
Return ONLY the summary text, no preamble.

Slide content:
{slide_text}

Summary:"""

    response = ollama.chat(
        model=OLLAMA_MODEL,
        messages=[{"role": "user", "content": prompt}],
    )
    return response["message"]["content"].strip()


def generate_quiz(slide_text: str) -> dict:
    """
    Generates a multiple-choice quiz question based on slide content.
    Returns { question, options: [A, B, C, D], correctAnswer: int (0-indexed) }
    """
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

    response = ollama.chat(
        model=OLLAMA_MODEL,
        messages=[{"role": "user", "content": prompt}],
    )

    content = response["message"]["content"].strip()

    # Extract JSON even if there's extra text around it
    json_match = re.search(r'\{.*\}', content, re.DOTALL)
    if json_match:
        content = json_match.group()

    quiz = json.loads(content)

    # Validate structure
    assert "question" in quiz and "options" in quiz and "correctAnswer" in quiz
    assert len(quiz["options"]) == 4
    assert isinstance(quiz["correctAnswer"], int)

    return quiz
