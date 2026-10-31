"""`docling`: Docling's default PDF pipeline (its layout model, TableFormer for tables, OCR where Docling
decides a page needs it), one Markdown text per page from export_to_markdown(page_no=n). Nothing is passed to
the converter: every setting is Docling's default, the device included (its "auto" picks MPS on Apple Silicon).
Images keep Docling's default placeholder, which the bench turns into [figure] like every other image.

Exits non-zero, writing nothing, unless the conversion succeeded and the document holds exactly pages 1..N of
the PDF: a partial result must never be scored as Docling's result.

Usage: python -I docling_runner.py <in.pdf> <out.json>
"""
import json
import sys
from importlib.metadata import version


def pages_from_document(doc, page_count: int) -> dict:
    """{"1": markdown, ..., "N": markdown} from a DoclingDocument; ValueError unless its pages are exactly 1..N."""
    numbers = sorted(int(n) for n in doc.pages)
    if numbers != list(range(1, page_count + 1)):
        raise ValueError(f"the document has pages {numbers} for a PDF of {page_count} pages")
    return {str(n): doc.export_to_markdown(page_no=n) for n in numbers}


def device() -> str:
    """The device Docling's default accelerator setting resolves to here, or "unknown" when it cannot be read."""
    try:
        try:
            from docling.datamodel.accelerator_options import AcceleratorOptions
        except ImportError:
            from docling.datamodel.pipeline_options import AcceleratorOptions
        from docling.utils.accelerator_utils import decide_device

        return str(decide_device(AcceleratorOptions().device))
    except Exception:
        return "unknown"


def count_pages(path: str) -> int:
    import pypdfium2

    pdf = pypdfium2.PdfDocument(path)
    try:
        return len(pdf)
    finally:
        pdf.close()


def main(argv: list) -> None:
    from docling.document_converter import DocumentConverter

    src, out = argv[1], argv[2]
    page_count = count_pages(src)
    result = DocumentConverter().convert(src)
    status = getattr(result.status, "name", str(result.status))
    if status != "SUCCESS":
        raise SystemExit(f"docling_runner: the conversion ended as {status}")
    try:
        pages = pages_from_document(result.document, page_count)
    except ValueError as err:
        raise SystemExit(f"docling_runner: {err}")
    data = {
        "version": version("docling"),
        "settings": {"pipeline": "default", "export": "export_to_markdown(page_no=n)", "device": device()},
        "pages": pages,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv)
