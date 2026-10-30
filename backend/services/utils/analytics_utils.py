"""
Analytics Utilities - Shared heuristics and calculations
"""
import hashlib
import hmac

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


def space_pseudonym(user_id: str, space_id: str, salt: str) -> tuple[str, str]:
    """A person's id and name inside one Space only.

    The same person is someone else in every Space, and without the salt the
    id never turns back into an account (unlike `generate_anon_name`, which
    is the same everywhere). Returns ``("p_<16 hex>", "<Theme>-<4 HEX>")``.
    """
    h = hmac.new(salt.encode(), f"{space_id}:{user_id}".encode(), hashlib.sha256).hexdigest()
    themes = ["Nexus", "Quantum", "Neural", "Prism", "Cortex", "Vector", "Logic", "Pulse"]
    return f"p_{h[:16]}", f"{themes[int(h[:2], 16) % len(themes)]}-{h[-4:].upper()}"
