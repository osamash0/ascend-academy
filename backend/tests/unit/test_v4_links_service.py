"""Prerequisite links are kept only where they can be checked."""
from backend.services.v4_links_service import _ids, keep_links, salvage

LECTURES = [
    {"id": "a", "title": "Basics", "ideas": [{"name": "Keys", "first_page": 1}, {"name": "Relations", "first_page": 10}]},
    {"id": "b", "title": "Normalization", "ideas": [{"name": "Closure", "first_page": 31}, {"name": "FDs", "first_page": 1}, {"name": "BCNF", "first_page": 40}]},
]


def test_ideas_get_ids_in_teaching_order():
    ids = _ids(LECTURES)
    assert [(i["id"], i["name"]) for i in ids] == [
        ("L1.1", "Keys"), ("L1.2", "Relations"), ("L2.1", "FDs"), ("L2.2", "Closure"), ("L2.3", "BCNF"),
    ]


def test_only_real_earlier_prerequisites_survive_at_most_three():
    ideas = _ids(LECTURES)
    out = keep_links(ideas, {"links": [
        {"to": "L2.3", "needs": ["L2.2", "L2.2", "L9.9", "L2.3", "L1.1", "L2.1", "L1.2"], "why": "uses closure"},
        {"to": "L1.1", "needs": ["L2.1"]},  # a later idea cannot be a prerequisite
        {"to": "nope", "needs": ["L1.1"]},
    ]})
    pairs = [(o["from"]["first_page"], o["from"]["lecture_id"], o["to"]["first_page"]) for o in out]
    assert pairs == [(31, "b", 40), (1, "a", 40), (1, "b", 40)]
    assert out[0]["why"] == "uses closure"


def test_garbage_is_no_links():
    assert keep_links(_ids(LECTURES), "not json") == []
    assert keep_links(_ids(LECTURES), {"links": "nope"}) == []


def test_the_compact_form_is_read_too():
    out = keep_links(_ids(LECTURES), {"links": ["L2.3<L2.2, L1.1", "garbage", "L2.2<L2.1"]})
    assert [(o["from"]["first_page"], o["to"]["first_page"]) for o in out] == [(31, 40), (1, 40), (1, 31)]


def test_a_cut_off_answer_still_yields_its_complete_links():
    raw = '{"links": ["L2.2<L2.1", "L2.3<L2.2,L1.1", "L2.'
    out = keep_links(_ids(LECTURES), salvage(raw))
    assert [(o["from"]["first_page"], o["to"]["first_page"]) for o in out] == [(1, 31), (31, 40), (1, 40)]
