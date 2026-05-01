import fitz
import re

def extract_visual_title(page: fitz.Page) -> str:
    """
    Analyzes the visual layout of a PDF page to find the most likely title.
    - Merges adjacent spans with similar font sizes.
    - Prioritizes large, bold text at the top.
    - Handles multi-line titles.
    """
    try:
        blocks = page.get_text("dict")["blocks"]
    except Exception:
        return ""

    candidates = []
    for b in blocks:
        if "lines" not in b: continue
        for l in b["lines"]:
            for s in l["spans"]:
                txt = s["text"].strip()
                if len(txt) < 2 or txt.isdigit(): continue
                
                # Only consider text in the top 80%
                y_pos = s["origin"][1]
                if y_pos > (page.rect.height * 0.8): continue

                # Score: Font size is king. 
                # Position boost: text at the very top (y < 15% height) gets 1.5x
                # Bold boost: 1.3x
                is_bold = "bold" in s["font"].lower() or (s["flags"] & 16)
                pos_boost = 1.5 if y_pos < (page.rect.height * 0.15) else 1.0
                bold_boost = 1.3 if is_bold else 1.0
                
                score = s["size"] * pos_boost * bold_boost
                
                candidates.append({
                    "text": txt,
                    "size": s["size"],
                    "score": score,
                    "y": y_pos,
                    "x": s["origin"][0]
                })
    
    if not candidates:
        return ""
        
    # Sort by score descending
    candidates.sort(key=lambda x: x["score"], reverse=True)
    
    # Pick the top candidate and see if we can find its continuation on the same/next line
    best = candidates[0]
    title_parts = [best["text"]]
    
    # Simple merger: find other candidates with similar score/y that are "near"
    # Or just find the next line if it's right below and has similar size
    for c in candidates[1:]:
        # If it's on a subsequent line (y is slightly larger) but very close
        if 0 < (c["y"] - best["y"]) < (best["size"] * 1.5):
            # And it has a decent size relative to best
            if c["size"] > (best["size"] * 0.7):
                title_parts.append(c["text"])
                # Update best Y to follow the flow
                best["y"] = c["y"]

    full_title = " ".join(title_parts)
    
    # Clean up
    full_title = re.sub(r'^\d+[\s.]+', '', full_title) # "1. Intro" -> "Intro"
    full_title = re.sub(r'\s+', ' ', full_title).strip(": ")
    
    return full_title if len(full_title) < 120 else full_title[:117] + "..."
