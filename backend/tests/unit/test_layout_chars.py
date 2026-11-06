"""Characters a reader must never see: symbol-font private-use glyphs, TeX and Unicode ligatures,
spacing accents, Wingdings bullets."""
from backend.services.parser.layout.chars import fix_chars, map_text, fix_dingbat_bullets
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
