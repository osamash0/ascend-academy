"""Characters a reader must never see: symbol-font private-use glyphs, TeX and Unicode ligatures,
spacing accents, Wingdings bullets."""
import re
import unicodedata

# ---------------------------------------------------------------------------------------------------------
# Symbol and dingbat fonts put their glyphs in the private-use area (U+F0xx). Map the ones learning material
# actually uses to real characters, per font — so "Name  Weight" is real text again, not a crop.
SYMBOL = {0x22: "∀", 0x24: "∃", 0x27: "∋", 0x2D: "−", 0x40: "≅", 0x61: "α", 0x62: "β", 0x63: "χ", 0x64: "δ", 0x65: "ε",
          0x66: "φ", 0x67: "γ", 0x68: "η", 0x69: "ι", 0x6A: "φ", 0x6B: "κ", 0x6C: "λ", 0x6D: "μ", 0x6E: "ν", 0x70: "π",
          0x71: "θ", 0x72: "ρ", 0x73: "σ", 0x74: "τ", 0x75: "υ", 0x77: "ω", 0x78: "ξ", 0x79: "ψ", 0x7A: "ζ",
          0xA3: "≤", 0xA5: "∞", 0xAB: "↔", 0xAC: "←", 0xAD: "↑", 0xAE: "→", 0xAF: "↓", 0xB1: "±", 0xB3: "≥", 0xB4: "×",
          0xB9: "≠", 0xBA: "≡", 0xBB: "≈", 0xC6: "∅", 0xC7: "∩", 0xC8: "∪", 0xC9: "⊃", 0xCA: "⊇", 0xCB: "⊄", 0xCC: "⊂",
          0xCD: "⊆", 0xCE: "∈", 0xCF: "∉", 0xD7: "·", 0xD8: "¬", 0xD9: "∧", 0xDA: "∨", 0xDB: "⇔", 0xDC: "⇐", 0xDE: "⇒"}
DINGS = {"webdings": {0xE0: "→", 0x34: "→", 0x33: "←"},
         "wingdings": {0xE0: "→", 0xE8: "→", 0xE7: "←", 0xF0: "⇨", 0xEF: "⇦", 0xD8: "➢", 0xFC: "✓", 0xFB: "✗"}}


def pua_map(page):
    """{private-use char: real char} for this page, read from the font of every span that uses one."""
    m = {}
    for b in page.get_text("rawdict")["blocks"]:
        for ln in b.get("lines", []):
            for s in ln["spans"]:
                font = s["font"].lower()
                for ch in s["chars"]:
                    c = ch["c"]
                    if not ("\ue000" <= c <= "\uf8ff"):
                        continue
                    code = ord(c) - 0xF000
                    rep = SYMBOL.get(code) if "symbol" in font else next((t.get(code) for k, t in DINGS.items() if k in font), None)
                    if rep:
                        m[c] = rep
    return m


def map_text(s, m):
    return "".join(m.get(c, c) for c in s) if s else s


# ---------------------------------------------------------------------------------------------------------
# Characters the PDF's text layer carries in a form a reader must never see.
SPACING = {"¨": "̈", "´": "́", "`": "̀", "ˆ": "̂", "˜": "̃", "¸": "̧"}
ACCENT = re.compile(r"(?:(?<=[A-Za-zÄÖÜäöüß\-\s(\[])|^)([¨´ˆ˜¸])\s?([AEIOUYaeiouyNnCc])")   # a backtick stays: it is code
TEX_LIG = {"\x1b": "ff", "\x1c": "fi", "\x1d": "fl", "\x1e": "ffi", "\x1f": "ffl"}   # T1-encoded TeX fonts
LIGATURE = {"ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st"}
ARROWS = set("→⇒←⇐↔⇔")


def wing_bullets(page):
    """True when this page sets bullets in a Wingdings font: there '§' is the square bullet, not a section sign."""
    return any("wingdings" in s["font"].lower() and "§" in s["text"]
               for b in page.get_text("dict")["blocks"] for ln in b.get("lines", []) for s in ln["spans"])


def fix_chars(s, wing=False):
    if not s:
        return s
    # 1. a TeX ligature code inside a word, or a Unicode ligature: the letters themselves
    s = re.sub(r"(?<=[A-Za-zäöüÄÖÜ])[\x1b-\x1f]|[\x1b-\x1f](?=[a-zäöü])", lambda m: TEX_LIG[m.group(0)], s)
    s = "".join(LIGATURE.get(c, c) for c in s)
    # 2. a spacing accent before its letter ("Gr¨obner", "¨Aquivalenz"): one composed letter
    s = ACCENT.sub(lambda m: unicodedata.normalize("NFC", m.group(2) + SPACING[m.group(1)]), s)
    # 3. a Wingdings square bullet that came through as "§" (only on pages that set bullets in Wingdings)
    if wing:
        s = re.sub(r"(^|\n|•\s?)\s*§\s+(?=\D)", r"\1", s)
    return s


def fix_dingbat_bullets(text: str, m: dict[str, str]) -> str:
    """The rules extractor turns a dingbat arrow mid-line into a bullet: give the arrow back. Only on a page whose
    private-use glyphs are all arrows: where one is a symbol ("≤", "α"), a mid-line "•" may be that symbol, and the
    page is held instead (checks.server_checks)."""
    if not m or "•" not in text[1:] or not set(m.values()) <= ARROWS:
        return text
    arrow = next(iter(set(m.values()) & ARROWS), None)
    return text[:1] + text[1:].replace(" • ", f" {arrow} ") if arrow else text


# A Wingdings arrow is not always a private-use glyph: some decks set it as plain ASCII in a dingbat font
# (Wingdings 3 draws its arrow as "}"), and a text layer or an extractor may show it as ")". Real parentheses
# and braces must stay, so only a page that has such a span in a dingbat font is touched, and only a bare
# mark at the start of a line.
PAREN_ARROW = {")", "}"}
_PAREN_BULLET = re.compile(r"(?m)^[ \t]*[)}][ \t]+(?=\S)")


def dingbat_paren_arrow(page):
    """True when this page sets an arrow bullet as a bare ")" or "}" in a Wingdings font."""
    return any("wingdings" in s["font"].lower() and s["text"].strip() in PAREN_ARROW
               for b in page.get_text("dict")["blocks"] for ln in b.get("lines", []) for s in ln["spans"])


def fix_paren_bullets(text):
    """A ")" (or "}") at the start of a line, followed by space, is the arrow bullet: call only when
    dingbat_paren_arrow(page) is true."""
    return _PAREN_BULLET.sub("→ ", text) if text else text
