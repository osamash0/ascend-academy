"""`opendataloader`: OpenDataLoader PDF (runs Java), Markdown output, default
settings except images off. Its own page separator splits the pages.

Exits non-zero, writing nothing, when the split does not give back exactly pages
1..N with no text before the first separator: a partial result must never be
scored as ODL's result.

Usage: python -I opendataloader_runner.py <in.pdf> <out.json>
"""
import glob
import json
import os
import re
import shutil
import sys
import tempfile
from importlib.metadata import version

PLACEHOLDER = "%page-number%"
SEPARATOR = "<<<LS-PAGE %page-number%>>>"
_BEFORE, _AFTER = SEPARATOR.split(PLACEHOLDER)
SPLIT = re.compile(r"\n?" + re.escape(_BEFORE) + r"(\d+)" + re.escape(_AFTER) + r"\n")


def split_pages(markdown: str) -> dict:
    """Split ODL's Markdown at SEPARATOR into {"1": text, ..., "N": text}.

    Raises ValueError when no separator was honoured, when text precedes the
    first one, or when the page numbers are not exactly 1..N.
    """
    parts = SPLIT.split(markdown)  # ['', '1', page1, '2', page2, ...]
    numbers = [int(parts[i]) for i in range(1, len(parts) - 1, 2)]
    if not numbers:
        raise ValueError(f"no page separator in the output ({len(markdown)} characters)")
    if parts[0].strip():
        raise ValueError(f"{len(parts[0].strip())} characters of text before the first page separator")
    if numbers != list(range(1, len(numbers) + 1)):
        raise ValueError(f"page numbers are not 1..{len(numbers)} in order: {numbers}")
    return {str(n): parts[2 * n].strip() for n in numbers}


def main(argv: list) -> None:
    import opendataloader_pdf

    src, out = argv[1], argv[2]
    with tempfile.TemporaryDirectory() as tmp:
        # A plain copy: the output is named after the input, and some deck names start with a space.
        source = os.path.join(tmp, "input.pdf")
        shutil.copyfile(src, source)
        target = os.path.join(tmp, "out")
        opendataloader_pdf.convert(
            input_path=source,
            output_dir=target,
            format="markdown",
            quiet=True,
            markdown_page_separator="\n" + SEPARATOR + "\n",
            image_output="off",
            include_header_footer=False,
        )
        [md_file] = glob.glob(os.path.join(target, "**", "*.md"), recursive=True)
        with open(md_file, encoding="utf-8") as f:
            markdown = f.read()
    try:
        pages = split_pages(markdown)
    except ValueError as err:
        raise SystemExit(f"opendataloader_runner: {err}")
    result = {
        "version": version("opendataloader-pdf"),
        "settings": {
            "format": "markdown",
            "image_output": "off",
            "include_header_footer": False,
            "quiet": True,
            "markdown_page_separator": SEPARATOR,
        },
        "pages": pages,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv)
