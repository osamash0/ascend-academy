"""`current`: our production extraction, exactly as
backend.services.parser.unified_orchestrator._extract_pages does it.

Standalone on purpose: importing the orchestrator imports backend.core.database,
whose load_dotenv() reaches the main checkout's .env (production credentials)
from a worktree. test_parser_bench_runners.py::test_current_matches_production
pins this copy to the production function, so the two cannot drift apart.

Usage: python -I current_runner.py <in.pdf> <out.json>
"""
import json
import sys
from importlib.metadata import version


def extract(pdf_bytes: bytes) -> list:
    import fitz

    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        return [page.get_text("text") or "" for page in doc]


def main(argv: list) -> None:
    src, out = argv[1], argv[2]
    with open(src, "rb") as f:
        pages = extract(f.read())
    result = {
        "version": version("pymupdf"),
        "settings": {"call": 'page.get_text("text")', "copy_of": "unified_orchestrator._extract_pages"},
        "pages": {str(n): text for n, text in enumerate(pages, start=1)},
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv)
