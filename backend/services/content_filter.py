"""
3-Layer Slide Content Filtering Pipeline
=========================================
Determines whether a lecture slide contains educational content or administrative
metadata (title slides, professor contact info, exam dates, etc.).

Layer 1: Fast Heuristic Pre-Filter  (~1ms, zero cost)
Layer 2: Information Density Score   (~5ms, zero cost)
Layer 3: LLM-as-a-Judge             (only for ambiguous cases, ~5-10% of slides)
"""

import re
import json
import logging
from pydantic import BaseModel
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Metadata-indicator keyword patterns (case-insensitive)
_METADATA_KEYWORDS_EN = [
    r"\binstructor\b", r"\bprofessor\b", r"\blecturer\b", r"\bteaching assistant\b",
    r"\bta\b", r"\boffice hours?\b", r"\bcontact\b", r"\be[-.]?mail\b",
    r"\bphone\b", r"\btelephone\b",
    r"\bexam\b", r"\bmidterm\b", r"\bfinal exam\b", r"\bgrading\b",
    r"\bsyllabus\b", r"\bcourse (overview|outline|policy|description)\b",
    r"\bprerequisites?\b", r"\btextbook\b", r"\breading list\b",
    r"\bdeadline\b", r"\bdue date\b", r"\bassignment due\b", r"\bsubmission\b",
    r"\btable of contents\b", r"\bagenda\b", r"\boutline\b", r"\boverview\b",
    r"\bthank you\b", r"\bthanks\b", r"\bquestions\s*\??\b",
    r"\breferences?\b", r"\bbibliography\b", r"\bcredits?\b",
    r"\backnowledge?ments?\b", r"\bappendix\b",
    r"\buniversity\b", r"\bdepartment\b", r"\bfaculty\b", r"\bschool of\b",
    r"\bcollege of\b", r"\binstitute\b",
    r"\blecture\s+\d+\b", r"\bweek\s+\d+\b", r"\bsession\s+\d+\b",
    r"\bwelcome\s+to\b",
]

_METADATA_KEYWORDS_DE = [
    r"\bprofessor\b", r"\bdozent(?:in)?\b", r"\blehrbeauftragte[r]?\b",
    r"\bsprechstunde\b", r"\bkontakt\b", r"\btelefon\b",
    r"\bklausur\b", r"\bprüfung\b", r"\bnotengebung\b", r"\bbewertung\b",
    r"\bvorlesung\s+\d+\b", r"\bsitzung\s+\d+\b",
    r"\buniversität\b", r"\bfachbereich\b", r"\bfakultät\b", r"\binstitut\b",
    r"\babgabe\b", r"\bfrist\b", r"\btermin\b",
    r"\binhaltsverzeichnis\b", r"\büberblick\b", r"\bgliederung\b",
    r"\bvielen dank\b", r"\bfragen\s*\??\b",
    r"\bliteratur\b", r"\bquellenverzeichnis\b",
    r"\bwillkommen\b",
]

# Email pattern
_EMAIL_PATTERN = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")

# Date patterns (DD.MM.YYYY, DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, Month DD YYYY)
_DATE_PATTERNS = [
    re.compile(r"\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b"),
    re.compile(r"\b\d{4}-\d{1,2}-\d{1,2}\b"),
    re.compile(
        r"\b(?:January|February|March|April|May|June|July|August|September|"
        r"October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)"
        r"\s+\d{1,2},?\s+\d{4}\b",
        re.IGNORECASE,
    ),
]

# URL pattern
_URL_PATTERN = re.compile(r"https?://\S+|www\.\S+")

# Stop words for density calculation (common English + German function words)
_STOP_WORDS = frozenset(
    # English
    "a an the is are was were be been being have has had do does did will would "
    "shall should may might can could of in to for on with at by from as into "
    "through during before after above below between under again further then "
    "once here there when where why how all each every both few more most other "
    "some such no nor not only own same so than too very and but or if while "
    "about against because until that this these those it its he she they them "
    "their his her we our you your what which who whom "
    # German
    "der die das ein eine einer eines einem einen ist sind war waren wird werden "
    "hat haben hatte hatten kann können konnte konnten soll sollen sollte sollten "
    "muss müssen musste mussten darf dürfen durfte durften mag mögen mochte mochten "
    "will wollen wollte wollten und oder aber wenn weil dass ob als wie auch noch "
    "schon nur nicht kein keine keiner keines keinem von zu für mit auf an in aus "
    "bei nach über unter vor zwischen durch um ohne gegen bis seit dem den des zum "
    "zur im am vom beim ins ans es er sie wir ihr ich du man sich hier dort da "
    "dann wann wo wie was wer wen wem dessen deren".split()
)

# Boilerplate-only slide patterns (if the ENTIRE slide matches one of these)
_BOILERPLATE_FULL_PATTERNS = [
    re.compile(r"^\s*(thank\s*you|thanks|vielen\s*dank|danke)\s*[.!]?\s*$", re.IGNORECASE),
    re.compile(r"^\s*(questions?\s*\??|fragen\s*\??|any\s+questions?\s*\??)\s*$", re.IGNORECASE),
    re.compile(r"^\s*(end|the\s+end|fin|ende)\s*[.!]?\s*$", re.IGNORECASE),
]


# ---------------------------------------------------------------------------
# Pydantic schema for LLM structured output (Layer 3)
# ---------------------------------------------------------------------------

class SlideClassification(BaseModel):
    classification: str   # "educational" or "metadata"
    confidence: float     # 0.0 to 1.0
    reason: str           # brief explanation


# ---------------------------------------------------------------------------
# Layer 1: Fast Heuristic Pre-Filter
# ---------------------------------------------------------------------------

def _heuristic_check(text: str, slide_index: int, total_slides: int) -> str:
    """
    Returns 'metadata', 'educational', or 'uncertain'.
    """
    clean = text.strip()

    # --- Full-slide boilerplate check ---
    for pat in _BOILERPLATE_FULL_PATTERNS:
        if pat.match(clean):
            return "metadata"

    words = clean.split()
    word_count = len(words)

    # Very short slide => metadata
    if word_count < 15:
        return "metadata"

    # No extractable text placeholder
    if "[No extractable text" in clean:
        return "metadata"

    lower = clean.lower()

    # --- Count metadata signals ---
    signal_count = 0

    # Email
    if _EMAIL_PATTERN.search(clean):
        signal_count += 2  # emails are a strong signal

    # Dates
    for dp in _DATE_PATTERNS:
        if dp.search(clean):
            signal_count += 1
            break

    # URLs (non-educational links like university homepages)
    if _URL_PATTERN.search(clean):
        signal_count += 1

    # Metadata keywords
    all_keywords = _METADATA_KEYWORDS_EN + _METADATA_KEYWORDS_DE
    for kw_pattern in all_keywords:
        if re.search(kw_pattern, lower):
            signal_count += 1

    # Positional bonus: first or last 2 slides are more likely metadata
    if slide_index <= 1 or slide_index >= total_slides - 2:
        signal_count += 1

    # --- Decision ---
    if signal_count >= 3 and word_count < 60:
        return "metadata"

    if signal_count >= 5 and word_count < 100:
        return "metadata"

    if signal_count == 0 and word_count > 80:
        return "educational"

    if signal_count <= 1 and word_count > 120:
        return "educational"

    return "uncertain"


# ---------------------------------------------------------------------------
# Layer 2: Information Density Score
# ---------------------------------------------------------------------------

def _compute_content_density(text: str) -> float:
    """
    Returns a content density score between 0.0 and 1.0.
    Lower = more likely metadata; Higher = more likely educational.
    """
    words = re.findall(r"[a-zA-ZäöüÄÖÜß]{2,}", text.lower())

    if not words:
        return 0.0

    total = len(words)

    # Content words = words NOT in stop words and NOT pure metadata keywords
    content_words = [w for w in words if w not in _STOP_WORDS]
    content_count = len(content_words)

    # Unique word ratio — metadata slides tend to have very few unique words
    unique_count = len(set(words))
    unique_ratio = unique_count / total if total > 0 else 0

    # Length factor — penalize very short slides
    length_factor = min(1.0, total / 40.0)

    # Content word ratio
    content_ratio = content_count / total if total > 0 else 0

    # Final density score
    density = content_ratio * unique_ratio * length_factor

    return round(density, 4)


# ---------------------------------------------------------------------------
# Layer 3: LLM-as-a-Judge
# ---------------------------------------------------------------------------

def _llm_classify_slide(text: str, ai_model: str = "gemini-1.5-flash") -> dict:
    """
    Uses the LLM to classify a slide as educational or metadata.
    Only called for ambiguous cases (~5-10% of slides).
    Returns {"classification": "educational"|"metadata", "confidence": float, "reason": str}
    """
    prompt = f"""Classify this lecture slide text as either "educational" or "metadata".

- "educational": contains concepts, definitions, explanations, formulas, examples, 
  proofs, algorithms, or any substantive learning material that a student should study.
- "metadata": contains mainly administrative info like instructor details, contact info, 
  dates, logistics, grading policy, table of contents, acknowledgements, "thank you", 
  "questions?", or course overview without educational substance.

Slide text:
{text[:2000]}"""

    if ai_model == "groq":
        try:
            from backend.services.ai_service import groq_client, GROQ_MODEL
            if groq_client:
                groq_prompt = prompt + """\nReturn ONLY valid JSON with this exact structure:\n{\n  "classification": "...",\n  "confidence": 0.0,\n  "reason": "..."\n}"""
                res = groq_client.chat.completions.create(
                    model=GROQ_MODEL,
                    messages=[{"role": "user", "content": groq_prompt}],
                    response_format={"type": "json_object"}
                )
                return json.loads(res.choices[0].message.content)
        except Exception as e:
            logger.error("Groq classify error: %s", e, exc_info=True)

    elif ai_model == "gemini-1.5-flash" or ai_model == "gemini-2.5-flash":
        try:
            from backend.services.ai_service import gemini_client, GEMINI_MODEL
            from google.genai import types
            if gemini_client:
                res = gemini_client.models.generate_content(
                    model=GEMINI_MODEL,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=SlideClassification,
                    ),
                )
                return json.loads(res.text)
        except Exception as e:
            logger.error("LLM classify error: %s", e, exc_info=True)

    # Fallback: if LLM fails, assume educational (safe default)
    return {
        "classification": "educational",
        "confidence": 0.5,
        "reason": "LLM classification unavailable, defaulting to educational.",
    }


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def is_metadata_slide(
    text: str,
    slide_index: int = 0,
    total_slides: int = 1,
    ai_model: str = "gemini-1.5-flash",
) -> dict:
    """
    Runs the 3-layer filtering pipeline to determine if a slide is metadata.

    Returns:
        {
            "is_metadata": bool,
            "confidence": float (0.0-1.0),
            "reason": str,
            "layer": int (1, 2, or 3)
        }
    """
    # --- Layer 1: Fast Heuristic ---
    heuristic_result = _heuristic_check(text, slide_index, total_slides)

    if heuristic_result == "metadata":
        return {
            "is_metadata": True,
            "confidence": 0.90,
            "reason": "Heuristic: matched metadata patterns (keywords, emails, dates, short text).",
            "layer": 1,
        }

    if heuristic_result == "educational":
        return {
            "is_metadata": False,
            "confidence": 0.90,
            "reason": "Heuristic: rich content with no metadata signals.",
            "layer": 1,
        }

    # --- Layer 2: Information Density Score ---
    density = _compute_content_density(text)

    if density < 0.25:
        return {
            "is_metadata": True,
            "confidence": 0.80,
            "reason": f"Low content density ({density}): sparse vocabulary or mostly function words.",
            "layer": 2,
        }

    if density > 0.45:
        return {
            "is_metadata": False,
            "confidence": 0.80,
            "reason": f"High content density ({density}): rich educational vocabulary.",
            "layer": 2,
        }

    # --- Layer 3: LLM-as-a-Judge (only for truly ambiguous cases) ---
    llm_result = _llm_classify_slide(text, ai_model=ai_model)

    is_meta = llm_result.get("classification", "educational") == "metadata"
    return {
        "is_metadata": is_meta,
        "confidence": llm_result.get("confidence", 0.5),
        "reason": f"LLM judge: {llm_result.get('reason', 'no reason provided')}",
        "layer": 3,
    }
