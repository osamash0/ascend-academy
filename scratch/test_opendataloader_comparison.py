#!/usr/bin/env python3.11
"""
Side-by-side comparison: PyMuPDF vs opendataloader-pdf extraction.

Usage:
    python3.11 scratch/test_opendataloader_comparison.py /path/to/lecture.pdf

Outputs:
    scratch/comparison_output/pymupdf/     — per-page .txt files
    scratch/comparison_output/opendataloader/ — raw JSON + Markdown from opendataloader
    Console: per-page comparison table
"""
import sys
import os
import json
import tempfile
import shutil
import re
from enum import Enum
from typing import Tuple

# --- Dependency checks ---
try:
    import fitz
except ImportError:
    print("ERROR: PyMuPDF not found. Run: python3.11 -m pip install 'PyMuPDF==1.24.0'")
    sys.exit(1)

try:
    import opendataloader_pdf
except ImportError:
    print("ERROR: opendataloader-pdf not found. Run: python3.11 -m pip install 'opendataloader-pdf[hybrid]'")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Inline slide classifier (mirrors backend/services/slide_classifier.py)
# ---------------------------------------------------------------------------

class SlideType(Enum):
    TEXT = "text"
    TABLE = "table"
    DIAGRAM = "diagram"
    MIXED = "mixed"
    METADATA = "metadata"
    GARBAGE = "garbage"


def detect_garbage_text(text: str) -> Tuple[bool, float]:
    if not text:
        return True, 0.0
    clean_text = text.replace(" ", "").replace("\n", "")
    if len(clean_text) < 50:
        alpha_count = len(re.findall(r'[a-zA-Z]', clean_text))
        if alpha_count > len(clean_text) * 0.6:
            return False, alpha_count / len(clean_text) if clean_text else 0.0
    alpha_count = len(re.findall(r'[a-zA-Z]', text))
    digit_count = len(re.findall(r'\d', text))
    total = alpha_count + digit_count
    if total == 0:
        return (True, 0.0) if text.strip() else (False, 0.0)
    alpha_ratio = alpha_count / total
    is_garbage = alpha_ratio < 0.25 or bool(re.search(r'(\d{3,})\1+', clean_text))
    return is_garbage, alpha_ratio


def classify_page(page: fitz.Page) -> SlideType:
    text = page.get_text("text").strip()
    words = len(text.split())
    has_images = len(page.get_images(full=False)) > 0
    has_drawings = len(page.get_drawings()) > 15
    is_garbage, _ = detect_garbage_text(text)
    try:
        tables = page.find_tables()
        has_table = len(tables.tables) > 0 if tables else False
    except Exception:
        has_table = False

    if is_garbage and (has_images or has_drawings or words < 5):
        return SlideType.DIAGRAM
    if has_table:
        return SlideType.TABLE
    if (has_images or has_drawings) and words < 50:
        return SlideType.DIAGRAM
    if not is_garbage and words < 15:
        return SlideType.METADATA
    if (has_images or has_drawings) and words >= 50:
        return SlideType.MIXED
    if is_garbage:
        return SlideType.DIAGRAM
    return SlideType.TEXT


# ---------------------------------------------------------------------------
# PyMuPDF extraction
# ---------------------------------------------------------------------------

def extract_pymupdf(pdf_path: str):
    doc = fitz.open(pdf_path)
    pages = []
    for i, page in enumerate(doc):
        text = page.get_text("text").strip()
        slide_type = classify_page(page)
        is_garbage, alpha_ratio = detect_garbage_text(text)
        try:
            tables = page.find_tables()
            table_count = len(tables.tables) if tables else 0
        except Exception:
            table_count = 0
        pages.append({
            "page": i + 1,
            "text": text,
            "char_count": len(text),
            "word_count": len(text.split()),
            "slide_type": slide_type.value,
            "is_garbage": is_garbage,
            "alpha_ratio": round(alpha_ratio, 3),
            "table_count": table_count,
            "image_count": len(page.get_images(full=False)),
        })
    doc.close()
    return pages


# ---------------------------------------------------------------------------
# opendataloader-pdf extraction
# ---------------------------------------------------------------------------

def extract_opendataloader(pdf_path: str, out_dir: str):
    opendataloader_pdf.convert(
        input_path=[pdf_path],
        output_dir=out_dir,
        format="json,markdown",
        quiet=True,
        reading_order="xycut",
        markdown_page_separator="---PAGE %page-number%---",
    )

    # Find generated files
    pdf_stem = os.path.splitext(os.path.basename(pdf_path))[0]
    json_path = os.path.join(out_dir, pdf_stem + ".json")
    md_path = os.path.join(out_dir, pdf_stem + ".md")

    if not os.path.exists(json_path):
        # Search recursively
        for root, _, files in os.walk(out_dir):
            for f in files:
                if f.endswith(".json"):
                    json_path = os.path.join(root, f)
                if f.endswith(".md"):
                    md_path = os.path.join(root, f)

    pages = []
    if os.path.exists(json_path):
        with open(json_path) as f:
            data = json.load(f)
        pages = _parse_odl_json(data)
    else:
        print(f"  [WARN] JSON output not found at {json_path}")

    return pages, json_path, md_path


def _collect_elements(node: dict, page_map: dict):
    """Recursively collect all content-bearing elements into page_map[page_num]."""
    page_num = node.get("page number", 0)
    el_type = node.get("type", "unknown")
    content = node.get("content", "")

    if page_num not in page_map:
        page_map[page_num] = {"types": [], "texts": [], "table_count": 0}

    if el_type not in ("image", "header", "footer"):
        page_map[page_num]["types"].append(el_type)
    if content:
        page_map[page_num]["texts"].append(content)
    if el_type == "table":
        page_map[page_num]["table_count"] += 1

    # Recurse into list items (stored under "list items", not "kids")
    for item in node.get("list items", []):
        _collect_elements(item, page_map)
    # Recurse into generic kids
    for kid in node.get("kids", []):
        _collect_elements(kid, page_map)


def _parse_odl_json(data: dict) -> list:
    """Parse opendataloader JSON output into per-page summaries.

    Actual structure:
      { "kids": [ { "type": "heading", "page number": 1, "content": "...", ... }, ... ] }
    List elements carry children in "list items" (not "kids").
    """
    page_map: dict = {}
    for kid in data.get("kids", []):
        _collect_elements(kid, page_map)

    result = []
    for page_num in sorted(page_map.keys()):
        pg = page_map[page_num]
        full_text = "\n".join(pg["texts"])
        unique_types = list(dict.fromkeys(pg["types"]))
        result.append({
            "page": page_num,
            "text": full_text,
            "char_count": len(full_text),
            "word_count": len(full_text.split()),
            "element_types": unique_types,
            "table_count": pg["table_count"],
        })

    return result


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

def save_pymupdf_pages(pages: list, out_dir: str):
    os.makedirs(out_dir, exist_ok=True)
    for p in pages:
        fname = os.path.join(out_dir, f"page_{p['page']:03d}.txt")
        with open(fname, "w") as f:
            f.write(p["text"])


COLS = ["Page", "PyMuPDF chars", "ODL chars", "Δ chars", "PyMuPDF type", "ODL elements", "Tables (mupdf/odl)"]
COL_W = [5, 14, 10, 8, 14, 30, 18]


def _cell(val, width):
    s = str(val)
    return s[:width].ljust(width)


def print_table_header():
    row = " | ".join(_cell(c, w) for c, w in zip(COLS, COL_W))
    print(row)
    print("-" * len(row))


def print_page_row(mupdf: dict, odl: dict | None):
    if odl is None:
        odl = {"char_count": "N/A", "element_types": [], "table_count": "N/A"}

    delta = ""
    if isinstance(odl["char_count"], int):
        diff = odl["char_count"] - mupdf["char_count"]
        delta = f"+{diff}" if diff >= 0 else str(diff)

    elements_str = ", ".join(odl["element_types"][:4]) if odl["element_types"] else "—"
    tables_str = f"{mupdf['table_count']} / {odl['table_count']}"

    vals = [
        mupdf["page"],
        mupdf["char_count"],
        odl["char_count"],
        delta,
        mupdf["slide_type"],
        elements_str,
        tables_str,
    ]
    print(" | ".join(_cell(v, w) for v, w in zip(vals, COL_W)))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 2:
        print("Usage: python3.11 scratch/test_opendataloader_comparison.py <pdf_path>")
        sys.exit(1)

    pdf_path = sys.argv[1]
    if not os.path.exists(pdf_path):
        print(f"ERROR: File not found: {pdf_path}")
        sys.exit(1)

    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_root = os.path.join(project_root, "scratch", "comparison_output")
    pymupdf_out = os.path.join(out_root, "pymupdf")
    odl_out = os.path.join(out_root, "opendataloader")
    os.makedirs(odl_out, exist_ok=True)

    print(f"\n{'='*70}")
    print(f"PDF:  {os.path.basename(pdf_path)}")
    print(f"{'='*70}")

    # --- PyMuPDF ---
    print("\n[1/2] Extracting with PyMuPDF...")
    mupdf_pages = extract_pymupdf(pdf_path)
    save_pymupdf_pages(mupdf_pages, pymupdf_out)
    print(f"      {len(mupdf_pages)} pages extracted → {pymupdf_out}")

    # --- opendataloader ---
    print("[2/2] Extracting with opendataloader-pdf...")
    odl_pages, json_path, md_path = extract_opendataloader(pdf_path, odl_out)
    print(f"      {len(odl_pages)} pages extracted → {odl_out}")

    # --- Comparison table ---
    print(f"\n{'='*70}")
    print("PER-PAGE COMPARISON")
    print(f"{'='*70}")
    print_table_header()

    odl_by_page = {p["page"]: p for p in odl_pages}
    for mp in mupdf_pages:
        odl = odl_by_page.get(mp["page"])
        print_page_row(mp, odl)

    # --- Summary ---
    total_mupdf_chars = sum(p["char_count"] for p in mupdf_pages)
    total_odl_chars = sum(p["char_count"] for p in odl_pages if isinstance(p["char_count"], int))
    total_mupdf_tables = sum(p["table_count"] for p in mupdf_pages)
    total_odl_tables = sum(p["table_count"] for p in odl_pages if isinstance(p["table_count"], int))

    garbage_pages = [p["page"] for p in mupdf_pages if p["is_garbage"]]
    vision_pages = [p["page"] for p in mupdf_pages if p["slide_type"] in ("diagram", "mixed", "table")]

    print(f"\n{'='*70}")
    print("SUMMARY")
    print(f"{'='*70}")
    print(f"  Pages:              {len(mupdf_pages)}")
    print(f"  Total chars (PyMuPDF): {total_mupdf_chars:,}")
    print(f"  Total chars (ODL):     {total_odl_chars:,}  (Δ {total_odl_chars - total_mupdf_chars:+,})")
    print(f"  Tables detected:    PyMuPDF={total_mupdf_tables}  ODL={total_odl_tables}")
    print(f"  Garbage pages (PyMuPDF): {garbage_pages if garbage_pages else 'none'}")
    print(f"  Vision-routed pages:     {vision_pages if vision_pages else 'none'}")
    print(f"\n  Full outputs saved to:")
    print(f"    PyMuPDF text:  {pymupdf_out}/")
    if os.path.exists(json_path):
        print(f"    ODL JSON:      {json_path}")
    if os.path.exists(md_path):
        print(f"    ODL Markdown:  {md_path}")
    print()


if __name__ == "__main__":
    main()
