import io
import random

import fitz
from PIL import Image

from backend.services.parser.layout.figures import (apply_pictures, apply_regions, content_pictures,
                                                    diagram_regions, drop_blank_figures, repeated_places)


def noise_png(w=120, h=90):
    rnd = random.Random(1)
    im = Image.new("RGB", (w, h))
    im.putdata([(rnd.randrange(256), rnd.randrange(256), rnd.randrange(256)) for _ in range(w * h)])
    buf = io.BytesIO(); im.save(buf, "PNG"); return buf.getvalue()


def test_boxes_each_holding_a_label_are_one_diagram():
    doc = fitz.open(); page = doc.new_page(width=800, height=600)
    for i, x in enumerate((100, 300, 500)):
        page.draw_rect(fitz.Rect(x, 200, x + 120, 260), color=(0, 0, 0))
        page.insert_text((x + 10, 235), f"Node{i}", fontsize=12)
    page.draw_line((220, 230), (300, 230)); page.draw_line((420, 230), (500, 230))
    regions = diagram_regions(page)
    blocks = [{"id": f"p1-b{i}", "kind": "paragraph", "bbox": [(x + 10) / 800, 222 / 600, (x + 60) / 800, 238 / 600],
               "text": f"Node{i}", "readingOrder": i} for i, x in enumerate((100, 300, 500))]
    st = apply_regions(1, blocks, regions)
    assert st["diagrams"] == 1
    assert [b["kind"] for b in blocks] == ["figure"] and blocks[0]["diagram"]


def test_a_logo_on_every_page_is_furniture_and_a_photo_is_content():
    doc = fitz.open(); png = noise_png()
    for _ in range(4):
        p = doc.new_page(width=800, height=600)
        p.insert_image(fitz.Rect(700, 20, 780, 80), stream=png)          # logo: same place, every page
    doc[1].insert_image(fitz.Rect(200, 200, 500, 420), stream=noise_png(200, 150))   # photo: once
    rep = repeated_places(doc)
    assert content_pictures(doc[0], rep) == []
    pics = content_pictures(doc[1], rep)
    assert len(pics) == 1
    blocks = []
    assert apply_pictures(2, blocks, pics) == 1 and blocks[0]["picture"]


def test_an_empty_figure_box_is_dropped_but_one_with_words_stays():
    doc = fitz.open(); page = doc.new_page(width=800, height=600)
    page.insert_text((420, 330), "label", fontsize=12)
    blocks = [{"id": "f0", "kind": "figure", "bbox": [0.05, 0.05, 0.3, 0.3], "text": ""},
              {"id": "f1", "kind": "figure", "bbox": [0.5, 0.5, 0.6, 0.6], "text": ""}]
    assert drop_blank_figures(page, blocks) == 1
    assert [b["id"] for b in blocks] == ["f1"]
