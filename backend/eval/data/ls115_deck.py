"""The LS-115 case: one slide where every option is on the page but only one fits the stem.

On 2026-10-30 a fresh upload of a database-design deck kept a question whose
four options were all steps listed on the cited slide, so the lexical check
passed, while "directly follows" pointed to one step and "relation schemas" to
another. The slide below is written for Learnstation and keeps exactly that
shape: a distribution step sits between conceptual and logical design. Used by
backend/tests/unit/test_quiz_answer_check.py (mocked) and
backend/eval/quiz_answer_check.py (live model).
"""
from __future__ import annotations

DESIGN_STEPS_SLIDE = (
    "Designing a database\n1.\nRequirements\n\nWhat its users need, in words\n2.\nConceptual design\n\n"
    "Entity-relationship diagram\n3.\nDistribution design\n\nWhere each part of the data lives\n4.\nLogical design\n\n"
    "Relation schemas\n5.\nData definition\n\nCREATE TABLE statements\n6.\nPhysical design\n\nIndexes and storage\n"
    "7.\nOperation\n\nBackups and upkeep\n"
)
FILLER = [
    "Functional dependencies: a set of attributes X determines A when rows agreeing on X agree on A",
    "Armstrong axioms reflexivity augmentation transitivity derive every implied dependency",
    "Boyce Codd normal form every determinant of a nontrivial dependency is a superkey",
]
SLIDES = ["Normalization\nA Learnstation sample deck", DESIGN_STEPS_SLIDE, *FILLER]

LS115 = {
    "question": "During database design, which step directly follows conceptual design and leads to relation schemas?",
    "options": ["Logical design", "Physical design", "Data definition", "Distribution design"],
    "correctAnswer": "Logical design",
}
LS115_SOUND = {
    "question": "Which design step produces the relation schemas?",
    "options": ["Logical design", "Physical design", "Data definition", "Requirements"],
    "correctAnswer": "Logical design",
}
