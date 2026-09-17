import json

import pytest

from backend.services import localization_service


def _slide(number: int, *, chars: int = 40, questions: list | None = None) -> dict:
    return {
        "id": f"slide-{number}", "slide_number": number, "title": f"Titel {number}",
        "content_text": "x" * chars, "summary": "", "questions": questions or [],
    }


def _document(slides: list[dict]) -> dict:
    return {
        "lecture": {"id": "lecture-1", "source_language": "de", "title": "Titel", "description": "Beschreibung"},
        "slides": slides,
    }


def _echo_translator(transform=lambda payload: payload):
    """Stub for generate_text_bulk that translates whatever batch it is given.

    Records each payload so a test can assert the deck went out as several
    small requests rather than one whole-deck completion.
    """
    calls: list[dict] = []

    async def generate(prompt: str, ai_model: str = "") -> str:
        payload = json.loads(prompt.rsplit("\n\n", 1)[-1])
        calls.append(payload)
        return json.dumps(transform(json.loads(json.dumps(payload))))

    return generate, calls


def test_detect_source_language_recognizes_german_text():
    assert localization_service.detect_source_language(
        "Die Einführung in die Wissenschaft und die Grundlagen"
    ) == "de"


def test_detect_source_language_defaults_to_english_when_ambiguous():
    assert localization_service.detect_source_language("Neural networks 101") == "en"


def test_long_english_deck_with_incidental_hits_is_not_german():
    """Regression: the bare `hits >= 2` rule misread long English decks.

    Real case from the corpus — an English "Relational Algebra" lecture,
    1,111 words, whose only three matches were an incidental 'der', 'mit' and
    'und'. It was stored as German on 2026-08-02 and would have been served
    to readers as a German deck.
    """
    english = (
        "Database Systems Relational Algebra Thorsten Papenbrock Basics Basic "
        "Operators Advanced Operators Complex Expressions Multiset Semantics "
    ) * 40 + " der mit und"

    assert len(english.split()) > 400  # long enough for the ratio to govern
    assert localization_service.detect_source_language(english) == "en"


def test_a_genuinely_german_deck_is_still_detected_in_long_text():
    """The ratio must not cost us the true positives it sits between."""
    german = (
        "Die Einführung in die Grundlagen der Datenübertragung und der "
        "lokalen Netzwerke mit einer Übersicht für das Studium nicht nur "
    ) * 40

    assert localization_service.detect_source_language(german) == "de"


def test_short_german_title_still_uses_the_plain_count():
    """Below the ratio floor a short title is mostly hint words by nature."""
    assert localization_service.detect_source_language(
        "Einführung in die objektorientierte Modellierung"
    ) == "de"


def test_empty_text_is_english():
    assert localization_service.detect_source_language("") == "en"
    assert localization_service.detect_source_language(None) == "en"


@pytest.mark.asyncio
async def test_translate_document_keeps_source_locale_without_llm():
    document = {
        "lecture": {"id": "lecture-1", "source_language": "de", "title": "Titel"},
        "slides": [],
    }
    assert await localization_service._translate_document(document, "de", "test") == document


@pytest.mark.asyncio
async def test_translate_document_rejects_changed_answer_index(monkeypatch):
    document = {
        "lecture": {"id": "lecture-1", "source_language": "de", "title": "Titel"},
        "slides": [{
            "id": "slide-1", "slide_number": 1, "questions": [{
                "id": "quiz-1", "slide_id": "slide-1", "correct_answer": 2, "options": ["a", "b", "c", "d"],
            }],
        }],
    }
    monkeypatch.setattr(localization_service, "generate_text_bulk", lambda *args, **kwargs: __import__('asyncio').sleep(0, result="{}"))
    monkeypatch.setattr(localization_service, "parse_json_response", lambda _raw: {
        "lecture": {"id": "lecture-1"},
        "slides": [{"id": "slide-1", "slide_number": 1, "questions": [{
            "id": "quiz-1", "slide_id": "slide-1", "correct_answer": 0, "options": ["a", "b", "c", "d"],
        }]}],
    })
    with pytest.raises(ValueError, match="answer identity"):
        await localization_service._translate_document(document, "en", "test")


def test_batch_slides_splits_on_slide_count_and_char_budget():
    small = [_slide(n) for n in range(1, 21)]
    assert [len(b) for b in localization_service._batch_slides(small)] == [8, 8, 4]
    # One oversized slide closes the batch before the budget is exceeded.
    fat = [_slide(1), _slide(2, chars=localization_service._BATCH_CHAR_BUDGET), _slide(3)]
    assert [len(b) for b in localization_service._batch_slides(fat)] == [1, 1, 1]
    # A deck with no slides still needs one request for title/description.
    assert localization_service._batch_slides([]) == [[]]


@pytest.mark.asyncio
async def test_translate_document_sends_batches_and_reassembles(monkeypatch):
    """A whole-deck request cannot finish inside the LLM timeout, so the deck
    must go out as several batches and come back as one complete document."""
    document = _document([_slide(n) for n in range(1, 21)])
    generate, calls = _echo_translator()
    monkeypatch.setattr(localization_service, "generate_text_bulk", generate)

    result = await localization_service._translate_document(document, "en", "test")

    assert [len(call["slides"]) for call in calls] == [8, 8, 4]
    # Only the first batch carries the lecture object.
    assert "lecture" in calls[0] and not any("lecture" in call for call in calls[1:])
    assert [s["slide_number"] for s in result["slides"]] == list(range(1, 21))
    assert result["lecture"]["id"] == "lecture-1"
    assert result["lecture"]["source_language"] == "de"


@pytest.mark.asyncio
async def test_translate_document_rejects_batch_that_drops_a_slide(monkeypatch):
    """Assembly is validated against the source too, so a batch that silently
    returns fewer slides can never publish as a complete snapshot."""
    document = _document([_slide(n) for n in range(1, 21)])

    def drop_last(payload):
        payload["slides"] = payload["slides"][:-1]
        return payload

    generate, _ = _echo_translator(drop_last)
    monkeypatch.setattr(localization_service, "generate_text_bulk", generate)

    with pytest.raises(ValueError, match="slide count"):
        await localization_service._translate_document(document, "en", "test")


@pytest.mark.asyncio
async def test_translate_document_keeps_canonical_lecture_identity(monkeypatch):
    """A chatty model may only supply display strings, never identity fields."""
    document = _document([_slide(1)])

    def rewrite(payload):
        payload["lecture"]["title"] = "Version Control"
        payload["lecture"]["source_language"] = "en"
        return payload

    generate, _ = _echo_translator(rewrite)
    monkeypatch.setattr(localization_service, "generate_text_bulk", generate)

    result = await localization_service._translate_document(document, "en", "test")
    assert result["lecture"]["title"] == "Version Control"
    assert result["lecture"]["source_language"] == "de"


@pytest.mark.asyncio
async def test_localize_lecture_job_raises_retry_so_arq_reruns_it(monkeypatch):
    """Arq only re-queues on Retry — a plain exception is recorded as failed and
    never runs again, which would leave the locale permanently unbuilt."""
    from arq.worker import Retry

    monkeypatch.setattr(localization_service, "get_db_connection", _stub_connection(ready=0))

    async def boom(*args, **kwargs):
        raise RuntimeError("provider down")

    monkeypatch.setattr(localization_service, "localize_lecture", boom)
    with pytest.raises(Retry) as excinfo:
        await localization_service.localize_lecture_job(
            {"job_try": 2}, "00000000-0000-0000-0000-000000000001",
        )
    assert excinfo.value.defer_score == 120_000


@pytest.mark.asyncio
async def test_localize_lecture_job_skips_a_lecture_already_localized(monkeypatch):
    monkeypatch.setattr(
        localization_service, "get_db_connection",
        _stub_connection(ready=len(localization_service.SUPPORTED_LOCALES)),
    )

    async def fail(*args, **kwargs):
        raise AssertionError("must not re-translate a fresh snapshot")

    monkeypatch.setattr(localization_service, "localize_lecture", fail)
    result = await localization_service.localize_lecture_job(
        {}, "00000000-0000-0000-0000-000000000001",
    )
    assert result["skipped"] is True


def _stub_connection(*, ready: int):
    """Minimal stand-in for get_db_connection's async-context connection."""
    class _Conn:
        async def fetchval(self, *args, **kwargs):
            return ready

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

    async def get_db_connection():
        return _Conn()

    return get_db_connection
