"""Figure 4.1 of the thesis: four corpus pages drawn from their real layout.

Each text line becomes a bar, bullets stay as dots, lines with formula symbols
are hatched, running footers are dashed, vector drawings are redrawn in grey
without their labels, and embedded images become a crossed box. No text and
no image of a slide is copied; the output PDFs contain no fonts (check with
pdffonts). Blocks, footers and figures come from page_blocks.extract_blocks,
the function the routing rule uses.

The decks are course material and stay outside the repository, in
~/Downloads (as for backend/eval/decks.py). Run from the repository root:
  .venv/bin/python -I docs/thesis/experiments/page-types/draw_page_types.py . thesis/figures
"""
import sys, pathlib
repo, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]); sys.path.insert(0, str(repo))
import fitz
from backend.services.parser.page_blocks import extract_blocks
from backend.services.pdf_reader import page_text_dict
D = pathlib.Path.home() / "Downloads"
PAGES = [("a", "13__SR_Netze_v02_16.06.2026.pdf", 14), ("b", "04 DBS Relational Algebra.pdf", 10),
         ("c", "12__SR_LANS_v03_12.06.2026.pdf", 9), ("d", "05__SR_Speicherverwaltung_v02_06.05.2026.pdf", 48)]
MATH = set("∪∩⋈⨝σπρ×→←↔≤≥≠∈∉∀∃¬∧∨⊆⊂Ω∅⊥≡∑∫")
BULLETS = set("•▪‣◦■□–§»")
TEXT, HEAD, FOOT, FORM, LINE = (0.72,) * 3, (0.30,) * 3, (0.55,) * 3, (0.25,) * 3, (0.35,) * 3

def gray(c):
    if c is None: return None
    g = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
    return (g,) * 3

def is_bullet(span):
    t = span["text"].strip()
    return 0 < len(t) <= 2 and (t[0] in BULLETS or "" <= t[0] <= "" or "Wingdings" in span["font"] or "Symbol" in span["font"] and len(t) == 1)

def is_math(spans):
    return any(any(c in MATH for c in s["text"]) or ("" <= s["text"][:1] <= "" and len(s["text"].strip()) > 0) or "Math" in s["font"] or "Symbol" in s["font"] for s in spans)

for tag, deck, p in PAGES:
    src = fitz.open(D / deck)[p - 1]
    W, H = src.rect.width, src.rect.height
    doc = fitz.open(); pg = doc.new_page(width=W, height=H)
    sh = pg.new_shape()
    # vector drawings, redrawn in grey without any text; logo corner skipped
    for d in src.get_drawings():
        r = d["rect"]
        if r.y1 / H < 0.14 and r.x0 / W > 0.75: continue
        if r.width * r.height > 0.6 * W * H: continue
        for it in d["items"]:
            if it[0] == "l": sh.draw_line(it[1], it[2])
            elif it[0] == "re": sh.draw_rect(it[1])
            elif it[0] == "qu": sh.draw_quad(it[1])
            elif it[0] == "c": sh.draw_bezier(it[1], it[2], it[3], it[4])
        sh.finish(color=gray(d.get("color")), fill=gray(d.get("fill")), width=d.get("width") or 0.5,
                  closePath=d.get("closePath", False), fill_opacity=d.get("fill_opacity") or 1)
    pb = extract_blocks(src, p)
    raw = page_text_dict(src)["blocks"]
    foot = set(pb["footers"])
    for b in pb["blocks"]:
        x0, y0, x1, y1 = b["bbox"]; R = fitz.Rect(x0 * W, y0 * H, x1 * W, y1 * H)
        if b["kind"] == "figure":
            sh.draw_rect(R); sh.finish(color=(0, 0, 0), fill=(0.94,) * 3, width=1.2)
            sh.draw_line(R.tl, R.br); sh.draw_line(R.tr, R.bl); sh.finish(color=(0.6,) * 3, width=0.6)
            continue
        i = int(b["id"].split("-b")[1])
        col = FOOT if b["id"] in foot else (HEAD if b["kind"] == "heading" else TEXT)
        for l in raw[i]["lines"]:
            spans = [s for s in l["spans"] if s["text"].strip()]
            if not spans: continue
            lb = fitz.Rect(l["bbox"]); size = max(s["size"] for s in spans)
            x = lb.x0
            if is_bullet(spans[0]):
                bb = fitz.Rect(spans[0]["bbox"]); c = fitz.Point((bb.x0 + bb.x1) / 2, (lb.y0 + lb.y1) / 2)
                sh.draw_circle(c, size * 0.16); sh.finish(fill=HEAD, color=None)
                rest = spans[1:]
                if not rest: continue
                x = fitz.Rect(rest[0]["bbox"]).x0; spans = rest
            hgt = size * 0.42; ym = (lb.y0 + lb.y1) / 2
            bar = fitz.Rect(x, ym - hgt / 2, max(x + 2, lb.x1), ym + hgt / 2)
            if b["id"] in foot:
                sh.draw_rect(bar); sh.finish(color=(0.15,) * 3, fill=(0.88,) * 3, width=1.0, dashes="[3 1.5] 0")
            elif is_math(spans):
                sh.draw_rect(bar); sh.finish(color=FORM, fill=(0.97,) * 3, width=0.8)
                k = int(bar.width // (hgt * 1.2))
                for j in range(min(k, 40)):
                    cx = bar.x0 + (j + 0.5) * bar.width / k
                    sh.draw_line((cx - hgt * .25, bar.y0 + hgt * .2), (cx + hgt * .25, bar.y1 - hgt * .2))
                sh.finish(color=FORM, width=0.5)
            else:
                sh.draw_rect(bar); sh.finish(fill=col, color=None)
    sh.draw_rect(pg.rect); sh.finish(color=(0.5,) * 3, width=1)
    sh.commit()
    doc.save(out / f"f26-page-types-{tag}.pdf")
