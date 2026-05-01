from enum import Enum
from typing import Tuple
import re
import fitz

class SlideType(Enum):
    TEXT = "text"          # Pure text, use fast extraction
    TABLE = "table"        # Contains structured data  
    DIAGRAM = "diagram"    # Charts, graphs, visualizations
    MIXED = "mixed"        # Text + diagrams
    METADATA = "metadata"  # Title, copyright
    GARBAGE = "garbage"    # Extraction failed, need vision
    TITLE = "title"        # Small text, likely a title (backward compat)

def detect_garbage_text(text: str) -> Tuple[bool, float]:
    """Detect if extracted text is garbage (numbers only, random chars)"""
    if not text:
        return True, 0.0
    
    # Clean text for analysis
    clean_text = text.replace(" ", "").replace("\n", "")
    
    # If text is short but looks like words, it's not garbage (likely a title)
    if len(clean_text) < 50:
        # Check if it contains mostly letters
        alpha_count = len(re.findall(r'[a-zA-Z]', clean_text))
        if alpha_count > len(clean_text) * 0.6:
            return False, alpha_count / len(clean_text) if len(clean_text) > 0 else 0.0

    # Count alphabetic characters vs numbers/symbols
    alpha_count = len(re.findall(r'[a-zA-Z]', text))
    digit_count = len(re.findall(r'\d', text))
    total_alpha_digit = alpha_count + digit_count
    
    if total_alpha_digit == 0:
        # Check if there are symbols at least
        if len(text.strip()) > 0:
            return True, 0.0
        return False, 0.0
    
    alpha_ratio = alpha_count / total_alpha_digit
    
    # High confidence garbage signals:
    # 1. Very low alpha ratio (mostly numbers/symbols)
    # 2. Repeating numeric patterns (e.g., "01230123")
    is_garbage = alpha_ratio < 0.25 or bool(re.search(r'(\d{3,})\1+', clean_text))
    
    return is_garbage, alpha_ratio

def classify_slide_with_routing(page: fitz.Page) -> SlideType:
    """
    Production routing decision with multiple signals.
    Priority: TABLES > DIAGRAMS > TEXT > METADATA
    """
    text = page.get_text("text").strip()
    words = len(text.split())
    # Only count images that cover >8% of the page — filters out logos/decorations
    page_area = page.rect.width * page.rect.height
    has_images = any(
        (b["bbox"][2] - b["bbox"][0]) * (b["bbox"][3] - b["bbox"][1]) / page_area > 0.08
        for b in page.get_text("dict")["blocks"]
        if b.get("type") == 1
    ) if page_area > 0 else False
    # Detect vector graphics (charts/diagrams often use these instead of bitmaps)
    has_drawings = len(page.get_drawings()) > 15 
    
    # First check: Is extracted text garbage?
    is_garbage, alpha_ratio = detect_garbage_text(text)
    
    # Second: Detect tables using PyMuPDF native
    try:
        tables = page.find_tables()
        has_table = len(tables.tables) > 0 if tables else False
    except:
        has_table = False
    
    # Routing decision tree
    
    # 1. Explicit Garbage (extraction failed) -> Force Vision
    if is_garbage and (has_images or has_drawings or words < 5):
        return SlideType.DIAGRAM
    
    # 2. Structured Tables
    if has_table:
        return SlideType.TABLE
    
    # 3. Visual content with low text density
    if (has_images or has_drawings) and words < 50:
        return SlideType.DIAGRAM
    
    # 4. Meta/Title slides (low word count but high quality text)
    if not is_garbage and words < 15:
        return SlideType.METADATA
    
    # 5. Mixed Content
    if (has_images or has_drawings) and words >= 50:
        return SlideType.MIXED
    
    # 6. Fallback for pure text or undetected content
    if is_garbage:
        return SlideType.DIAGRAM
        
    return SlideType.TEXT

def needs_vision(slide_type: SlideType) -> bool:
    """True if slide requires Vision Language Model"""
    return slide_type in (SlideType.DIAGRAM, SlideType.MIXED, SlideType.TABLE)

# Keep the original function for backward compatibility if needed by other services
def classify_slide(text: str, page: fitz.Page) -> SlideType:
    return classify_slide_with_routing(page)
