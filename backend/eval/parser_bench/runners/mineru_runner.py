"""`mineru`: MinerU's local model pipeline at tier "basic" (small layout, OCR, formula and table models; no VLM).
MinerU 4 has no backend named "pipeline" any more: its tiers replaced the backends, and "basic" is the one that
runs the model pipeline without a VLM (the spec's `pipeline` backend; PROTOCOL.md deviation 3). Its default for
PDFs, "standard", adds a VLM. Everything else is MinerU's default, its device choice included.

One Markdown text per page: the middle JSON (MinerU 4.1.3: a `pages` list) is cut into its pages, and each page
is rendered on its own with MinerU's own Markdown renderer. A block's page is the zero-based `page_idx` of the
middle JSON page that holds it, the same index the content list carries; no page numbers are inferred from text
or markers. The pages come from the LIVE middle JSON object, not from ParseResult.to_dict(): that drops the
images of a PDF (image_base64), and an image block then renders as nothing. Every image is marked "![figure](figure)"
through the renderer's image_renderer hook (the bench turns it into [figure] like every other method's images), so
no image bytes reach the output; tables and charts keep their recognised content. The PDF is read from a plain
copy, because some deck names start with a space.

Exits non-zero, writing nothing, unless the middle JSON pages are exactly 1..N of the PDF and every content-list
item lies on one of them: a partial result must never be scored as MinerU's result.

Usage: python -I mineru_runner.py <in.pdf> <out.json>
"""
import json
import os
import re
import shutil
import sys
import tempfile
from importlib.metadata import version

TIER = "basic"
FIGURE_MARKDOWN = "![figure](figure)"
# Image syntax the renderer can still emit past image_renderer (MinerU 4.1.3: a chart that has recognised content
# is rendered with its own image from the block's bytes, docvortex render/_internal/markdown/blocks.py
# _render_chart_with_details): every image syntax left in a page becomes the marker, so no image bytes are kept.
# The same shapes as normalize.py's.
_LEAKED_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)|<img\b[^>]*>", re.I)


def figure_marker(_block) -> str:
    """MinerU's image_renderer hook: one fixed marker for every image block."""
    return FIGURE_MARKDOWN


def mark_leaked_images(markdown: str) -> str:
    return _LEAKED_IMAGE.sub(FIGURE_MARKDOWN, markdown)


def _get(item, name):
    return item.get(name) if isinstance(item, dict) else getattr(item, name, None)


def _only_page(middle, entry):
    """The document with one page left: dict (the fakes of the tests) or MiddleJson (a shallow, unvalidated copy)."""
    if isinstance(middle, dict):
        return {**middle, "pages": [entry]}
    return middle.model_copy(update={"pages": [entry]})


def pages_from_middle(middle, to_markdown, page_count: int) -> dict:
    """{"1": markdown, ...}: each entry of the middle JSON's `pages` list rendered on its own (with the document's
    other fields), numbered by its page_idx; ValueError unless the page_idx values are exactly 0..N-1, each once."""
    info = _get(middle, "pages")
    if not isinstance(info, list):
        raise ValueError("the middle JSON has no pages list")
    pages = {}
    for entry in info:
        idx = _get(entry, "page_idx")
        if not isinstance(idx, int) or isinstance(idx, bool):
            raise ValueError("a page of the middle JSON has no page_idx")
        if str(idx + 1) in pages:
            raise ValueError(f"page_idx {idx} twice")
        pages[str(idx + 1)] = to_markdown(_only_page(middle, entry))
    numbers = sorted(int(k) for k in pages)
    if numbers != list(range(1, page_count + 1)):
        raise ValueError(f"the middle JSON has pages {numbers} for a PDF of {page_count} pages")
    return pages


def check_content_list(items, page_count: int) -> None:
    """Every item of the content list (V1: a flat list of dicts) names a page_idx of the PDF."""
    if not isinstance(items, list):
        raise ValueError("the content list is not a list")
    bad = [item.get("page_idx") if isinstance(item, dict) else None for item in items
           if not (isinstance(item, dict) and isinstance(item.get("page_idx"), int)
                   and 0 <= item["page_idx"] < page_count)]
    if bad:
        raise ValueError(f"content-list items with page_idx {bad[:10]} for a PDF of {page_count} pages")


def count_pages(path: str) -> int:
    import pypdfium2

    pdf = pypdfium2.PdfDocument(path)
    try:
        return len(pdf)
    finally:
        pdf.close()


def runtime() -> dict:
    """What MinerU resolves to here: the small-model backend (torch or onnx), the device it runs on and the
    configured ONNX device. "unknown" when a value cannot be read."""
    out = {"small_model_backend": "unknown", "device": "unknown", "onnx_device_setting": "unknown"}
    try:
        from mineru.model.runtime.device import get_device, resolve_small_model_backend

        out["small_model_backend"] = str(resolve_small_model_backend())
        out["device"] = str(get_device())
    except Exception:
        pass
    try:
        from mineru.config import get_config

        out["onnx_device_setting"] = str(get_config().model.onnx_device)
    except Exception:
        pass
    return out


def main(argv: list) -> None:
    # transformers 5.x loads weights on a thread pool (core_model_loading.py, convert_and_load_state_dict_in_model),
    # and on this Mac loading MinerU's layout model (mineru/model/layout/pp_doclayoutv2.py, from_pretrained) hangs
    # there at 0% CPU forever. transformers' own switch (is_env_variable_true("HF_DEACTIVATE_ASYNC_LOAD")) loads on
    # one thread instead. Set before mineru, and so transformers, is imported; no other method sets it.
    os.environ["HF_DEACTIVATE_ASYNC_LOAD"] = "1"
    from mineru.parser import parse
    from mineru.render import MarkdownRenderOptions, RenderFormat, render

    src, out = argv[1], argv[2]
    # The copy lives in the run's own working folder: execute.invoke() starts every runner there and removes it
    # after the run, killed or not, so no copy of course material stays in the system temp folder.
    with tempfile.TemporaryDirectory(dir=os.getcwd()) as tmp:
        source = os.path.join(tmp, "input.pdf")
        shutil.copyfile(src, source)
        page_count = count_pages(source)
        result = parse(source, tier=TIER)
        try:
            check_content_list(render(result.middle_json, RenderFormat.CONTENT_LIST), page_count)
            options = MarkdownRenderOptions(image_renderer=figure_marker)
            pages = pages_from_middle(
                result.middle_json,  # the live object: image bytes intact, so the image renderer sees every image
                lambda one: mark_leaked_images(render(one, RenderFormat.MARKDOWN, options=options)), page_count)
        except ValueError as err:
            raise SystemExit(f"mineru_runner: {err}")
    data = {
        "version": version("mineru"),
        "settings": {"tier": TIER, "render": "MinerU's Markdown renderer, one page of the middle JSON at a time",
                     "page_index": "page_idx (zero-based) of the middle JSON, as in the content list",
                     "images": "marker ![figure](figure) for every image (image_renderer); no image bytes kept",
                     "weight_loading": "one thread (HF_DEACTIVATE_ASYNC_LOAD=1; transformers' threaded loading "
                                       "deadlocks here)",
                     **runtime()},
        "pages": pages,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv)
