from hypothesis import given, settings
from backend.tests.support.deck_strategies import decks, FOOTER_LINES


@settings(max_examples=50)
@given(decks())
def test_generated_decks_carry_footer_on_every_page(pages):
    assert len(pages) >= 4
    for page in pages:
        for line in FOOTER_LINES:
            assert line.split("{n}")[0] in page
