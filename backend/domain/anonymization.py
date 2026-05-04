"""
Anonymization domain — deterministic, privacy-safe user ID masking.
Extracted from analytics_service.py so it can be reused and tested in isolation.
"""
import hashlib


_THEMES = ["Nexus", "Quantum", "Neural", "Prism", "Cortex", "Vector", "Logic", "Pulse"]


def pseudonymize_user_id(user_id: str) -> str:
    """Return a creative, deterministic anonymous name for a user ID.

    The same user_id always maps to the same name (no salt) so that analytics
    can still correlate rows across queries without exposing the real ID.
    """
    h = hashlib.md5(str(user_id).encode()).hexdigest()
    theme = _THEMES[int(h[:2], 16) % len(_THEMES)]
    hex_suffix = h[-4:].upper()
    return f"{theme}-{hex_suffix}"
