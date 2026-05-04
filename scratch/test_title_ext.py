import fitz
import sys

def extract_visual_title(page):
    """
    Tries to find the most likely title of a slide based on font size and position.
    """
    blocks = page.get_text("dict")["blocks"]
    spans = []
    for b in blocks:
        if "lines" in b:
            for l in b["lines"]:
                for s in l["spans"]:
                    # Clean text and skip small/empty spans
                    txt = s["text"].strip()
                    if len(txt) > 2:
                        spans.append({
                            "text": txt,
                            "size": s["size"],
                            "y": s["origin"][1]
                        })
    
    if not spans:
        return None
        
    # Sort by size (descending) and then by y-position (ascending)
    # We prefer large text that is higher up on the page
    spans.sort(key=lambda x: (-x["size"], x["y"]))
    
    # Take the top one
    best = spans[0]["text"]
    
    # If the text is very long, it might be a paragraph that happens to have a large font
    # (unlikely for a title, but safety first)
    if len(best) > 100:
        best = best[:97] + "..."
        
    return best

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scratch_fitz.py <pdf_path>")
        sys.exit(1)
        
    doc = fitz.open(sys.argv[1])
    for i, page in enumerate(doc):
        title = extract_visual_title(page)
        print(f"Slide {i+1}: {title}")
    doc.close()
