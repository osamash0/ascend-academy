import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

import backend.eval.parser_bench as bench_pkg
from backend.eval.parser_bench import store


def test_a_record_is_fsynced_before_it_replaces_the_old_one(tmp_path, monkeypatch):
    calls = []
    real_fsync, real_replace = os.fsync, os.replace
    monkeypatch.setattr(os, "fsync", lambda fd: (calls.append("fsync"), real_fsync(fd))[1])
    monkeypatch.setattr(os, "replace", lambda a, b: (calls.append("replace"), real_replace(a, b))[1])
    store._write_text(tmp_path / "compare.json", "{}")
    assert calls == ["fsync", "replace"]
    assert (tmp_path / "compare.json").read_text() == "{}"

SRC = {"path": "/x/deck.pdf", "name": "deck.pdf", "sha256": "ab" * 32, "pages_total": 3}


def make(tmp_path, **kw):
    args = dict(tool="current", version="1.27.1", source=SRC, purpose="explore", root=tmp_path)
    args.update(kw)
    return store.ExtractRun.create(**args)


def make_compare_folder(root, name="cmp-2026-10-30_a1b2"):
    """A compare run by hand: only compare.json (no run.json), plus votes and a log."""
    folder = root / "runs" / "compare" / name
    folder.mkdir(parents=True)
    record = {"run_id": name, "kind": "compare", "purpose": "benchmark", "status": "finished", "source": dict(SRC)}
    (folder / "compare.json").write_text(json.dumps(record), encoding="utf-8")
    (folder / "votes.jsonl").write_text('{"pair": 1, "winner": "a"}\n', encoding="utf-8")
    (folder / "log.txt").write_text("tool output", encoding="utf-8")
    return folder


def test_run_id_format():
    rid = store.new_run_id("Doc ling", "2.92.0", now=datetime(2026, 10, 30, tzinfo=timezone.utc), token="7f3a")
    assert rid == "2026-10-30_doc-ling-2.92.0_7f3a"


def test_create_writes_a_running_record(tmp_path):
    run = make(tmp_path)
    m = run.meta
    assert (m["status"], m["kind"], m["purpose"], m["tool"]) == ("running", "extract", "explore", "current")
    assert m["source"]["sha256"] == SRC["sha256"]
    assert set(m["git"]) == {"commit", "dirty"}
    assert m["machine"]["ram_gb"] > 0
    assert run.path.parent == tmp_path / "runs" / "extract"


def test_every_record_names_its_record_and_checks_versions(tmp_path):
    assert store.RECORD_VERSION == 1
    m = make(tmp_path, checks_version=2).meta
    assert (m["record_version"], m["checks_version"]) == (1, 2)


def test_create_keeps_the_git_state_it_is_given(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "git_state", lambda: pytest.fail("git_state must not run when git is given"))
    assert make(tmp_path, git={"commit": "abc", "dirty": False}).meta["git"] == {"commit": "abc", "dirty": False}


def test_create_reads_the_git_state_when_none_is_given(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "git_state", lambda: {"commit": "now", "dirty": True})
    assert make(tmp_path).meta["git"] == {"commit": "now", "dirty": True}


@pytest.mark.parametrize("key", [
    "run_id", "kind", "tool", "version", "purpose", "source", "git", "machine", "started_at", "record_version",
    "finished_at",
])
def test_finish_refuses_to_overwrite_what_create_recorded(tmp_path, key):
    run = make(tmp_path)
    with pytest.raises(ValueError, match=key):
        run.finish("finished", **{key: "x"})
    assert run.meta["status"] == "running" and run.meta.get(key) != "x"


def test_status_and_reason_are_reserved_too():
    assert {"status", "reason"} <= store.RESERVED


def test_two_runs_never_share_a_folder(tmp_path):
    assert make(tmp_path).path != make(tmp_path).path


def test_rejects_an_unknown_purpose(tmp_path):
    with pytest.raises(ValueError):
        make(tmp_path, purpose="thesis")


def test_a_finished_run_refuses_every_write(tmp_path):
    run = make(tmp_path)
    run.write_page(2, "hello")
    run.finish("finished", seconds_per_page=0.1)
    assert run.meta["status"] == "finished" and run.meta["finished_at"]
    assert run.meta["seconds_per_page"] == 0.1
    assert run.pages() == {2: "hello"}
    for write in (
        lambda: run.write_page(3, "x"),
        lambda: run.write_checks([{"page": 1}]),
        lambda: run.append_log("x"),
        lambda: run.finish("failed"),
    ):
        with pytest.raises(store.RunFinishedError):
            write()


def test_a_failed_run_is_kept_with_its_reason(tmp_path):
    run = make(tmp_path)
    run.finish("failed", reason="exited with code 3")
    assert (run.meta["status"], run.meta["reason"]) == ("failed", "exited with code 3")
    assert [m["run_id"] for m in store.list_runs(tmp_path)] == [run.run_id]


def test_checks_round_trip(tmp_path):
    run = make(tmp_path)
    run.write_checks([{"page": 1, "footer_leaks": 0}, {"page": 2, "footer_leaks": 3}])
    assert run.checks() == [{"page": "1", "footer_leaks": "0"}, {"page": "2", "footer_leaks": "3"}]


def test_export_leaves_out_slide_text_and_the_log(tmp_path):
    run = make(tmp_path, purpose="benchmark")
    run.write_page(1, "slide text")
    run.append_log("tool output")
    run.write_checks([{"page": 1}])
    run.finish("finished")
    out = store.export_run(run.run_id, root=tmp_path, dest=tmp_path / "export")
    assert sorted(p.name for p in out.iterdir()) == ["checks.csv", "run.json"]


def test_export_drops_the_local_pdf_path(tmp_path):
    run = make(tmp_path, purpose="benchmark")
    run.write_page(1, "slide text")
    run.finish("finished")
    out = store.export_run(run.run_id, root=tmp_path, dest=tmp_path / "export")
    exported = json.loads((out / "run.json").read_text(encoding="utf-8"))
    assert "path" not in exported["source"]
    assert exported["source"] == {k: v for k, v in SRC.items() if k != "path"}
    assert exported["source"]["sha256"] == SRC["sha256"]
    assert run.meta["source"]["path"] == SRC["path"]


def test_export_of_a_compare_run_drops_the_local_pdf_path(tmp_path):
    folder = make_compare_folder(tmp_path)
    out = store.export_run(folder.name, root=tmp_path, dest=tmp_path / "export")
    assert sorted(p.name for p in out.iterdir()) == ["compare.json", "export.json", "votes.jsonl"]
    exported = json.loads((out / "compare.json").read_text(encoding="utf-8"))
    assert exported["source"] == {k: v for k, v in SRC.items() if k != "path"}
    assert json.loads((folder / "compare.json").read_text(encoding="utf-8"))["source"]["path"] == SRC["path"]


def test_a_record_without_source_is_exported_unchanged(tmp_path):
    folder = tmp_path / "runs" / "compare" / "cmp-nosource"
    folder.mkdir(parents=True)
    record = {"run_id": folder.name, "kind": "compare", "purpose": "benchmark", "status": "finished"}
    (folder / "compare.json").write_text(json.dumps(record), encoding="utf-8")
    out = store.export_run(folder.name, root=tmp_path, dest=tmp_path / "export")
    assert json.loads((out / "compare.json").read_text(encoding="utf-8")) == record


def test_a_failed_export_leaves_the_local_path_nowhere_in_the_repo(tmp_path, monkeypatch):
    folder = make_compare_folder(tmp_path)

    def disk_full(path, data):
        raise OSError("disk full")

    monkeypatch.setattr(store, "_write_json", disk_full)
    with pytest.raises(OSError):
        store.export_run(folder.name, root=tmp_path, dest=tmp_path / "export")
    leaked = [
        f for f in (tmp_path / "export").rglob("*")
        if f.is_file() and SRC["path"] in f.read_text(encoding="utf-8")
    ]
    assert leaked == []


def test_export_refuses_explore_and_running_runs(tmp_path):
    explore = make(tmp_path)
    explore.finish("finished")
    with pytest.raises(ValueError, match="explore"):
        store.export_run(explore.run_id, root=tmp_path, dest=tmp_path / "e")
    running = make(tmp_path, purpose="benchmark")
    with pytest.raises(ValueError, match="running"):
        store.export_run(running.run_id, root=tmp_path, dest=tmp_path / "e")


def test_export_copies_only_the_allowlisted_files_of_a_run(tmp_path):
    run = make(tmp_path, purpose="benchmark")
    run.write_page(1, "slide text")
    run.append_log("tool output")
    run.write_checks([{"page": 1}])
    run.finish("finished")
    (run.path / "run.tmp").write_text('{"source": {"path": "/x/deck.pdf"}}', encoding="utf-8")  # a crash leftover
    (run.path / "scratch.json").write_text("{}", encoding="utf-8")
    out = store.export_run(run.run_id, root=tmp_path, dest=tmp_path / "export")
    assert sorted(p.name for p in out.iterdir()) == ["checks.csv", "run.json"]


def test_export_copies_only_the_allowlisted_files_of_a_compare_run(tmp_path):
    folder = make_compare_folder(tmp_path)
    (folder / "results.json").write_text('{"ranking": ["a", "b"]}', encoding="utf-8")
    (folder / "votes.tmp").write_text("partial", encoding="utf-8")
    (folder / "pages").mkdir()
    (folder / "pages" / "p0001.md").write_text("slide text", encoding="utf-8")
    out = store.export_run(folder.name, root=tmp_path, dest=tmp_path / "export")
    assert sorted(p.name for p in out.iterdir()) == ["compare.json", "export.json", "results.json", "votes.jsonl"]
    assert json.loads((out / "results.json").read_text(encoding="utf-8")) == {"ranking": ["a", "b"]}


def test_export_writes_the_home_folder_as_a_tilde(tmp_path):
    home = str(Path.home())
    run = make(tmp_path, purpose="benchmark")
    run.finish("failed", reason=f"could not open {home}/Downloads/deck.pdf")
    out = store.export_run(run.run_id, root=tmp_path, dest=tmp_path / "export")
    assert json.loads((out / "run.json").read_text(encoding="utf-8"))["reason"] == "could not open ~/Downloads/deck.pdf"
    assert home in run.meta["reason"]  # the local record keeps it


def test_export_writes_the_home_folder_as_a_tilde_in_every_json_file(tmp_path):
    home = str(Path.home())
    folder = make_compare_folder(tmp_path)
    (folder / "results.json").write_text(json.dumps({"from": f"{home}/a"}), encoding="utf-8")
    (folder / "votes.jsonl").write_text(json.dumps({"pair": 1, "file": f"{home}/b"}) + "\n", encoding="utf-8")
    out = store.export_run(folder.name, root=tmp_path, dest=tmp_path / "export")
    assert [f.name for f in out.iterdir() if home in f.read_text(encoding="utf-8")] == []
    assert json.loads((out / "results.json").read_text(encoding="utf-8")) == {"from": "~/a"}


def test_export_blanks_notes_and_keeps_every_other_line_byte_for_byte(tmp_path):
    folder = make_compare_folder(tmp_path)
    plain = '{"pair": 2,   "winner": "b"}'  # odd spacing: any rewrite would show
    torn = '{"type": "vote", "note": "the slide sa'
    (folder / "votes.jsonl").write_text(
        '{"pair": 1, "winner": "a", "note": "the slide says so"}\n' + plain + "\n" + torn + "\n", encoding="utf-8")
    out = store.export_run(folder.name, root=tmp_path, dest=tmp_path / "export")
    text = (out / "votes.jsonl").read_text(encoding="utf-8")
    lines = text.split("\n")
    assert json.loads(lines[0]) == {"pair": 1, "winner": "a", "note": None}
    assert lines[1] == plain and lines[2] == "" and lines[3] == ""
    assert "slide" not in text
    report = json.loads((out / "export.json").read_text(encoding="utf-8"))
    assert (report["identical"], report["notes_blanked"], report["lines_rewritten"], report["torn_lines_blanked"]) == (False, 1, 1, 1)


def test_export_refuses_a_record_without_a_purpose(tmp_path):
    folder = tmp_path / "runs" / "compare" / "cmp-nopurpose"
    folder.mkdir(parents=True)
    (folder / "compare.json").write_text(json.dumps({"run_id": folder.name, "status": "finished"}), encoding="utf-8")
    with pytest.raises(ValueError, match="benchmark"):
        store.export_run(folder.name, root=tmp_path, dest=tmp_path / "export")
    assert not (tmp_path / "export").exists()


def test_the_data_root_expands_the_home_folder(monkeypatch):
    monkeypatch.setenv("PARSER_BENCH_DIR", "~/lsbench-not-created")
    assert store.data_root() == (Path.home() / "lsbench-not-created").resolve()


@pytest.mark.parametrize("inside", ["", "data", "docs/thesis/experiments/parser-benchmark/data"])
def test_the_data_root_may_not_lie_inside_the_repo(monkeypatch, inside):
    monkeypatch.setenv("PARSER_BENCH_DIR", str(store.REPO / inside))
    with pytest.raises(ValueError, match="inside the repository"):
        store.data_root()


def test_a_relative_data_root_inside_the_repo_is_refused(monkeypatch):
    monkeypatch.chdir(store.REPO)
    monkeypatch.setenv("PARSER_BENCH_DIR", "bench-data")
    with pytest.raises(ValueError, match="inside the repository"):
        store.data_root()


def test_a_symlink_into_the_repo_is_refused(tmp_path, monkeypatch):
    link = tmp_path / "bench"
    link.symlink_to(store.REPO / "not-there", target_is_directory=True)
    monkeypatch.setenv("PARSER_BENCH_DIR", str(link))
    with pytest.raises(ValueError, match="inside the repository"):
        store.data_root()


@pytest.mark.parametrize("run_id", ["", "..", "../x", "a/b", "a..b", ".hidden", "-x", "run\n"])
def test_find_run_refuses_run_ids_that_are_not_plain_names(tmp_path, run_id):
    (tmp_path / "runs" / "extract" / "x").mkdir(parents=True)
    with pytest.raises(ValueError, match="run id"):
        store.find_run(run_id, tmp_path)


def test_export_refuses_a_run_id_that_climbs_out(tmp_path):
    with pytest.raises(ValueError, match="run id"):
        store.export_run("../x", root=tmp_path, dest=tmp_path / "export")
    assert not (tmp_path / "export").exists()


def test_find_run_names_what_is_missing(tmp_path):
    with pytest.raises(FileNotFoundError, match="nope"):
        store.find_run("nope", tmp_path)


RUNTIME_PROBE = r"""
import importlib, pkgutil, sys
sys.path.insert(0, sys.argv[1])
import backend.eval.parser_bench as pkg
names = [m.name for m in pkgutil.iter_modules(pkg.__path__, pkg.__name__ + ".")]
for name in names:
    importlib.import_module(name)
app = ("backend.core", "backend.services", "backend.api", "backend.repositories", "backend.workers")
leaked = sorted(k for k in sys.modules if k.startswith(app))
dotenv = sorted(k for k in sys.modules if k == "dotenv" or k.startswith("dotenv."))
assert not leaked and not dotenv, (leaked, dotenv)
print(" ".join(sorted(names)))
"""


def test_importing_every_bench_module_loads_nothing_of_the_app():
    """The static check below reads the source; this one imports it, so an indirect import is caught too."""
    probe = subprocess.run([sys.executable, "-I", "-c", RUNTIME_PROBE, str(store.REPO)],
                           capture_output=True, text=True, cwd=store.REPO, timeout=120)
    assert probe.returncode == 0, probe.stderr
    imported = set(probe.stdout.split())
    modules = ("store", "sources", "normalize", "checks", "tools", "execute", "__main__", "pageset", "schedule", "ranking",
               "compare", "results", "files", "blinding", "jobs", "server", "api_runs", "api_compare", "api_newrun")
    assert {f"backend.eval.parser_bench.{m}" for m in modules} <= imported


def test_the_bench_never_imports_the_app():
    """Importing backend.core loads the main checkout's .env (production credentials)."""
    root = Path(bench_pkg.__file__).parent
    pattern = re.compile(
        r"^\s*(?:from|import)\s+backend\.(?:core|services|api|repositories|workers)\b"
        r"|^\s*from\s+backend\s+import\s+\(?\s*(?:core|services|api|repositories|workers)\b",
        re.M,
    )
    offenders = [str(f) for f in root.rglob("*.py") if pattern.search(f.read_text(encoding="utf-8"))]
    assert offenders == []


# --- Plan 2: the main checkout, typed checks, old records, judging comparisons ---------


def test_the_data_root_may_not_lie_inside_the_main_checkout(tmp_path, monkeypatch):
    main = tmp_path / "main"
    monkeypatch.setattr(store, "_main_checkout", lambda: main)
    monkeypatch.setenv("PARSER_BENCH_DIR", str(main / "bench-data"))
    with pytest.raises(ValueError, match="inside the repository"):
        store.data_root()
    monkeypatch.setenv("PARSER_BENCH_DIR", str(tmp_path / "elsewhere"))
    assert store.data_root() == (tmp_path / "elsewhere").resolve()


def test_the_main_checkout_is_found_from_git():
    main = store._main_checkout()
    assert main is not None and (main / ".git").exists()


def test_typed_checks_give_back_numbers_flags_and_nulls(tmp_path):
    run = make(tmp_path)
    run.write_checks([{"page": 2, "footer_leaks": 1, "footer_leaked": True, "footer_token_share": 0.5,
                       "title_first": None, "broken_line_pct": None, "chars": 10, "note": "x"}])
    assert run.typed_checks() == [{"page": 2, "footer_leaks": 1, "footer_leaked": True, "footer_token_share": 0.5,
                                   "title_first": None, "broken_line_pct": None, "chars": 10, "note": "x"}]


def test_old_records_read_as_record_version_0_and_checks_version_1():
    assert (store.record_version({}), store.checks_version({})) == (0, 1)
    assert (store.record_version({"record_version": 1}), store.checks_version({"checks_version": 3})) == (1, 3)


def test_export_refuses_a_comparison_still_being_judged(tmp_path):
    folder = tmp_path / "runs" / "compare" / "cmp-2026-10-30_abcd"
    folder.mkdir(parents=True)
    (folder / "compare.json").write_text(json.dumps({"run_id": folder.name, "status": "judging", "purpose": "benchmark"}))
    with pytest.raises(ValueError, match="judging"):
        store.export_run(folder.name, root=tmp_path, dest=tmp_path / "export")
