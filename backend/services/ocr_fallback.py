import io
from PIL import Image
import pytesseract
from typing import Optional, Tuple

class OCRFallback:
    """Lightweight OCR for slides that need it - no heavy models"""
    
    @staticmethod
    async def extract_text_from_region(image_bytes: bytes, bbox: Optional[Tuple] = None) -> str:
        """Extract text from image region using Tesseract (dispatched to thread)"""
        import asyncio
        return await asyncio.to_thread(OCRFallback._sync_extract_text, image_bytes, bbox)

    @staticmethod
    def _sync_extract_text(image_bytes: bytes, bbox: Optional[Tuple] = None) -> str:
        try:
            image = Image.open(io.BytesIO(image_bytes))
            if bbox:
                image = image.crop(bbox)
            
            custom_config = r'--oem 3 --psm 6 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,:;()[]{}<>!?@#$%^&*+-/= '
            return pytesseract.image_to_string(image, config=custom_config).strip()
        except Exception as e:
            print(f"OCR failed: {e}")
            return ""
    
    @staticmethod
    async def extract_tables_from_image(image_bytes: bytes) -> Optional[str]:
        """Attempt table extraction using PaddleOCR (dispatched to thread)"""
        import asyncio
        return await asyncio.to_thread(OCRFallback._sync_extract_tables, image_bytes)

    @staticmethod
    def _sync_extract_tables(image_bytes: bytes) -> Optional[str]:
        try:
            from paddleocr import PPStructure
            import pandas as pd
            import numpy as np
            from PIL import Image

            table_engine = PPStructure(show_log=False, layout=False, table=True)
            img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            img_array = np.array(img)
            
            result = table_engine(img_array)
            table_md_parts = []
            for res in result:
                if res['type'] == 'table':
                    html = res['res'].get('html')
                    if html:
                        try:
                            df_list = pd.read_html(io.StringIO(html))
                            if df_list:
                                table_md_parts.append(df_list[0].to_markdown(index=False))
                        except Exception: pass
            
            if table_md_parts:
                return "\n\n".join(table_md_parts)
            
            # Synchronous fallback
            return OCRFallback._sync_extract_text(image_bytes)

        except (ImportError, Exception):
            return OCRFallback._sync_extract_text(image_bytes)
