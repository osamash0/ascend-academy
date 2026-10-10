from hypothesis import HealthCheck, given, settings
from backend.tests.support.deck_strategies import decks, FOOTER_LINES


# decks() builds up to 40 pages of nested draws, which trips Hypothesis's
# too_slow health check; generation cost is accepted here, not hidden.
@settings(max_examples=50, suppress_health_check=[HealthCheck.too_slow])
@given(decks())
def test_generated_decks_carry_footer_on_every_page(pages):
    assert len(pages) >= 4
    for page in pages:
        for line in FOOTER_LINES:
            assert line.split("{n}")[0] in page
