"""
MinerU REST server for Learnstation.
Uses magic-pdf 1.3.12 API (magic_pdf.tools.common.do_parse).

Start with:
    source mineru-env/bin/activate
    python mineru_server.py
"""
import os
import re
import json
import tempfile
import pathlib
from fastapi import FastAPI, UploadFile, File, HTTPException
from magic_pdf.tools.common import do_parse

app = FastAPI()

@app.post("/file_parse")
async def file_parse(file: UploadFile = File(...)):
    pdf_bytes = await file.read()
    stem = pathlib.Path(file.filename or "upload").stem

    with tempfile.TemporaryDirectory() as tmp:
        try:
            do_parse(
                output_dir=tmp,
                pdf_file_name=stem,
                pdf_bytes_or_dataset=pdf_bytes,
                model_list=[],
                parse_method="auto",
                f_dump_md=True,
                f_dump_middle_json=False,
                f_dump_model_json=False,
                f_dump_orig_pdf=False,
                f_dump_content_list=True,
                f_draw_span_bbox=False,
                f_draw_layout_bbox=False,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"MinerU parse error: {e}")

        # Prefer content_list JSON (has page numbers); fall back to markdown
        content_list_path = pathlib.Path(tmp) / stem / "auto" / f"{stem}_content_list.json"
        md_path = pathlib.Path(tmp) / stem / "auto" / f"{stem}.md"

        pages = []

        if content_list_path.exists():
            with open(content_list_path) as f:
                items = json.load(f)
            page_map: dict[int, list[str]] = {}
            for item in items:
                pg = item.get("page_idx", 0)
                text = item.get("text") or item.get("content") or ""
                if text:
                    page_map.setdefault(pg, []).append(text)
            for pg in sorted(page_map):
                pages.append({
                    "page": pg + 1,
                    "markdown": "\n\n".join(page_map[pg]),
                    "title": None,
                })

        elif md_path.exists():
            # Fall back: split on <!-- PAGE BREAK --> or just return as one page
            md_text = md_path.read_text(encoding="utf-8")
            chunks = re.split(r"<!--\s*PAGE[_ ]BREAK\s*-->", md_text)
            for i, chunk in enumerate(chunks):
                chunk = chunk.strip()
                if chunk:
                    pages.append({"page": i + 1, "markdown": chunk, "title": None})

    return pages


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8888)
