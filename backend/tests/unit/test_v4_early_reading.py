from backend.services.v4_spaces_service import reading_view


def run(**over):
    base = {"status": "running", "page_count": 82, "lecture_id": None}
    base.update(over)
    return base


def test_a_fresh_run_can_be_read_with_nothing_done_yet():
    v = reading_view(run(), 0, "https://signed/x.pdf")
    assert v == {"pdfUrl": "https://signed/x.pdf", "pages": 82, "pagesRead": 0, "stage": "developing", "lessonId": None}


def test_progress_never_exceeds_the_page_count():
    assert reading_view(run(), 999, "u")["pagesRead"] == 82


def test_a_finished_run_is_ready_and_fully_read():
    v = reading_view(run(status="completed", lecture_id="L1"), 80, "u")
    assert v["stage"] == "ready" and v["lessonId"] == "L1" and v["pagesRead"] == 82


def test_a_failed_run_says_so():
    assert reading_view(run(status="failed"), 3, "u")["stage"] == "failed"


def test_unknown_page_count_reads_as_zero():
    assert reading_view(run(page_count=None), 4, "u")["pages"] == 0
