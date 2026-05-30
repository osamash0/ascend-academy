import fitz
import re

def extract_visual_title(page: fitz.Page) -> str:
    """Heuristic title extraction from PyMuPDF layout.

    Strategy:
    - Only look in the top 35% of the page (titles live near the top).
    - Score by font size + bold + position.
    - Only merge continuation lines that share the same font size (±1pt).
    - Never merge more than 3 lines to avoid pulling in bullet points.
    """
    try:
        blocks = page.get_text("dict")["blocks"]
    except Exception:
        return ""

    height = page.rect.height
    candidates = []

    for b in blocks:
        if "lines" not in b:
            continue
        for line in b["lines"]:
            for s in line["spans"]:
                txt = s["text"].strip()
                # Skip very short, purely numeric, or bullet-like spans
                if len(txt) < 3 or re.match(r'^[\d\s\.\-\•\·]+$', txt):
                    continue

                y_pos = s["origin"][1]
                # Only the top 35% of the page
                if y_pos > height * 0.35:
                    continue

                is_bold = "bold" in s["font"].lower() or bool(s["flags"] & 16)
                # Stronger position boost for very top (< 15%)
                pos_boost = 1.6 if y_pos < height * 0.15 else 1.2 if y_pos < height * 0.25 else 1.0
                bold_boost = 1.25 if is_bold else 1.0

                candidates.append({
                    "text": txt,
                    "size": s["size"],
                    "score": s["size"] * pos_boost * bold_boost,
                    "y": y_pos,
                })

    if not candidates:
        return ""

    candidates.sort(key=lambda x: x["score"], reverse=True)
    best = candidates[0]

    # Merge only lines that are immediately below and share the same font size (±1pt)
    title_parts = [best["text"]]
    last_y = best["y"]
    for c in candidates[1:]:
        if len(title_parts) >= 3:
            break
        same_size = abs(c["size"] - best["size"]) <= 1.0
        next_line = 0 < (c["y"] - last_y) < (best["size"] * 1.6)
        if same_size and next_line:
            title_parts.append(c["text"])
            last_y = c["y"]

    full_title = " ".join(title_parts)
    full_title = re.sub(r'^\d+[\s.\-]+', '', full_title)   # strip leading "1. "
    full_title = re.sub(r'\s+', ' ', full_title).strip(": ")

    return full_title[:120] if full_title else ""
