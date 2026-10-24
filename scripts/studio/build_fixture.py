#!/usr/bin/env python3
"""Build the Studio canvas fixture from a real PDF.

Usage:
  python -I scripts/studio/build_fixture.py <pdf> <first>-<last> <image_dir> <json_out>

Writes one WebP per page (1440px wide) and a JSON file shaped like
`src/features/spaces/studio/types.ts`: {"pages": SourcePage[], "blocks": ExtractedBlock[]}.

Running footers (blocks starting below 90% of the page height) stay on the
source side but get no clean block, so Morph has real "Not in your version"
regions to reveal. Full-page background images and tiny logos are skipped.
"""
import json
import re
import statistics
import sys
from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image

MATERIAL_ID = "m-norm"
IMAGE_PREFIX = "/v4-mock/studio/normalization-p"
WIDTH = 1440
PUA = re.compile("[-]")  # icon-font bullets in this export


def clean(s: str) -> str:
    s = PUA.sub("•", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def lines_of(block) -> list[str]:
    out = []
    for line in block["lines"]:
        t = clean(" ".join(span["text"] for span in line["spans"]))
        if t:
            out.append(t)
    # Bullets and numbers are often their own line in this export; join them to the text after.
    merged: list[str] = []
    i = 0
    while i < len(out):
        if re.fullmatch(r"•|\d+\.", out[i]) and i + 1 < len(out):
            merged.append(out[i] + " " + out[i + 1])
            i += 2
        else:
            merged.append(out[i])
            i += 1
    return merged


def max_size(block) -> float:
    return max((s["size"] for l in block["lines"] for s in l["spans"]), default=0.0)


def kind_and_markdown(lines: list[str], size: float, heading_size: float) -> tuple[str, str]:
    if all(l.startswith("•") for l in lines):
        return "list", "\n".join("- " + l.lstrip("•").strip() for l in lines)
    text = " ".join(l.lstrip("•").strip() for l in lines)
    if size >= heading_size and len(text) < 120:
        return "heading", "### " + text
    return "paragraph", text


def norm_box(b, w: float, h: float) -> list[float]:
    def c(v: float) -> float:
        return round(min(1.0, max(0.0, v)), 4)

    x0, y0, x1, y1 = b
    return [c(x0 / w), c(y0 / h), c(x1 / w), c(y1 / h)]


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

        raw = page.get_text("dict")["blocks"]
        sizes = [
            s["size"] for b in raw if b["type"] == 0
            for l in b["lines"] for s in l["spans"] if s["text"].strip()
        ]
        heading_size = statistics.median(sizes) * 1.35 if sizes else 999.0

        source = []
        for i, b in enumerate(raw):
            bid = f"p{n}-b{i}"
            box = norm_box(b["bbox"], w, h)
            area = (box[2] - box[0]) * (box[3] - box[1])
            if box[2] <= box[0] or box[3] <= box[1]:
                continue
            if b["type"] == 1:
                if area > 0.6 or area < 0.002:
                    continue  # page background or a logo
                source.append({"id": bid, "page": n, "bbox": box, "kind": "figure",
                               "text": "", "readingOrder": i})
                continue
            lines = lines_of(b)
            if not lines:
                continue
            kind, md = kind_and_markdown(lines, max_size(b), heading_size)
            source.append({"id": bid, "page": n, "bbox": box, "kind": kind,
                           "text": "\n".join(lines), "readingOrder": i})
            if box[1] >= 0.9:
                continue  # running footer: source only
            clean_blocks.append({
                "id": f"c-{bid}", "origin": "extracted", "markdown": md,
                "source": {"materialId": MATERIAL_ID, "page": n, "blockIds": [bid]},
                "edited": False,
            })

        pages.append({
            "materialId": MATERIAL_ID, "page": n,
            "width": round(w, 2), "height": round(h, 2),
            "imageUrl": f"{IMAGE_PREFIX}{n}.webp",
            "geometry": "block", "blocks": source,
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
