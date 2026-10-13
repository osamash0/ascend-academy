"""Teach it back: the reading is kept only where it can be checked."""
from backend.services.v4_teachback_service import judge

POINTS = [
    {"point": "The closure X+ is every attribute X determines.", "page": 31},
    {"point": "Start with X and add C whenever B->C fires with B in X.", "page": 34},
    {"point": "Stop when nothing new is added.", "page": 34},
]
TEXT = "You start with X and keep adding attributes from FDs whose left side is in X. It always takes two rounds."


def test_covered_points_and_exact_quotes_survive():
    out = judge(POINTS, TEXT, {"covered": [1, 7, -1], "wrong": [
        {"quote": "It always takes two rounds", "correction": "It runs until nothing changes.", "page": 34},
        {"quote": "words the student never wrote", "correction": "x" * 10, "page": 34},
    ]})
    assert [p["covered"] for p in out["points"]] == [False, True, False]
    assert [w["quote"] for w in out["wrong"]] == ["It always takes two rounds"]
    assert out["verdict"] == "off"  # one of three, and a wrong claim


def test_all_points_and_nothing_wrong_is_solid():
    out = judge(POINTS, TEXT, {"covered": [0, 1, 2], "wrong": []})
    assert out["verdict"] == "solid"


def test_most_points_is_partial_and_a_broken_reading_is_just_empty():
    assert judge(POINTS, TEXT, {"covered": [0, 1]})["verdict"] == "partial"
    broken = judge(POINTS, TEXT, "not json at all")
    assert broken["verdict"] == "off" and broken["wrong"] == []


def test_a_wrong_page_falls_back_to_a_key_points_page():
    out = judge(POINTS, TEXT, {"covered": [], "wrong": [{"quote": "two rounds", "correction": "It runs to a fixpoint.", "page": 999}]})
    assert out["wrong"][0]["page"] == 31
