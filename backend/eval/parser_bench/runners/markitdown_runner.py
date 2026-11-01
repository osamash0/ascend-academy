"""`markitdown`: Microsoft MarkItDown, default settings, one page at a time,
because a whole-document conversion marks no page boundaries. pypdf splits the pages.

Usage: python -I markitdown_runner.py <in.pdf> <out.json>
"""
import json
import os
import sys
import tempfile
from importlib.metadata import version


def main(argv: list) -> None:
    from markitdown import MarkItDown
    from pypdf import PdfReader, PdfWriter

    src, out = argv[1], argv[2]
    converter = MarkItDown()
    pages = {}
    with tempfile.TemporaryDirectory() as tmp:
        for n, page in enumerate(PdfReader(src).pages, start=1):
            single = os.path.join(tmp, f"p{n}.pdf")
            writer = PdfWriter()
            writer.add_page(page)
            with open(single, "wb") as f:
                writer.write(f)
            pages[str(n)] = converter.convert(single).text_content
    result = {
        "version": version("markitdown"),
        "settings": {"per_page": True, "splitter": f"pypdf {version('pypdf')}"},
        "pages": pages,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv)
