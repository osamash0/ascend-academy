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
