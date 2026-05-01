import logging
import json
from typing import Any
from .orchestrator import _llm_generate_text, parse_json_response, gemini_client, GEMINI_MODEL

logger = logging.getLogger(__name__)

def generate_analytics_insights(stats: dict, ai_model: str = "llama3") -> dict:
    prompt = f"""You are an expert educational analyst. Summarize these stats for a professor and give 3 suggestions:
Stats: {stats}
Return ONLY JSON: {{"summary": "...", "suggestions": ["...", "...", "..."]}}"""

    try:
        raw = _llm_generate_text(prompt, ai_model)
        return parse_json_response(raw)
    except Exception as e:
        logger.error("Analytics insights failed: %s", e)
        return {"summary": "Could not generate insights.", "suggestions": ["Review low-scoring slides.", "Engage inactive students."]}


def generate_metric_feedback(metric_name: str, metric_value: Any, context_stats: dict, ai_model: str = "llama3") -> str:
    prompt = f"""As a coach, give 1-2 sentence feedback on {metric_name} ({metric_value}). Context: {context_stats}"""
    try:
        return _llm_generate_text(prompt, ai_model)
    except Exception:
        return f"Metric {metric_name} is at {metric_value}."
