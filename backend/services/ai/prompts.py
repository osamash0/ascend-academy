BATCH_SLIDE_PROMPT = """\
You will receive a batch of university lecture slides separated by === SLIDE N === markers.
Your task is to transform them into high-quality educational content while adhering to the provided LECTURE MASTER PLAN (if present).

For EACH slide, return a JSON object with exactly these fields:
- "page_number": the integer N from the === SLIDE N === marker
- "title": descriptive title. 
  IMPORTANT: If a 'Proposed Title' is in the Master Plan, use it or a very similar one.
- "content": Enhanced educational content in Markdown. Do NOT just copy-paste raw text. 
  - Fix typos.
  - Expand on abbreviations.
  - Add structural headers or bullet points if the raw text is a wall of text.
  - Explicitly link concepts mentioned in the Master Plan.
- "summary": 2-3 sentence overview. Mention how this builds on previous slides as suggested in the Master Plan.
- "questions": array with exactly ONE MCQ:
    {{ "question": string, "options": [A, B, C, D], "answer": "A"|"B"|"C"|"D" }}
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
- "content": Enhanced educational content in GitHub-flavored Markdown (string). 
  - Transcribe and format all text found in the image.
  - Describe diagrams if they contain critical information.
  - Fix any OCR errors from the 'Extracted text'.
- "summary": 2-3 sentence overview (string)
- "questions": array with exactly ONE multiple-choice question object:
    {{ "question": string, "options": [A, B, C, D], "answer": "A"|"B"|"C"|"D" }}
- "slide_type": "diagram_slide" or "content_slide"
- "is_metadata": boolean

Return ONLY the JSON object. No preamble, no markdown fences.

Extracted text from slide:
{text}
"""

SUMMARIZER_PROMPT = """\
Compress this university lecture into a focused study summary.
Keep: key definitions, formulas, relationships between concepts, worked examples.
Format as structured Markdown with headers per topic.
"""

DECK_QUIZ_PROMPT = """\
Based on this lecture summary, generate 5 multiple-choice questions that test
conceptual understanding.

Return a JSON array of question objects:
[{{ "question": str, "options": [A,B,C,D], "answer": "A"|"B"|"C"|"D",
   "explanation": str, "topics": [str] }}]

Return ONLY the JSON array.

Summary:
"""

PEDAGOGICAL_SLIDE_PROMPT = """\
Analyze this university lecture slide. 
You are provided with the slide's raw text and the LECTURE CONTEXT (pedagogical goal and previous concepts).

Your task is to generate a high-quality, ENHANCED educational experience.

Return a JSON object:
{{
  "title": "Pedagogical Concept-Aware Title",
  "content": "Enhanced and structured Markdown content. Reformat messy raw text into clear bullet points, add context where missing, and ensure pedagogical clarity.",
  "summary": "Brief summary explaining how this slide fits the overall lecture narrative.",
  "questions": [{{ "question": "...", "options": ["A", "B", "C", "D"], "answer": "A" }}],
  "slide_type": "content_slide",
  "is_metadata": false
}}

[LECTURE CONTEXT]
{context}

[SLIDE CONTENT]
{text}
"""

ENHANCE_PROMPT = """\
Enhance this university lecture slide content. 
Transform raw, potentially messy text into a high-quality, structured educational experience.

Rules:
- Add clear headers and bullet points.
- Fix typos and expand on technical abbreviations.
- Maintain academic rigor but improve student readability.

Return a JSON object:
{{
  "content": "Enhanced Markdown content here"
}}

[SLIDE CONTENT]
{text}
"""
