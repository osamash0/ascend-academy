"""
Analytics Utilities - Shared heuristics and calculations
"""
import hashlib
from typing import List, Dict, Any

def calculate_student_typology(prog_pct: int, score: int, ai_queries: int, revisions: int) -> str:
    """Centralized logic to classify student behavior based on engagement and performance."""
    if prog_pct < 50:
        return "Highly Confused (Seeking Help)" if ai_queries > 3 else "Disengaged (At Risk)"
    if score >= 80:
        return "The Reviser (High Effort)" if revisions > 3 else "Natural Comprehension"
    if score < 60:
        return "Struggling (Critical)"
    return "Standard"

def generate_anon_name(user_id: str) -> str:
    """Generate a creative, deterministic anonymous name for a student."""
    h = hashlib.md5(str(user_id).encode()).hexdigest()
    themes = ["Nexus", "Quantum", "Neural", "Prism", "Cortex", "Vector", "Logic", "Pulse"]
    theme = themes[int(h[:2], 16) % len(themes)]
    hex_id = h[-4:].upper()
    return f"{theme}-{hex_id}"
