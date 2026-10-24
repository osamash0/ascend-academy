"""v4 Person shape from a profiles row: content is never anonymous."""
from backend.services.v4_spaces_service import _person


def _row(**kw):
    base = {"user_id": "u-1", "display_name": None, "full_name": None, "email": None, "avatar_url": None}
    base.update(kw)
    return base


def test_prefers_display_name_then_full_name():
    assert _person(_row(display_name="Lea", full_name="Lea Krüger"))["name"] == "Lea"
    assert _person(_row(full_name="Lea Krüger"))["name"] == "Lea Krüger"


def test_falls_back_to_email_local_part_never_blank():
    assert _person(_row(email="lea.k@uni-marburg.de"))["name"] == "lea.k"
    assert _person(_row(display_name="  "))["name"] == "Learner"


def test_shape_matches_the_typescript_person():
    assert set(_person(_row(avatar_url="https://x/a.png"))) == {"id", "name", "avatarUrl"}
