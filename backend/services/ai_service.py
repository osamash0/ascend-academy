"""
AI Service (Legacy Wrapper)
This file re-exports functions from the modular backend/services/ai/ directory.
New code should ideally import from specialized modules.
"""

from .ai.orchestrator import (
    gemini_client, groq_client, cerebras_client, openrouter_client, cloudflare_client, ollama,
    OLLAMA_MODEL, GEMINI_MODEL, GROQ_MODEL, GROQ_FAST_MODEL, GROQ_VISION_MODEL, CEREBRAS_MODEL,
    enhance_slide_content, generate_summary, generate_quiz, generate_slide_title,
    process_slide_batch, batch_analyze_text_slides, generate_text_bulk,
    generate_deck_summary, generate_deck_quiz, safe_truncate_text,
    _VISION_SLIDE_TYPES_METADATA, _rotator,
)
from .ai.vision import analyze_slide_vision, analyze_diagram_slide, format_slide_content
from .ai.embeddings import generate_embeddings
from .ai.audio import generate_speech
from .ai.mind_map import generate_mind_map
from .ai.analytics import generate_analytics_insights, generate_metric_feedback
from .ai.tutor import chat_with_lecture

# Maintain safe_truncate_text availability for any direct callers
__all__ = [
    "enhance_slide_content", "analyze_slide_vision", "analyze_diagram_slide",
    "format_slide_content", "process_slide_batch", "generate_summary", 
    "generate_quiz", "generate_slide_title", "generate_analytics_insights",
    "generate_metric_feedback", "chat_with_lecture", "generate_speech",
    "generate_mind_map", "batch_analyze_text_slides", "generate_deck_summary",
    "generate_deck_quiz", "generate_embeddings", "safe_truncate_text"
]
