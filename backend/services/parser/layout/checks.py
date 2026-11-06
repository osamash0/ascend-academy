"""Server checks: the parts of the demo's page gate that need no rendering. A page passes (verdict "layout")
only when nothing is lost, cut, broken or laid over: otherwise it opens as the original.
Callers hold FITZ_LOCK (this module never takes it)."""
import re
import unicodedata

from backend.services.parser.layout.chars import ARROWS
from backend.services.parser.layout.geometry import area, centre_in, inter
from backend.services.parser.layout.strokes import furniture, page_lines

COVERAGE = 0.98          # share of the PDF's words that must be set in type, in a figure, dropped or furniture
#                          (furniture: a page number or a running line in the outer band, strokes.furniture)
PICTURE_COVER = 0.85     # share of a picture a figure box must cover
DIAGRAM_KEPT = 0.6       # share of a diagram's items that must survive (redrawn, or inside a figure or table)
UNDER_CROP = 0.2         # share of a text block a figure box may cover
CROP_SHARE = 0.35        # share of the text area that may still be symbol-font crops
TOO_MANY_LINES = "too many lines"
MAX_PATHS = 400          # more redrawn lines than this is a hatching, a map or a plot of many points: too heavy to send

_PUA = re.compile("[\ue000-\uf8ff]")
# spacing accents, a section sign standing for a bullet, control characters (a NUL, a stray TeX code), and the
# replacement character: what the text layer could not say
_BROKEN = re.compile(r"[¨´ˆ˜\x00-\x08\x0b\x0c\x0e-\x1f\ufffd]|(^|\s)§\s")


def _mid_line_bullet(text):
    """A "•" that is not a line's own bullet: on a page with symbol-font glyphs, a symbol page_blocks lost."""
    for ln in (text or "").split("\n"):
        ln = ln.lstrip()
        if "•" in (ln[1:] if ln.startswith("•") else ln):
            return True
    return False


def norm_word(w):
    """Compared without accents, ligatures and punctuation on both sides: the PDF may say "Gr¨obner"
    where Layout sets "Gröbner"."""
    s = re.sub(r"[\x1b-\x1f]", "", (w or "").lower())
    s = "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.category(c).startswith("M"))
    return "".join(c for c in s if c.isalnum())


def _words(page):
    """[(box, word, line)]: each word of the PDF with its line's (box, text)."""
    W, H = page.rect.width, page.rect.height
    lines = page_lines(page)
    return [([x0 / W, y0 / H, x1 / W, y1 / H], t, lines[(b, ln)])
            for x0, y0, x1, y1, t, b, ln, _ in page.get_text("words") if t.strip()]


def server_checks(page, blocks, pics, diagrams, paths, dropped, marks=0, pua=None, running=frozenset()):
    """The reasons this page cannot be set as Layout: [] when it can.
    blocks: the page's final blocks; pics: picture boxes; diagrams: reink's diagrams; paths: reink's paths;
    dropped: boxes of furniture that was removed on purpose; marks: strokes.lost_marks (a plot's markers
    that are not redrawn); pua: the page's chars.pua_map; running: strokes.running_lines of the document."""
    texts = [b for b in blocks if b["kind"] != "figure"]
    figs = [b["bbox"] for b in blocks if b["kind"] == "figure"]
    if not texts:
        return ["no text layer"]
    reasons = []

    # 1. every word of the PDF is set in type, inside a figure, inside a dropped box, or furniture
    typed = {}
    for b in texts:
        for w in (b.get("text") or "").split():
            t = norm_word(w)
            if t:
                typed[t] = typed.get(t, 0) + 1
    typed_all = " ".join(typed)
    total = missing = 0
    for box, word, (line_box, line) in _words(page):
        t = norm_word(word)
        if not t:
            continue
        total += 1
        if any(centre_in(box, f) for f in figs) or any(centre_in(box, d) for d in dropped):
            continue
        if not any(centre_in(box, b["bbox"], 0.01) for b in blocks) and furniture(line_box, line, running):
            continue                                   # a page number or a running line, in no block
        if typed.get(t, 0) > 0:
            typed[t] -= 1
            continue
        if len(t) > 2 and t in typed_all:
            continue                                   # hyphenation or ligatures split a word differently
        missing += 1
    coverage = 1 - missing / total if total else 1
    # 2. lost diagrams: every cluster of drawn items is still drawn (redrawn, or inside a figure or table)
    drawn = {tuple(p["bbox"]) for p in paths}
    holders = figs + [b["bbox"] for b in blocks if b["kind"] == "table"]
    lost_diagrams = sum(1 for g in diagrams
                        if sum(1 for it in g["items"] if tuple(it) in drawn or any(centre_in(it, h, 0.01) for h in holders))
                        < DIAGRAM_KEPT * len(g["items"]))
    # 3. a figure box over set type repeats the type's words
    under = sum(1 for b in texts if area(b["bbox"]) > 0
                and any(area(inter(b["bbox"], f)) > UNDER_CROP * area(b["bbox"]) for f in figs))
    # 4. pictures: every picture is still shown whole
    lost_pics = sum(1 for pic in pics if area(pic) > 0
                    and sum(area(inter(pic, f)) for f in figs) / area(pic) < PICTURE_COVER)
    # 5. accents and bullets that reached the reader broken
    #    and, on a page that sets symbols ("≤", "α") in a symbol font, a mid-line "•": page_blocks turned that
    #    private-use glyph into a bullet before Layout saw it, and the symbol cannot be told back (never guessed)
    symbols = any(v not in ARROWS for v in (pua or {}).values())
    broken = sum(1 for b in texts if _BROKEN.search(b.get("text") or "")
                 or (symbols and b["kind"] != "table" and _mid_line_bullet(b.get("text"))))
    # 6. crops: how much of the text is still symbol-font characters
    text_area = sum(area(b["bbox"]) for b in texts)
    crop_share = min(1, sum(area(b["bbox"]) for b in texts if _PUA.search(b.get("text") or "")) / text_area) if text_area else 0

    if lost_diagrams:
        reasons.append(f"{lost_diagrams} diagram{'s' if lost_diagrams > 1 else ''} lost")
    if marks:
        reasons.append(f"{marks} marks lost")
    if under:
        reasons.append(f"{under} line{'s' if under > 1 else ''} under a crop")
    if lost_pics:
        reasons.append(f"{lost_pics} picture{'s' if lost_pics > 1 else ''} lost or cut")
    if broken:
        reasons.append(f"broken characters in {broken} blocks")
    if coverage < COVERAGE:
        reasons.append(f"{missing} of {total} words missing")
    if crop_share > CROP_SHARE:
        reasons.append(f"{round(crop_share * 100)}% of the text is crops")
    if len(paths) > MAX_PATHS:
        reasons.append(TOO_MANY_LINES)
    return reasons
