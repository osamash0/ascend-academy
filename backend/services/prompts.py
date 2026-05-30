BATCH_SLIDE_PROMPT = """\
You will receive a batch of university lecture slides separated by === SLIDE N === markers.
Your task is to transform them into high-quality educational content while adhering to the provided LECTURE MASTER PLAN (if present).

For EACH slide, return a JSON object with exactly these fields:
- "page_number": the integer N from the === SLIDE N === marker
- "title": descriptive title. 
  IMPORTANT: If a 'Proposed Title' is in the Master Plan, use it or a very similar one.
- "content": educational content in Markdown. Explicitly link concepts mentioned in the Master Plan.
- "summary": 2-3 sentence overview. Mention how this builds on previous slides as suggested in the Master Plan.
- "questions": array with exactly ONE MCQ:
    { "question": string, "options": [A, B, C, D], "answer": "A"|"B"|"C"|"D" }
- "slide_type": one of "content_slide", "diagram_slide", "title_slide"
- "is_metadata": false

Rules:
1. Ensure the narrative flows logically as outlined in the Master Plan.
2. Maintain technical rigor but keep it student-friendly.
3. Return a JSON array — one object per slide.
4. Return ONLY the JSON array. No preamble.

Slides:
"""

SINGLE_VISION_SLIDE_PROMPT = """\
Analyze this lecture slide image and its extracted text.
Return a single JSON object with exactly these fields:
- "title": concise AI-generated title (string)
- "content": educational content in GitHub-flavored Markdown (string)
- "summary": 2-3 sentence overview (string)
- "questions": array with exactly ONE multiple-choice question object:
    { "question": string, "options": [A, B, C, D], "answer": "A"|"B"|"C"|"D" }
- "slide_type": "diagram_slide" or "content_slide"
- "is_metadata": boolean

Return ONLY the JSON object. No preamble, no markdown fences.

Extracted text from slide:
{text}
"""

SUMMARIZER_PROMPT = """\
Compress this university lecture into a focused study summary.
Keep: key definitions, formulas, relationships between concepts, worked examples.
Drop: slide meta-text, repeated headers, filler phrases.
Target length: under 2000 tokens.
Format as structured Markdown with headers per topic.
"""

DECK_QUIZ_PROMPT = """\
Based on this lecture summary, generate 5 multiple-choice questions that test
conceptual understanding — not just recall. Include at least 2 questions that
connect ideas from different parts of the lecture.

Return a JSON array of question objects:
[{ "question": str, "options": [A,B,C,D], "answer": "A"|"B"|"C"|"D",
   "explanation": str, "topics": [str] }]

Return ONLY the JSON array.

Summary:
"""
