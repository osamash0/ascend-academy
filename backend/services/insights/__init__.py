"""Professor analytics insight engine.

Turns the existing per-lecture analytics aggregates into a ranked feed of
typed, plain-language *insights* — the data behind the "Insight Garden" UI.

Public entry point: :func:`engine.build_insights`.
"""
from backend.services.insights.engine import build_insights

__all__ = ["build_insights"]
