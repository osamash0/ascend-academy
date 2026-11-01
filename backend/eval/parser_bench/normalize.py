"""Images become one plain marker for every method (spec: judge content, not pictures)."""
import re

FIGURE = "[figure]"
_IMAGES = (
    re.compile(r"!\[[^\]]*\]\([^)]*\)"),
    re.compile(r"<img\b[^>]*>", re.I),
    re.compile(r"<!--\s*image\s*-->", re.I),
)


def normalize_figures(text: str) -> str:
    for pattern in _IMAGES:
        text = pattern.sub(FIGURE, text)
    return text
