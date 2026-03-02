import ollama
import json
import re

OLLAMA_MODEL = "llama3"  # Change to whichever model you have pulled (e.g., mistral, llama3)

# Patterns that indicate the model added conversational filler
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
    """Remove common preamble/postamble lines LLMs tend to add."""
    for pattern in _PREAMBLE_PATTERNS:
        text = re.sub(pattern, "", text, flags=re.IGNORECASE | re.DOTALL)
    for pattern in _POSTAMBLE_PATTERNS:
        text = re.sub(pattern, "", text, flags=re.IGNORECASE)
    return text.strip()

def enhance_slide_content(raw_text: str) -> str:
    """
    Transforms raw PDF text into structured, educational Markdown content using Ollama.
    """
    prompt = f"""You are an expert educational content designer.
Transform the following raw lecture slide text into structured, educational Markdown for students.

Rules:
- Output ONLY the Markdown content. No preamble, no postamble.
- Do NOT write things like "Here's the structured content" or "Let me know if you need changes".
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
        response = ollama.chat(
            model=OLLAMA_MODEL,
            messages=[{"role": "user", "content": prompt}],
        )
        result = response["message"]["content"].strip()
        result = _strip_conversational_wrapper(result)
        return result
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

Return ONLY valid JSON with this exact structure:
{{
  "summary": "...",
  "suggestions": ["suggestion 1", "suggestion 2", "suggestion 3"]
}}
No extra text outside the JSON."""

    try:
        response = ollama.chat(
            model=OLLAMA_MODEL,
            messages=[{"role": "user", "content": prompt}],
        )
        content = response["message"]["content"].strip()
        json_match = re.search(r'\{.*\}', content, re.DOTALL)
        if json_match:
            content = json_match.group()
        result = json.loads(content)
        return result
    except Exception as e:
        print(f"DEBUG: Ollama analytics error: {e}")
        return {
            "summary": "We couldn't generate an AI summary at this time. Please check that Ollama is running.",
            "suggestions": [
                "Review slides with the lowest quiz correct rates and consider simplifying the content.",
                "Engage students who haven't attempted any quizzes yet.",
                "Consider adding more examples to slides where students spend less time."
            ]
        }

def generate_real_world_relevance(slide_text: str, previous_examples: list) -> dict:
    """
    Generates a highly specific, realistic industry application for the concept in a slide.
    Skips administrative/title slides by returning has_applicable_concept = False.
    """
    prev_examples_str = "\n".join([f"- {ex}" for ex in previous_examples]) if previous_examples else "None"
    
    prompt = f"""You are an expert Educational Content Strategist integrated into the Learnstation backend. Analyze the provided slide text and metadata to determine if a real-world application card should be generated.

Step 1: Concept Evaluation (The Gatekeeper)
Evaluate the slide content. If the slide is an introductory title page, an administrative announcement, or a table of raw statistics without a clear underlying theory, you MUST set has_applicable_concept to false and leave the rest of the fields null. Do not rely solely on word count; evaluate if a core academic/technical concept is present. Do not force an application where one does not naturally exist.

Step 2: Generation (If applicable)
If a core concept is present, generate a highly specific, realistic industry application. Avoid generic examples.
- concept_identified: Name the exact theory/algorithm.
- industry: Name the specific sector.
- popular_app_example: If this concept is famously used by a widely recognized consumer app or tech giant (e.g., Spotify, Netflix, Uber, TikTok, Amazon), explicitly name the company and explain how they use it in one sentence. If no popular app fits perfectly, return null.
- scenario: Write exactly one concise sentence explaining the broader industry use case or what fails without it.
- career_role: State a specific job title that uses this concept.
- confidence_score: Rate your confidence (1-10) that this concept directly maps to the provided real-world scenario.

Step 3: Anti-Repetition
Your generated scenario, industry, and popular_app_example MUST be fundamentally different from the following previously generated examples:
{prev_examples_str}

Return EXACTLY valid JSON with this structure (no other text, no markdown block markers outside the JSON):
{{
  "has_applicable_concept": true,
  "confidence_score": 9,
  "relevance_insight": {{
    "concept_identified": "string",
    "industry": "string",
    "popular_app_example": "string or null",
    "scenario": "string",
    "career_role": "string"
  }}
}}

Slide Content:
{slide_text}
"""

    try:
        response = ollama.chat(
            model=OLLAMA_MODEL,
            messages=[{"role": "user", "content": prompt}],
        )
        content = response["message"]["content"].strip()
        json_match = re.search(r'\{.*\}', content, re.DOTALL)
        if json_match:
            content = json_match.group()
        
        result = json.loads(content)
        # Ensure fallback defaults if LLM hallucinates structure
        if "has_applicable_concept" not in result:
             result["has_applicable_concept"] = False
        return result
    except Exception as e:
        print(f"DEBUG: Ollama relevance generation error: {e}")
        return {
            "has_applicable_concept": False,
            "confidence_score": 0,
            "relevance_insight": None
        }
