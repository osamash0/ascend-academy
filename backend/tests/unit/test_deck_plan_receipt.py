"""deck_plan.skeleton_receipt — the JSON-safe deck skeleton stored in a parse receipt (Arc 5)."""
import json

from backend.services.parser.deck_plan import build_deck_skeleton, skeleton_receipt

LONG = "Relational algebra defines selection, projection and join over sets of tuples in detail."


def test_receipt_lists_roles_sections_and_lengths_but_not_text():
    pages = ["Datenbanksysteme\nWS 2026", "2. Relationale Algebra", "Selection\n" + LONG, "3. SQL", "Joins\n" + LONG]
    skeleton = build_deck_skeleton(pages)
    r = skeleton_receipt(skeleton)
    assert [s["role"] for s in r["slides"]] == ["title", "section", "content", "section", "content"]
    assert [s["section"] for s in r["slides"]] == [0, 1, 1, 2, 2]
    assert [s["index"] for s in r["slides"]] == [0, 1, 2, 3, 4]
    assert [s["chars"] for s in r["slides"]] == [len(p.text) for p in skeleton.slides]
    assert all(set(s) == {"index", "role", "section", "chars"} for s in r["slides"])
    assert r["sections"] == [
        {"index": 0, "title": "Datenbanksysteme", "start": 0, "end": 0},
        {"index": 1, "title": "2. Relationale Algebra", "start": 1, "end": 2},
        {"index": 2, "title": "3. SQL", "start": 3, "end": 4},
    ]


def test_receipt_boilerplate_is_a_sorted_json_safe_list():
    pages = [f"{w} content here\nFooter Seite {n}" for n, w in enumerate(["Alpha", "Beta", "Gamma", "Delta"], 1)]
    r = skeleton_receipt(build_deck_skeleton(pages))
    assert r["boilerplate"] == ["footer seite #"]
    assert json.loads(json.dumps(r)) == r


def test_receipt_of_an_empty_deck():
    assert skeleton_receipt(build_deck_skeleton([])) == {"boilerplate": [], "slides": [], "sections": []}
