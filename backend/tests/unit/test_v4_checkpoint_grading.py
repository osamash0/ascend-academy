"""Checkpoint answers are graded on the server, the same way the reader grades them (rehearsal/grade.ts)."""
from backend.services.v4_rehearsal_service import grade_answer

CHOICE = {"kind": "choice", "options": [{"text": "a"}, {"text": "b", "correct": True}, {"text": "c"}]}
ORDER = {"kind": "order", "items": ["x", "y", "z"]}
FD_HOLDS = {
    "kind": "fdHolds", "columns": ["A", "B", "C"],
    "rows": [["1", "x", "p"], ["1", "x", "q"], ["2", "y", "p"]],
    "candidates": [{"lhs": ["A"], "rhs": ["B"]}, {"lhs": ["A"], "rhs": ["C"]}],
}
CLOSURE = {"kind": "closure", "attrs": ["A", "B", "C", "D"], "start": ["A"],
           "fds": [{"lhs": ["A"], "rhs": ["B"]}, {"lhs": ["B"], "rhs": ["C"]}]}
BCNF = {"kind": "bcnf", "attrs": ["A", "B", "C"],
        "fds": [{"lhs": ["A"], "rhs": ["B", "C"]}, {"lhs": ["B"], "rhs": ["C"]}]}


def test_choice():
    assert grade_answer(CHOICE, {"kind": "choice", "index": 1})
    assert not grade_answer(CHOICE, {"kind": "choice", "index": 0})


def test_order_is_right_only_in_the_slides_order():
    assert grade_answer(ORDER, {"kind": "order", "order": [0, 1, 2]})
    assert not grade_answer(ORDER, {"kind": "order", "order": [1, 0, 2]})
    assert not grade_answer(ORDER, {"kind": "order", "order": [0, 1]})


def test_fd_holds_is_computed_from_the_rows():
    assert grade_answer(FD_HOLDS, {"kind": "fdHolds", "holds": [0]})
    assert not grade_answer(FD_HOLDS, {"kind": "fdHolds", "holds": [0, 1]})


def test_closure_is_computed():
    assert grade_answer(CLOSURE, {"kind": "closure", "attrs": ["C", "A", "B"]})
    assert not grade_answer(CLOSURE, {"kind": "closure", "attrs": ["A", "B"]})


def test_bcnf_violations_are_computed():
    assert grade_answer(BCNF, {"kind": "bcnf", "violating": [1]})
    assert not grade_answer(BCNF, {"kind": "bcnf", "violating": [0, 1]})


def test_a_mismatched_or_malformed_answer_is_simply_wrong():
    assert not grade_answer(CHOICE, {"kind": "order", "order": [0]})
    assert not grade_answer(CLOSURE, {"kind": "closure", "attrs": "ABC"})
    assert not grade_answer({"kind": "choice"}, {"kind": "choice", "index": 0})
