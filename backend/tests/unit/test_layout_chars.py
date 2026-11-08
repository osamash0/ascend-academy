"""Characters a reader must never see: symbol-font private-use glyphs, TeX and Unicode ligatures,
spacing accents, Wingdings bullets."""
from backend.services.parser.layout.chars import (dingbat_paren_arrow, fix_chars, fix_dingbat_bullets,
                                                  fix_paren_bullets, map_text, pua_map, wing_bullets)
from backend.services.parser.layout.geometry import area, inter, union, near, centre_in, white


def test_tex_ligature_codes_become_letters():
    assert fix_chars("e\x1ecient \x1cnd") == "efficient find"


def test_unicode_ligatures_become_letters():
    assert fix_chars("ﬁle ﬂow") == "file flow"


def test_spacing_accent_composes_with_its_letter():
    assert fix_chars("Gr¨obner ¨Aquivalenz") == "Gröbner Äquivalenz"


def test_backtick_stays_code():
    assert fix_chars("`ls`") == "`ls`"


def test_wingdings_section_sign_bullet_goes_only_on_wingdings_pages():
    assert fix_chars("§ Speicher", wing=True) == "Speicher"
    assert fix_chars("§ 3 BGB", wing=False) == "§ 3 BGB"


def test_map_text_uses_the_page_map():
    assert map_text("a \ue000 b", {"\ue000": "→"}) == "a → b"


def test_dingbat_bullet_mid_line_becomes_the_pages_arrow():
    assert fix_dingbat_bullets("• A • B", {"\ue000": "→"}) == "• A → B"
    assert fix_dingbat_bullets("• A • B", {}) == "• A • B"


def test_geometry_helpers():
    assert area([0, 0, 0.5, 0.5]) == 0.25
    assert inter([0, 0, 0.5, 0.5], [0.25, 0.25, 1, 1]) == [0.25, 0.25, 0.5, 0.5]
    assert union([[0, 0, 0.1, 0.1], [0.5, 0.5, 0.6, 0.6]]) == [0, 0, 0.6, 0.6]
    assert near([0, 0, 0.1, 0.1], [0.11, 0, 0.2, 0.1])
    assert centre_in([0.4, 0.4, 0.6, 0.6], [0.3, 0.3, 0.7, 0.7])
    assert white(None) and white((1, 1, 1)) and not white((0, 0, 0))


# --- flaw 3: a Wingdings arrow that is not private-use ----------------------------------------------------
class StubPage:
    """A page whose text layer is a handful of spans."""
    def __init__(self, spans):
        self.spans = spans

    def get_text(self, mode):
        if mode == "dict":
            return {"blocks": [{"lines": [{"spans": [s]} for s in self.spans]}]}
        return {"blocks": [{"lines": [{"spans": [dict(s, chars=[{"c": c} for c in s["text"]]) for s in [sp]]}
                                      for sp in self.spans]}]}


def test_pua_map_reads_the_symbol_font_of_the_span():
    page = StubPage([{"font": "Symbol", "text": "\uf061"}])
    assert pua_map(page) == {"\uf061": "α"}


def test_pua_map_reads_wingdings_arrows():
    page = StubPage([{"font": "Wingdings-Regular", "text": "\uf0e0"}])
    assert pua_map(page) == {"\uf0e0": "→"}


def test_pua_map_ignores_ordinary_characters():
    assert pua_map(StubPage([{"font": "Symbol", "text": "a"}])) == {}


def test_wing_bullets_only_on_pages_with_a_wingdings_section_sign():
    assert wing_bullets(StubPage([{"font": "Wingdings-Regular", "text": "§"}]))
    assert not wing_bullets(StubPage([{"font": "Arial", "text": "§"}]))
    assert not wing_bullets(StubPage([{"font": "Wingdings-Regular", "text": "x"}]))


def test_dingbat_paren_arrow_is_true_for_a_wingdings_paren():
    assert dingbat_paren_arrow(StubPage([{"font": "Wingdings-Regular", "text": ")"}]))


def test_dingbat_paren_arrow_is_true_for_a_wingdings3_brace():
    assert dingbat_paren_arrow(StubPage([{"font": "Wingdings3", "text": "}"}]))


def test_dingbat_paren_arrow_needs_a_dingbat_font():
    assert not dingbat_paren_arrow(StubPage([{"font": "Arial", "text": ")"}]))
    assert not dingbat_paren_arrow(StubPage([{"font": "Wingdings-Regular", "text": "a)"}]))


def test_paren_bullet_at_line_start_becomes_an_arrow():
    assert fix_paren_bullets(") Speicher") == "→ Speicher"
    assert fix_paren_bullets("• a\n  ) b\n) c") == "• a\n→ b\n→ c"
    assert fix_paren_bullets("} Speicher") == "→ Speicher"


def test_real_parentheses_are_left_alone():
    assert fix_paren_bullets("f(x) = 1") == "f(x) = 1"
    assert fix_paren_bullets("(a)\n) \nx )") == "(a)\n) \nx )"
    assert fix_paren_bullets(")x") == ")x"


def test_dingbat_bullets_are_left_alone_when_the_page_also_maps_a_non_arrow_symbol():
    # on a page with a Symbol-font "≤", a mid-line "•" may be that lost "≤": never guess an arrow for it
    assert fix_dingbat_bullets("• A • B", {"\uf0e0": "→", "\uf0a3": "≤"}) == "• A • B"
    assert fix_dingbat_bullets("• A • B", {"\uf0e0": "→", "\uf0e8": "→"}) == "• A → B"
