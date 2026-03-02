import ollama
import json
import re

OLLAMA_MODEL = "llama3"  # Change to whichever model you have pulled (e.g., mistral, llama3)

def enhance_slide_content(raw_text: str) -> str:
    """
    Transforms raw PDF text into structured, educational Markdown content using Ollama.
    """
    prompt = f"""You are an expert educational content designer. 
Transform the following raw text from a lecture slide into a structured, engaging, and easy-to-read Markdown format for students.
- Use clear headings.
- Use bullet points for key concepts.
- Bold important terms.
- If there are steps or a sequence, use numbered lists.
- Keep it concise but ensure all critical information is preserved.

Raw Slide Text:
{raw_text}

Structured Markdown:"""

    try:
        response = ollama.chat(
            model=OLLAMA_MODEL,
            messages=[{"role": "user", "content": prompt}],
        )
        return response["message"]["content"].strip()
    except Exception as e:
        print(f"DEBUG: Ollama enhancement error: {e}")
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
        response = ollama.chat(
            model=OLLAMA_MODEL,
            messages=[{"role": "user", "content": prompt}],
        )
        return response["message"]["content"].strip()
    except Exception as e:
        print(f"DEBUG: Ollama summary error: {e}")
        return "Failed to generate summary."

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

    try:
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
        return quiz
    except Exception as e:
        print(f"DEBUG: Ollama quiz error: {e}")
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
        response = ollama.chat(
            model=OLLAMA_MODEL,
            messages=[{"role": "user", "content": prompt}],
        )
        title = response["message"]["content"].strip()
        # Remove any surrounding quotes the model might add
        title = title.strip('"\'')
        return title if title else None
    except Exception as e:
        print(f"DEBUG: Ollama title error: {e}")
        return None
