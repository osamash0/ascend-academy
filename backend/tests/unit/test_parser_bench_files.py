import hashlib

import pytest

from backend.eval.parser_bench import blinding, compare, files, pageset
from backend.tests.unit.parser_bench_compare_fixtures import bench_pages_of, make_comparison, make_extract_run, vote_all
from backend.tests.unit.parser_bench_fixtures import make_deck


def test_an_upload_is_stored_once_by_its_hash(tmp_path):
    data = make_deck(tmp_path / "deck.pdf").read_bytes()
    first = files.store_pdf(data, "../../Lecture 1.pdf", root=tmp_path / "data")
    again = files.store_pdf(data, "other.pdf", root=tmp_path / "data")
    assert first == again and first.name == "Lecture 1.pdf" and first.pages == 6
    assert first.path == tmp_path / "data" / "files" / first.sha256 / "Lecture 1.pdf"
    assert files.list_files(tmp_path / "data") == [first]
    assert "path" not in first.as_dict()


@pytest.mark.parametrize(("data", "message"), [(b"hello", "not a PDF"), (b"%PDF-1.7 broken", "cannot be read")])
def test_what_is_not_a_readable_pdf_is_refused(tmp_path, data, message):
    with pytest.raises(ValueError, match=message):
        files.store_pdf(data, "x.pdf", root=tmp_path)
    assert files.list_files(tmp_path) == []


@pytest.mark.parametrize(("name", "safe"), [("a/b/c.PDF", "c.pdf"), ("Notes.Pdf", "Notes.pdf"), ("notes", "notes.pdf"), ("", "upload.pdf"), ("x;rm -rf.pdf", "x_rm -rf.pdf")])
def test_safe_names(name, safe):
    assert files.safe_name(name) == safe


def test_a_bad_sha_is_refused(tmp_path):
    with pytest.raises(ValueError, match="SHA-256"):
        files.find_file("../etc", tmp_path)


def test_a_page_image_comes_from_a_run_source_and_is_cached(tmp_path):
    root = tmp_path / "data"
    deck = make_deck(tmp_path / "deck.pdf")
    run = make_extract_run(root, "current", deck, purpose="explore")
    sha = run.meta["source"]["sha256"]
    png = files.page_png(sha, 2, root)
    assert png.startswith(b"\x89PNG") and (root / "cache" / "png" / f"{sha}-2.png").exists()
    with pytest.raises(FileNotFoundError):
        files.resolve_pdf("0" * 64, root)


def test_benchmark_pages_are_locked_until_their_comparison_is_judged(tmp_path):
    root = tmp_path / "data"
    cmp = make_comparison(root, tmp_path)
    sha = cmp.meta["pages"][0]["sha256"]
    assert blinding.lock_state(root, pages=[]).hides(sha, 1, "alphatool")
    with pytest.raises(blinding.Locked):
        blinding.check(sha, 1, "alphatool", blinding.lock_state(root, pages=[]))
    vote_all(cmp)
    cmp.finish()
    assert not blinding.lock_state(root, pages=[]).hides(sha, 1, "alphatool")


def test_page_set_pages_are_locked_before_any_comparison_exists(tmp_path):
    page = pageset.BenchPage("swt-p3", "swt", "x.pdf", "a" * 64, 3, "lists", "chosen", "r")
    state = blinding.lock_state(tmp_path, pages=[page])
    assert state.hides("a" * 64, 3, "current") and not state.hides("a" * 64, 4, "current")


def test_a_second_comparison_locks_the_pages_again(tmp_path):
    root = tmp_path / "data"
    first = make_comparison(root, tmp_path)
    vote_all(first)
    first.finish()
    second = make_comparison(root, tmp_path)
    sha = second.meta["pages"][0]["sha256"]
    assert all(blinding.lock_state(root, pages=[]).hides(sha, n, "alphatool") for n in range(1, 7))


def test_unlocking_early_opens_the_pages_and_writes_a_deviation(tmp_path):
    root = tmp_path / "data"
    cmp = make_comparison(root, tmp_path)
    log = tmp_path / "LAB_LOG.md"
    log.write_text("# log\n")
    with pytest.raises(ValueError, match="why"):
        blinding.unlock_early(cmp, "  ", lab_log=log)
    blinding.unlock_early(cmp, "checking the\nrenderer", lab_log=log)
    assert not blinding.lock_state(root, pages=[]).hides(cmp.meta["pages"][0]["sha256"], 1, "alphatool")
    text = log.read_text()
    assert "deviation: blinding lock lifted early" in text and "0 of 10 duels" in text and "checking the renderer" in text
    assert cmp.meta["unlocked_early"]["reason"] == "checking the renderer"


def test_a_stored_upload_changed_on_disk_is_refused(tmp_path, monkeypatch):
    root = tmp_path / "data"
    monkeypatch.setattr(files, "_resolved", {})
    stored = files.store_pdf(make_deck(tmp_path / "deck.pdf", n=6).read_bytes(), "deck.pdf", root=root)
    assert files.resolve_pdf(stored.sha256, root) == stored.path
    other = make_deck(tmp_path / "other.pdf", n=2).read_bytes()
    stored.path.write_bytes(other)
    actual = hashlib.sha256(other).hexdigest()
    with pytest.raises(ValueError, match=f"{stored.sha256[:12]}.*{actual[:12]}"):
        files.resolve_pdf(stored.sha256, root)
    with pytest.raises(ValueError, match="changed on disk"):
        files.page_png(stored.sha256, 1, root)


def test_a_failed_lab_log_write_leaves_the_comparison_locked(tmp_path):
    root = tmp_path / "data"
    cmp = make_comparison(root, tmp_path)
    blocked = tmp_path / "LAB_LOG.md"
    blocked.mkdir()  # a folder cannot be appended to, so the log write fails
    with pytest.raises(OSError):
        blinding.unlock_early(cmp, "checking the renderer", lab_log=blocked)
    assert cmp.meta.get("unlocked_early") is None
    sha = cmp.meta["pages"][0]["sha256"]
    assert blinding.lock_state(root, pages=[]).hides(sha, 1, "alphatool")


def test_a_judged_page_opens_only_for_the_methods_judged_on_it(tmp_path):
    root = tmp_path / "data"
    cmp = make_comparison(root, tmp_path)
    vote_all(cmp)
    cmp.finish()
    sha = cmp.meta["pages"][0]["sha256"]
    state = blinding.lock_state(root, pages=bench_pages_of(cmp)[:1])  # page 1 is a page-set page
    assert not state.hides(sha, 1, "alphatool") and state.hides(sha, 1, "gammatool") and state.hides(sha, 1, None)
    assert not state.hides(sha, 2, "gammatool")  # not a page-set page, and no comparison is judging it


def test_a_finished_comparison_cannot_be_unlocked_and_logs_nothing(tmp_path):
    root = tmp_path / "data"
    cmp = make_comparison(root, tmp_path)
    vote_all(cmp)
    cmp.finish()
    log = tmp_path / "LAB_LOG.md"
    log.write_text("# log\n")
    with pytest.raises(ValueError, match="nothing to unlock"):
        blinding.unlock_early(cmp, "too late", lab_log=log)
    assert log.read_text() == "# log\n"


def test_an_already_unlocked_comparison_cannot_be_unlocked_twice(tmp_path):
    root = tmp_path / "data"
    cmp = make_comparison(root, tmp_path)
    log = tmp_path / "LAB_LOG.md"
    log.write_text("# log\n")
    blinding.unlock_early(cmp, "checking the renderer", lab_log=log)
    with pytest.raises(ValueError, match="nothing to unlock"):
        blinding.unlock_early(cmp, "again", lab_log=log)
    assert log.read_text().count("deviation: blinding lock lifted early") == 1


def test_an_explore_comparison_cannot_be_unlocked(tmp_path):
    root = tmp_path / "data"
    base = make_comparison(root, tmp_path)
    explore = compare.CompareRun.create(entrants=base.meta["entrants"], pages=base.meta["pages"], seed=1,
                                        duels=base.meta["schedule"], protocol_commit="abc123", purpose="explore", root=root)
    log = tmp_path / "LAB_LOG.md"
    log.write_text("# log\n")
    with pytest.raises(ValueError, match="nothing to unlock"):
        blinding.unlock_early(explore, "checking", lab_log=log)
    assert log.read_text() == "# log\n"


def test_a_capital_pdf_upload_is_listed_found_rendered_and_deduplicated(tmp_path, monkeypatch):
    root = tmp_path / "data"
    monkeypatch.setattr(files, "_resolved", {})
    data = make_deck(tmp_path / "deck.pdf").read_bytes()
    first = files.store_pdf(data, "LECTURE.PDF", root=root)
    assert first.name == "LECTURE.pdf"
    assert files.store_pdf(data, "other.PDF", root=root) == first
    assert files.list_files(root) == [first]
    assert files.find_file(first.sha256, root) == first
    assert files.page_png(first.sha256, 1, root).startswith(b"\x89PNG")


def test_a_capital_pdf_already_on_disk_is_still_found(tmp_path):
    root = tmp_path / "data"
    data = make_deck(tmp_path / "deck.pdf", n=2).read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    (root / "files" / sha).mkdir(parents=True)
    (root / "files" / sha / "OLD.PDF").write_bytes(data)
    assert files.find_file(sha, root).name == "OLD.PDF"
    assert [f.sha256 for f in files.list_files(root)] == [sha]


def test_a_failed_upload_removes_only_its_own_file(tmp_path):
    root = tmp_path / "data"
    bad = b"%PDF-1.7 broken"
    folder = root / "files" / hashlib.sha256(bad).hexdigest()
    folder.mkdir(parents=True)
    (folder / "notes.txt").write_text("keep me")
    with pytest.raises(ValueError, match="cannot be read"):
        files.store_pdf(bad, "x.pdf", root=root)
    assert [p.name for p in folder.iterdir()] == ["notes.txt"]


def test_a_failed_upload_with_nothing_else_leaves_no_folder(tmp_path):
    root = tmp_path / "data"
    bad = b"%PDF-1.7 broken"
    with pytest.raises(ValueError, match="cannot be read"):
        files.store_pdf(bad, "x.pdf", root=root)
    assert not (root / "files" / hashlib.sha256(bad).hexdigest()).exists()


def test_a_page_png_write_that_fails_leaves_no_partial_cache_file(tmp_path, monkeypatch):
    root = tmp_path / "data"
    monkeypatch.setattr(files, "_resolved", {})
    deck = make_deck(tmp_path / "deck.pdf")
    run = make_extract_run(root, "current", deck, purpose="explore")
    sha = run.meta["source"]["sha256"]

    def disk_full(*args, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(files.os, "replace", disk_full)
    with pytest.raises(OSError, match="disk full"):
        files.page_png(sha, 2, root)
    cache = root / "cache" / "png"
    assert not (cache / f"{sha}-2.png").exists()
    assert list(cache.glob("*.tmp")) == []
