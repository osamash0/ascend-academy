import re
from typing import Dict, List, Tuple
import fitz

class LayoutDetector:
    """Fast, heuristic-based layout detection (no ML dependency)"""
    
    @staticmethod
    def detect_table_candidates(page: fitz.Page) -> List[Dict]:
        """Find potential table regions using line detection and text alignment"""
        # Detect horizontal and vertical lines using PyMuPDF native methods
        try:
            tables = page.find_tables()
            if tables and tables.tables:
                return [{"bbox": table.bbox, "type": "table"} for table in tables.tables]
        except Exception:
            pass
        return []
        
    @staticmethod  
    def detect_figure_regions(page: fitz.Page) -> List[Dict]:
        """Find image/vector graphic regions"""
        images = page.get_images(full=True)
        image_info = page.get_image_info(hashes=False)
        return [{"bbox": img["bbox"], "type": "figure"} for img in image_info]
        
    @staticmethod
    def analyze_text_density(page: fitz.Page) -> Dict:
        """Calculate text density per region to identify garbage vs real text"""
        text = page.get_text("text").strip()
        if not text:
            return {"density": 0.0, "is_empty": True}
        
        # Simple density: characters per unit area (approximated)
        rect = page.rect
        area = rect.width * rect.height
        char_count = len(text)
        
        return {
            "density": char_count / area if area > 0 else 0,
            "is_empty": False,
            "char_count": char_count
        }
