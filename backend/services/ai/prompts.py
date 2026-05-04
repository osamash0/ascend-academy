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
- "questions": array with exactly ONE concept-testing MCQ shaped as:
    {{
      "question": string,
      "options": [A, B, C, D],
      "answer": "A"|"B"|"C"|"D",
      "explanation": "one sentence justifying why the correct option is right",
      "concept": "the specific concept being tested — use the Master Plan's proposed_title or one of its key concepts when present, otherwise the most important idea on the slide",
      "cognitive_level": "recall" | "apply" | "analyse"
    }}
- "slide_type": one of "content_slide", "diagram_slide", "title_slide"
- "is_metadata": false

Quiz quality rules (these matter — degenerate questions are rejected downstream):
- Default to "apply" or "analyse" cognitive_level. Only fall back to "recall" when the slide is genuinely thin (a definition card, a heading-only slide).
- The question must test understanding of the chosen "concept", not the surface text of the slide. Avoid "What does this slide say?" / "Which of these is mentioned?" framings.
- All four options must be plausible distractors of similar length and specificity. Wrong answers should reflect realistic student misconceptions about the concept, not random unrelated facts.
- NEVER use "all of the above", "none of the above", "both A and B", or any equivalent. Each option must be a standalone claim.
- No option may be a substring of another, and the correct answer must not be obviously longer or more qualified than the distractors.
- "explanation" is exactly one sentence and references the concept (not the option letter).

General rules:
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

Rules:
- NEVER use "all of the above" / "none of the above".
- Each option is a standalone claim of similar length and specificity.
- "explanation" is one sentence justifying the correct option.

Return ONLY the JSON array.

Summary:
"""

CROSS_SLIDE_DECK_QUIZ_PROMPT = """\
You are designing a 5-question quiz that tests how well a student has connected
ideas ACROSS this lecture — not whether they can recall a single slide.

Cross-slide concepts to target (cover them with priority, in order):
{cross_concepts}

Per-section key takeaways (use these as the "ground truth" the questions must
respect):
{section_takeaways}

Slide map (0-based slide index → proposed title):
{slide_titles}

Slide-to-prerequisite bridges (the planner has already identified which earlier
slides each slide depends on — USE THESE PAIRS as your starting point for
"linked_slides"; a question that bridges slide N and any of its
related_previous_slides is the kind we want):
{slide_bridges}

Lecture summary (for narrative context only — do NOT base questions purely on
this paraphrase):
{summary}

Strict requirements:
1. Produce exactly 5 multiple-choice questions.
2. EVERY question must require understanding at least TWO different slides to
   answer correctly. Set "linked_slides" to the 0-based indices of those
   slides; the array MUST have length >= 2 and the indices must come from the
   slide map above. Prefer pairs that appear in the slide-to-prerequisite
   bridges section — those are the connections the planner flagged as
   pedagogically important.
3. Phrase each question so a student who only read one of the linked slides
   would plausibly pick a wrong option.
4. Each question targets exactly one cross-slide concept; reuse the wording
   from the "Cross-slide concepts" list when possible and put it in "concept".
5. Each question has 4 plausible distractors of similar length and specificity.
   NEVER use "all of the above" / "none of the above" / "both A and B".
   No option may be a substring of another.
6. "explanation" is exactly one sentence and explicitly mentions HOW the
   linked slides combine to yield the correct answer.

Return ONLY a JSON array, no preamble. Each element:
{{
  "question": str,
  "options": [str, str, str, str],
  "answer": "A"|"B"|"C"|"D",
  "explanation": str,
  "linked_slides": [int, int, ...],
  "concept": str
}}
"""

BATCH_SLIDE_QUIZ_REGEN_PROMPT = """\
You previously generated multiple-choice questions for the slides below, but
some questions were rejected because they violated quiz quality rules
(duplicate options, "all of the above"/"none of the above", an option that is
a substring of another, missing answer, or fewer than 4 options).

Regenerate ONLY a fresh single MCQ for each slide listed below. Each new
question must obey the same rules:
- Default to "apply" or "analyse" cognitive_level. Use "recall" only when the
  slide is genuinely thin (a definition card, a heading-only slide).
- The question tests the chosen "concept", not the surface text of the slide.
- All four options are plausible distractors of similar length and specificity.
- NEVER "all of the above", "none of the above", "both A and B", etc.
- No option is a substring of another, and the correct answer is not obviously
  longer than the distractors.
- "explanation" is exactly one sentence justifying the correct option.

Return a JSON array — one object per slide below, in the same order:
{{
  "page_number": int,
  "questions": [
    {{
      "question": string,
      "options": [A, B, C, D],
      "answer": "A"|"B"|"C"|"D",
      "explanation": string,
      "concept": string,
      "cognitive_level": "recall"|"apply"|"analyse"
    }}
  ]
}}

Return ONLY the JSON array, no preamble.

Slides to regenerate quizzes for:
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
