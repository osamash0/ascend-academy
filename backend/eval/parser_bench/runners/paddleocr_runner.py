"""`paddleocr` and `paddleocr_vl`: PaddleOCR 3's two document pipelines on their defaults, one Markdown text per
page (res.markdown["markdown_texts"]). `--pipeline structure` runs PP-StructureV3; `--pipeline vl` runs PaddleOCR-VL
(a 0.9B document vision-language model, tried as a separate method: the spec's "PaddleOCR-VL is also tried",
entered only when it installs and stays within the time limit, deviation 3). The two methods differ only by this
argument (tools.py: runner_args) and by their model folders. PaddlePaddle has no MPS backend: both run on the CPU
here. The PDF is read from a plain copy, because some deck names start with a space.

Paddle writes an image block as an <img> tag (or ![](path) in its plain mode) pointing into a folder of crops it
saves beside the Markdown; here nothing is saved, so every image is marked "![figure](figure)" and no image bytes
or crop paths reach the output (the bench turns the marker into [figure] like every other method's images).
Everything else stays as Paddle writes it: HTML tables, and the centring <div> it wraps around text and images.

Exits non-zero, writing nothing, unless the results are exactly pages 1..N of the PDF, each with its Markdown:
a partial result must never be scored as PaddleOCR's result.

Usage: python -I paddleocr_runner.py --pipeline structure|vl <in.pdf> <out.json>
"""
import argparse
import json
import os
import re
import shutil
import sys
import tempfile
from importlib.metadata import version

PIPELINES = {"structure": ("PP-StructureV3", "PPStructureV3"), "vl": ("PaddleOCR-VL", "PaddleOCRVL")}
FIGURE_MARKDOWN = "![figure](figure)"
# Every image syntax Paddle's Markdown can hold: ![](path) and <img ...>. The same shapes as normalize.py's.
_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)|<img\b[^>]*>", re.I)


def mark_images(markdown: str) -> str:
    return _IMAGE.sub(FIGURE_MARKDOWN, markdown)


def page_index(res):
    """A result's own zero-based page_index, or None when it has none."""
    try:
        index = res["page_index"]
    except (KeyError, TypeError, IndexError):
        return None
    return index if isinstance(index, int) and not isinstance(index, bool) else None


def pages_from_results(results, page_count: int) -> dict:
    """{"1": markdown, ...} from the per-page results, in order; a result's own page_index wins when it has one.
    ValueError unless the pages are exactly 1..N, each with its Markdown text."""
    pages = {}
    for n, res in enumerate(results, start=1):
        index = page_index(res)
        number = n if index is None else index + 1
        markdown = getattr(res, "markdown", None)
        text = markdown.get("markdown_texts") if isinstance(markdown, dict) else None
        if not isinstance(text, str):
            raise ValueError(f"page {number} has no Markdown text")
        if str(number) in pages:
            raise ValueError(f"page {number} came twice")
        pages[str(number)] = text
    numbers = sorted(int(k) for k in pages)
    if numbers != list(range(1, page_count + 1)):
        raise ValueError(f"the results have pages {numbers} for a PDF of {page_count} pages")
    return pages


def device() -> str:
    try:
        import paddle

        return str(paddle.device.get_device())
    except Exception:
        return "unknown"


def describe(pipeline) -> dict:
    """What the pipeline object resolved to here, read from it: PaddleOCR's wrapper has pipeline_version (VL: "v1.6"
    picks PaddleX's "PaddleOCR-VL-1.6") and the PaddleX pipeline's name; the layout pipeline's effective
    use_doc_preprocessor (PaddleX derives it from the YAML default False and its own True defaults for the
    orientation and unwarping switches, so the YAML alone does not say). "unknown" when a value cannot be read."""
    inner = getattr(pipeline, "paddlex_pipeline", None)
    use_doc_preprocessor = getattr(inner, "use_doc_preprocessor", None)
    version_ = getattr(pipeline, "pipeline_version", None)
    name = getattr(pipeline, "_paddlex_pipeline_name", None)
    return {
        "pipeline_version": version_ if isinstance(version_, str) else "unknown",
        "paddlex_pipeline": name if isinstance(name, str) else "unknown",
        "use_doc_preprocessor": use_doc_preprocessor if isinstance(use_doc_preprocessor, bool) else "unknown",
    }


def count_pages(path: str) -> int:
    import pypdfium2

    pdf = pypdfium2.PdfDocument(path)
    try:
        return len(pdf)
    finally:
        pdf.close()


def main(argv: list) -> None:
    parser = argparse.ArgumentParser(prog="paddleocr_runner")
    parser.add_argument("--pipeline", required=True, choices=sorted(PIPELINES))
    parser.add_argument("pdf")
    parser.add_argument("out")
    args = parser.parse_args(argv[1:])
    label, class_name = PIPELINES[args.pipeline]

    import paddleocr

    # The copy lives in the run's own working folder: execute.invoke() starts every runner there and removes it
    # after the run, killed or not, so no copy of course material stays in the system temp folder.
    with tempfile.TemporaryDirectory(dir=os.getcwd()) as tmp:
        source = os.path.join(tmp, "input.pdf")
        shutil.copyfile(args.pdf, source)
        page_count = count_pages(source)
        pipeline = getattr(paddleocr, class_name)()
        results = list(pipeline.predict(input=source))
        effective = describe(pipeline)
    try:
        pages = {n: mark_images(text) for n, text in pages_from_results(results, page_count).items()}
    except ValueError as err:
        raise SystemExit(f"paddleocr_runner: {err}")
    data = {
        "version": version("paddleocr"),
        "settings": {"pipeline": label, "defaults": True, "markdown": "res.markdown['markdown_texts'] per page",
                     "images": "marker ![figure](figure) for every image; no image bytes or crop paths kept",
                     "device": device(), **effective},
        "pages": pages,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv)
