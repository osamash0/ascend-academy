"""Translated practice keeps canonical grading and labels original-language fallbacks."""
import asyncio
from contextlib import asynccontextmanager
from uuid import UUID

import pytest

from backend.services import v4_practice_service as svc

L = UUID('11111111-1111-1111-1111-111111111111')
ROW = {"id": "q1", "question_text": "Wie viele Punkte?", "options": ["Vier", "Sechs"],
       "correct_answer": 1, "metadata": {}, "slide_number": 2, "source_language": "de"}


def run(monkeypatch, translated):
    class Conn:
        async def fetch(self, *args):
            return [ROW]

    @asynccontextmanager
    async def context():
        yield Conn()

    async def connect():
        return context()

    async def snapshot(lecture_id, locale):
        assert lecture_id == L and locale == "en"
        return translated

    monkeypatch.setattr(svc, 'get_db_connection', connect)
    monkeypatch.setattr(svc, '_localized_snapshot', snapshot)
    return asyncio.run(svc.questions_for(L, locale="en"))[0]


def test_uses_published_translation_and_keeps_canonical_answer_values(monkeypatch):
    question = run(monkeypatch, {"slides": [{"slide_number": 2, "questions": [
        {"id": "q1", "question_text": "How many points?", "options": ["Four", "Six"],
         "correct_answer": 1, "explanation": "The page says six."}]}]})
    assert question["prompt"] == "How many points?"
    assert question["choices"] == ["Four", "Six"] and question["correctAnswer"] == "Six"
    assert question["answerValues"] == ["Vier", "Sechs"]
    assert question["language"] == "en" and question["explanation"] == "The page says six."


@pytest.mark.parametrize('snapshot', [None, {"slides": []}, {"slides": [{"questions": [
    {"id": "q1", "question_text": "Bad", "options": ["Four", "Six"], "correct_answer": 0}]}]}])
def test_missing_or_mismatched_translation_keeps_original_and_its_language(monkeypatch, snapshot):
    question = run(monkeypatch, snapshot)
    assert question["prompt"] == "Wie viele Punkte?" and question["language"] == "de"
    assert question["correctAnswer"] == "Sechs" and "answerValues" not in question
    assert question["explanation"] == "Die Antwort steht auf Seite 2 dieser Lektion."


def test_translation_with_colliding_option_labels_falls_back(monkeypatch):
    question = run(monkeypatch, {"slides": [{"questions": [
        {"id": "q1", "question_text": "How many?", "options": ["Six", "Six"], "correct_answer": 1}]}]})
    assert question["choices"] == ["Vier", "Sechs"] and question["language"] == "de"
