import logging
from typing import Any, Dict, List, Union
from .orchestrator import generate_text, parse_json_response

logger = logging.getLogger(__name__)

async def generate_analytics_insights(stats: Dict[str, Any], ai_model: str = "llama3") -> Dict[str, Any]:
    """
    Analyzes lecture performance statistics and generates actionable insights for professors.
    """
    prompt = f"""You are an expert educational data analyst. 
Summarize these lecture statistics for a professor and provide 3 specific pedagogical suggestions for improvement.
Stats: {stats}
Return ONLY valid JSON: {{"summary": "...", "suggestions": ["...", "...", "..."]}}"""

    try:
        raw = await generate_text(prompt, ai_model)
        return parse_json_response(raw)
    except Exception as e:
        logger.error("AI Analytics insights failed: %s", e)
        return {
            "summary": "Could not generate automated insights at this time.", 
            "suggestions": [
                "Focus on slides with high dropout rates.", 
                "Review student feedback on quiz clarity.", 
                "Compare these metrics with historical averages."
            ]
        }


async def generate_slide_recommendation(
    *,
    slide_title: str,
    slide_text: str,
    drop_off_rate: float,
    confusion_rate: float,
    quiz_success_rate: float | None,
    view_count: int,
    reasons: List[str],
    ai_model: str = "cerebras",
) -> str:
    """Return a 1–3 sentence pedagogical improvement tip for a problematic slide.

    Always falls back to a deterministic message if the LLM call errors so
    the UI degrades gracefully without leaking stack traces.
    """
    snippet = (slide_text or "").strip().replace("\n", " ")
    if len(snippet) > 1200:
        snippet = snippet[:1200] + "…"

    quiz_str = (
        f"{quiz_success_rate:.0f}%" if isinstance(quiz_success_rate, (int, float))
        else "no quiz data"
    )
    reasons_str = ", ".join(reasons) if reasons else "general weak signals"

    prompt = f"""You are an instructional design coach helping a professor improve a single lecture slide.

Slide title: {slide_title}
Slide content: {snippet or '(no extracted text)'}
Metrics:
- Views: {view_count}
- Drop-off rate: {drop_off_rate:.0f}%
- Confusion rate: {confusion_rate:.0f}%
- Quiz success rate: {quiz_str}
Detected issues: {reasons_str}

Write 1–3 short sentences (max ~70 words) of concrete, actionable advice the professor can apply
to this specific slide (e.g., split into two slides, add a worked example, simplify the diagram,
rewrite the quiz prompt). Do NOT restate the metrics. Plain text only — no markdown, no lists."""

    try:
        text = await generate_text(prompt, ai_model)
        text = (text or "").strip()
        if not text:
            raise ValueError("empty LLM response")
        return text
    except Exception as e:
        logger.error("Slide recommendation generation failed: %s", e)
        return (
            "Consider breaking this slide into smaller chunks and adding a worked "
            "example before the quiz so students can practice the concept in context."
        )


async def generate_metric_feedback(
    metric_name: str, 
    metric_value: Union[int, float, str], 
    context_stats: Dict[str, Any], 
    ai_model: str = "llama3"
) -> str:
    """
    Generates personalized, brief feedback for a specific performance metric.
    """
    prompt = f"""As an educational coach, provide a brief (1-2 sentences) feedback on the metric '{metric_name}' which is currently '{metric_value}'. 
Use the following context to make it relevant: {context_stats}"""
    
    try:
        return await generate_text(prompt, ai_model)
    except Exception as e:
        logger.error("Metric feedback generation failed: %s", e)
        return f"The {metric_name} metric is currently {metric_value}."
