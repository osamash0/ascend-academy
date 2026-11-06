"""`pymupdf4llm`: the Markdown mode of PyMuPDF, one chunk per page, default settings.

Exits non-zero, writing nothing, when it does not return exactly one chunk per
page of the PDF: a partial result must never be scored as pymupdf4llm's result.

Usage: python -I pymupdf4llm_runner.py <in.pdf> <out.json>
"""
import json
import sys
from importlib.metadata import version


def pages_from_chunks(chunks: list, page_count: int) -> dict:
    """{"1": text, ..., "N": text} from the page chunks; ValueError unless there are exactly page_count."""
    if len(chunks) != page_count:
        raise ValueError(f"{len(chunks)} chunks for a PDF of {page_count} pages")
    return {str(n): chunk["text"] for n, chunk in enumerate(chunks, start=1)}


def main(argv: list) -> None:
    import pymupdf
    import pymupdf4llm

    src, out = argv[1], argv[2]
    with pymupdf.open(src) as doc:
        page_count = doc.page_count
    chunks = pymupdf4llm.to_markdown(src, page_chunks=True)
    try:
        pages = pages_from_chunks(chunks, page_count)
    except ValueError as err:
        raise SystemExit(f"pymupdf4llm_runner: {err}")
    result = {
        "version": version("pymupdf4llm"),
        "settings": {"page_chunks": True},
        "pages": pages,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv)
