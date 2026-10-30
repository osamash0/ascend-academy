"""v4 Person shape from a profiles row: never blank, never the email (LS-036)."""
from backend.services.v4_spaces_service import _person


def _row(**kw):
    base = {"user_id": "u-1", "display_name": None, "full_name": None, "email": None, "avatar_url": None}
    base.update(kw)
    return base


def test_prefers_display_name_then_full_name():
    assert _person(_row(display_name="Lea", full_name="Lea Krüger"))["name"] == "Lea"
    assert _person(_row(full_name="Lea Krüger"))["name"] == "Lea Krüger"


def test_a_missing_name_is_learner_never_the_email():
    # Other people see this name; "lea.k" from lea.k@uni-marburg.de would
    # hand them part of an email address the person never chose to show.
    assert _person(_row(email="lea.k@uni-marburg.de"))["name"] == "Learner"
    assert _person(_row(display_name="  "))["name"] == "Learner"


def test_shape_matches_the_typescript_person():
    assert set(_person(_row(avatar_url="https://x/a.png"))) == {"id", "name", "avatarUrl"}
