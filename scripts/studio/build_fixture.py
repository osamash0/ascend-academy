#!/usr/bin/env python3
"""Build the Studio canvas fixture from a real PDF.

Usage:
  python -I scripts/studio/build_fixture.py <pdf> <first>-<last> <image_dir> <json_out>

Writes one WebP per page (1440px wide) and a JSON file shaped like
`src/features/spaces/studio/types.ts`: {"pages": SourcePage[], "blocks": ExtractedBlock[]}.

Running footers (blocks starting below 90% of the page height) stay on the
source side but get no clean block, so Morph has real "Not in your version"
regions to reveal. Full-page background images and tiny logos are skipped.
The extraction itself lives in backend/services/parser/page_blocks.py.
"""
import json
import sys
from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from backend.services.parser.page_blocks import extract_blocks  # noqa: E402

MATERIAL_ID = "m-norm"
IMAGE_PREFIX = "/v4-mock/studio/normalization-p"
WIDTH = 1440


def main(pdf: str, rng: str, image_dir: str, json_out: str) -> None:
    first, last = (int(x) for x in rng.split("-"))
    doc = fitz.open(pdf)
    out_dir = Path(image_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    pages, clean_blocks = [], []

    for n in range(first, last + 1):
        page = doc[n - 1]
        w, h = page.rect.width, page.rect.height
        zoom = WIDTH / w
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        Image.frombytes("RGB", (pix.width, pix.height), pix.samples).save(
            out_dir / f"normalization-p{n}.webp", "WEBP", quality=80, method=6
        )

        pb = extract_blocks(page, n)
        for b in pb["blocks"]:
            if b["kind"] == "figure" or b["id"] in pb["footers"]:
                continue  # figures have no clean text; running footers stay source-only
            clean_blocks.append({
                "id": f"c-{b['id']}", "origin": "extracted", "markdown": pb["markdown"][b["id"]],
                "source": {"materialId": MATERIAL_ID, "page": n, "blockIds": [b["id"]]},
                "edited": False,
            })

        pages.append({
            "materialId": MATERIAL_ID, "page": n,
            "width": round(w, 2), "height": round(h, 2),
            "imageUrl": f"{IMAGE_PREFIX}{n}.webp",
            "geometry": "block", "blocks": pb["blocks"],
        })

    Path(json_out).write_text(json.dumps({
        "_generated": f"scripts/studio/build_fixture.py from Normalization.pdf pages {first}-{last}. Do not edit by hand.",
        "pages": pages,
        "blocks": clean_blocks,
    }, ensure_ascii=False, indent=1) + "\n")
    print(f"{len(pages)} pages, {sum(len(p['blocks']) for p in pages)} source blocks, {len(clean_blocks)} clean blocks")


if __name__ == "__main__":
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    main(*sys.argv[1:])
