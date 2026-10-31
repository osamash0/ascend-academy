import argparse
import subprocess
from types import SimpleNamespace

import pytest

from backend.eval.parser_bench import __main__ as cli
from backend.eval.parser_bench import execute, paid, store, tools
from backend.tests.unit.parser_bench_fixtures import make_deck


def test_page_ranges():
    assert cli._pages("1,4-6") == [1, 4, 5, 6]


def test_a_reversed_page_range_is_refused():
    # 6-4 used to give no pages at all, and an empty page list means "every page".
    with pytest.raises(argparse.ArgumentTypeError):
        cli._pages("6-4")


def test_tools_lists_every_method(capsys):
    assert cli.main(["tools"]) == 0
    out = capsys.readouterr().out
    for tool_id in tools.TOOLS:
        assert tool_id in out
    assert "current" in out and "ready" in out


def test_run_current_makes_a_finished_run(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("PARSER_BENCH_DIR", str(tmp_path / "data"))
    deck = make_deck(tmp_path / "deck.pdf")
    assert cli.main(["run", "current", str(deck), "--pages", "2-3", "--no-warmup"]) == 0
    assert "finished" in capsys.readouterr().out
    [meta] = store.list_runs()
    assert (meta["tool"], meta["pages_scored"], meta["purpose"]) == ("current", [2, 3], "explore")


def test_benchmark_without_a_protocol_is_refused(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("PARSER_BENCH_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(execute, "protocol_commit", lambda: None)
    deck = make_deck(tmp_path / "deck.pdf")
    assert cli.main(["run", "current", str(deck), "--purpose", "benchmark", "--no-warmup"]) == 2
    assert "PROTOCOL.md" in capsys.readouterr().err
    assert store.list_runs() == []


def test_runs_and_export(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("PARSER_BENCH_DIR", str(tmp_path / "data"))
    deck = make_deck(tmp_path / "deck.pdf")
    cli.main(["run", "current", str(deck), "--no-warmup"])
    capsys.readouterr()
    assert cli.main(["runs"]) == 0
    [meta] = store.list_runs()
    assert meta["run_id"] in capsys.readouterr().out
    assert cli.main(["export", meta["run_id"]]) == 2  # an explore run never reaches the thesis
    assert "explore" in capsys.readouterr().err


def test_runs_with_a_data_root_inside_the_repo_is_one_line_and_exit_2(monkeypatch, capsys):
    monkeypatch.setenv("PARSER_BENCH_DIR", str(store.REPO / "bench-data"))
    assert cli.main(["runs"]) == 2
    err = capsys.readouterr().err
    assert "inside the repository" in err and err.count("\n") == 1


def test_a_missing_peak_memory_prints_a_dash_not_none(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("PARSER_BENCH_DIR", str(tmp_path / "data"))
    run = store.ExtractRun.create(tool="current", version="1.27.1", source={"name": "d.pdf"}, purpose="explore")
    run.finish("finished", seconds_per_page=0.1, peak_memory_mb=None)
    assert cli.main(["runs"]) == 0
    out = capsys.readouterr().out
    assert "None" not in out
    assert "0.1 s/page  peak — MB" in out


def test_run_summary_prints_a_dash_for_a_missing_peak(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("PARSER_BENCH_DIR", str(tmp_path / "data"))
    run = store.ExtractRun.create(tool="current", version="1.27.1", source={"name": "d.pdf"}, purpose="explore")
    run.finish("finished", seconds_per_page=0.1, peak_memory_mb=None)
    monkeypatch.setattr(execute, "run_tool", lambda *args, **kwargs: run)
    assert cli.main(["run", "current", "unused.pdf"]) == 0
    out = capsys.readouterr().out
    assert "0.1 s/page, peak — MB" in out
    assert "None" not in out


def test_a_failed_run_exits_1_and_lists_dashes_for_absent_measures(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("PARSER_BENCH_DIR", str(tmp_path / "data"))
    run = store.ExtractRun.create(tool="current", version="1.27.1", source={"name": "d.pdf"}, purpose="explore")
    run.finish("failed", reason="current exited with code 3")
    monkeypatch.setattr(execute, "run_tool", lambda *args, **kwargs: run)
    assert cli.main(["run", "current", "unused.pdf"]) == 1
    assert "current exited with code 3" in capsys.readouterr().out
    assert cli.main(["runs"]) == 0
    out = capsys.readouterr().out
    assert "None" not in out and "— s/page  peak — MB" in out


def test_install_refused_when_the_disk_is_short(monkeypatch, capsys):
    def refuse(tool, **kwargs):
        raise tools.DiskSpaceError("installing current would leave less than 3 GB free")

    monkeypatch.setattr(tools, "install", refuse)
    assert cli.main(["install", "current"]) == 2
    assert "3 GB" in capsys.readouterr().err


@pytest.mark.parametrize(
    ("error", "cause"),
    [
        (subprocess.CalledProcessError(1, ["uv", "pip", "install"]), "uv exited with code 1"),
        (FileNotFoundError(2, "No such file or directory", "node"), "No such file or directory: 'node'"),
    ],
)
def test_install_failures_are_one_line_and_exit_2(monkeypatch, capsys, error, cause):
    def fail(tool, **kwargs):
        raise error

    monkeypatch.setattr(tools, "install", fail)
    assert cli.main(["install", "pdfjs"]) == 2
    err = capsys.readouterr().err
    assert err.count("\n") == 1 and "Traceback" not in err
    assert "install pdfjs failed" in err and cause in err


# --- Plan 2: select ------------------------------------------------------------------

from backend.eval.parser_bench import pageset, sources  # noqa: E402


def test_select_show_prints_each_page_title(tmp_path, monkeypatch, capsys):
    swt = sources.BENCHMARK_SOURCES[0]
    deck = tmp_path / swt.files[0]
    deck.parent.mkdir(parents=True)
    make_deck(deck)
    monkeypatch.setattr(sources.Source, "paths", lambda self, deck_dir=tmp_path: tuple(deck_dir / f for f in self.files))
    assert cli.main(["select", "show", "swt"]) == 0
    out = capsys.readouterr().out
    assert "(6 pages)" in out and "Merge Conflicts" in out


def test_select_draw_writes_the_page_set(tmp_path, monkeypatch, capsys):
    chosen = tmp_path / "chosen.json"
    chosen.write_text("{}")
    assert cli.main(["select", "draw", str(chosen), "--seed", "1", "--out", str(tmp_path / "p.json")]) == 2
    assert "swt: 0 chosen" in capsys.readouterr().err
    monkeypatch.setattr(pageset, "draw", lambda picks, seed: {"seed": seed, "pages": [{"key": "swt-p9", "file": "2.pdf", "page": 9, "how": "random"}]})
    assert cli.main(["select", "draw", str(chosen), "--seed", "1", "--out", str(tmp_path / "p.json")]) == 0
    assert "drawn: swt-p9" in capsys.readouterr().out and (tmp_path / "p.json").exists()


# --- Plan 2: compare -----------------------------------------------------------------

from backend.tests.unit.parser_bench_compare_fixtures import (  # noqa: E402
    bench_pages_of, make_comparison, make_extract_run, make_pooled, vote_all)


def test_compare_create_needs_the_protocol(monkeypatch, capsys, tmp_path):
    monkeypatch.setenv("PARSER_BENCH_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(execute, "protocol_commit", lambda: None)
    assert cli.main(["compare", "create", "--tools", "current,pdfjs", "--seed", "1"]) == 2
    assert "PROTOCOL.md" in capsys.readouterr().err


def test_compare_create_from_benchmark_runs(monkeypatch, capsys, tmp_path):
    root = tmp_path / "data"
    monkeypatch.setenv("PARSER_BENCH_DIR", str(root))
    deck = make_deck(tmp_path / "deck.pdf")
    sha = sources.sha256_file(deck)
    pages = [pageset.BenchPage(f"d-p{n}", "swt", "deck.pdf", sha, n, t, "chosen", "r")
             for n, t in zip(range(1, 7), ("layout", "lists", "table_formula", "diagram", "dense_text", "lists"))]
    monkeypatch.setattr(pageset, "load", lambda path=pageset.PAGESET: pages)
    monkeypatch.setattr(execute, "benchmark_gate", lambda: {"protocol_commit": "abc123", "bench_tree": "t"})
    for tool in ("current", "pdfjs"):
        make_extract_run(root, tool, deck, tree="t")
    assert cli.main(["compare", "create", "--tools", "current,pdfjs", "--seed", "3"]) == 0
    assert "judging  0/3 duels" in capsys.readouterr().out


def test_compare_create_refuses_a_bench_changed_since_the_protocol(monkeypatch, capsys, tmp_path):
    monkeypatch.setenv("PARSER_BENCH_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(execute, "protocol_commit", lambda: "abc123")
    monkeypatch.setattr(execute, "bench_changes", lambda: [])
    monkeypatch.setattr(execute, "bench_drift", lambda commit: ["backend/eval/parser_bench/results.py"])
    assert cli.main(["compare", "create", "--tools", "current,pdfjs", "--seed", "1"]) == 2
    assert "deviation" in capsys.readouterr().err


def test_compare_status_hides_names_until_judging_is_finished(monkeypatch, capsys, tmp_path):
    root = tmp_path / "data"
    monkeypatch.setenv("PARSER_BENCH_DIR", str(root))
    cmp = make_comparison(root, tmp_path)
    assert cli.main(["compare", "status"]) == 0
    out = capsys.readouterr().out
    assert "0/10 duels" in out and "hidden" in out and "alphatool" not in out
    assert "round" not in out
    vote_all(cmp)
    cmp.finish()
    assert cli.main(["compare", "status", cmp.run_id]) == 0
    out = capsys.readouterr().out
    assert "alphatool" in out and "self-consistency" in out
    assert "round 1" in out


# --- Plan 2: serve -------------------------------------------------------------------

from backend.eval.parser_bench import server  # noqa: E402


def test_serve_binds_to_localhost_only(monkeypatch, capsys):
    called = {}
    monkeypatch.setattr(server, "serve", lambda port: called.setdefault("port", port))
    assert cli.main(["serve", "--port", "8799"]) == 0
    assert called == {"port": 8799} and "http://127.0.0.1:8799" in capsys.readouterr().out


def test_a_paid_run_prints_its_cost_and_needs_cost_ok(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("PARSER_BENCH_DIR", str(tmp_path / "data"))
    deck = make_deck(tmp_path / "deck.pdf")
    called = []
    fake = SimpleNamespace(meta={"run_id": "r1", "status": "finished", "reason": None, "seconds_per_page": 1.0,
                                 "peak_memory_mb": None}, path=tmp_path)
    monkeypatch.setattr(execute, "run_tool", lambda *a, **k: called.append(k) or fake)
    assert cli.main(["run", "ai_vision", str(deck)]) == 2
    out, err = capsys.readouterr()
    assert "ai_vision: 6 page images to OpenAI (gpt-4.1-mini), estimated $0.02" in out and "--cost-ok" in err
    assert called == []
    assert cli.main(["run", "ai_vision", str(deck), "--pages", "2", "--cost-ok"]) == 0
    assert "1 page image to OpenAI" in capsys.readouterr().out and called[0]["cost_ok"] is True


def test_a_free_run_passes_no_cost_ok(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("PARSER_BENCH_DIR", str(tmp_path / "data"))
    deck = make_deck(tmp_path / "deck.pdf")
    called = []
    fake = SimpleNamespace(meta={"run_id": "r1", "status": "finished", "reason": None, "seconds_per_page": 1.0,
                                 "peak_memory_mb": None}, path=tmp_path)
    monkeypatch.setattr(execute, "run_tool", lambda *a, **k: called.append(k) or fake)
    assert cli.main(["run", "current", str(deck), "--no-warmup"]) == 0
    assert "OpenAI" not in capsys.readouterr().out
    assert len(called) == 1 and called[0]["cost_ok"] is False


def test_models_lists_the_live_ids_or_says_what_is_wrong(monkeypatch, capsys):
    monkeypatch.setattr(paid, "list_models", lambda: ["gpt-a", "gpt-b"])
    assert cli.main(["models"]) == 0
    assert capsys.readouterr().out.split() == ["gpt-a", "gpt-b"]

    def no_key():
        raise paid.KeyFileError("key file missing (~/.config/learnstation-parser-bench/openai_key)")

    monkeypatch.setattr(paid, "list_models", no_key)
    assert cli.main(["models"]) == 2
    assert "key file missing" in capsys.readouterr().err


def test_compare_create_against_a_finished_comparison(monkeypatch, capsys, tmp_path):
    root = tmp_path / "data"
    monkeypatch.setenv("PARSER_BENCH_DIR", str(root))
    base = make_comparison(root, tmp_path)
    vote_all(base)
    base.finish()
    for tool in ("gammatool", "deltatool"):
        make_extract_run(root, tool, tmp_path / "deck.pdf")
    monkeypatch.setattr(pageset, "load", lambda path=pageset.PAGESET: bench_pages_of(base))
    monkeypatch.setattr(execute, "benchmark_gate", lambda: {"protocol_commit": "abc123", "bench_tree": None})
    assert cli.main(["compare", "create", "--tools", "gammatool,deltatool", "--against", base.run_id, "--seed", "5"]) == 0
    assert "judging  0/23 duels" in capsys.readouterr().out


def test_compare_create_against_two_comparisons_with_opponents(monkeypatch, capsys, tmp_path):
    root = tmp_path / "data"
    monkeypatch.setenv("PARSER_BENCH_DIR", str(root))
    base = make_comparison(root, tmp_path)
    vote_all(base)
    base.finish()
    second = make_pooled(root, tmp_path, base)
    vote_all(second)
    second.finish()
    for tool in ("epsilontool", "zetatool"):
        make_extract_run(root, tool, tmp_path / "deck.pdf")
    monkeypatch.setattr(pageset, "load", lambda path=pageset.PAGESET: bench_pages_of(base))
    monkeypatch.setattr(execute, "benchmark_gate", lambda: {"protocol_commit": "abc123", "bench_tree": None})
    argv = ["compare", "create", "--tools", "epsilontool,zetatool", "--against", f"{base.run_id},{second.run_id}",
            "--opponents", "gammatool,current", "--seed", "5"]
    assert cli.main(argv) == 0
    assert "judging  0/17 duels" in capsys.readouterr().out


def test_compare_create_against_an_unknown_comparison_says_which(monkeypatch, capsys, tmp_path):
    monkeypatch.setenv("PARSER_BENCH_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(execute, "benchmark_gate", lambda: {"protocol_commit": "abc123", "bench_tree": None})
    assert cli.main(["compare", "create", "--tools", "gammatool", "--against", "cmp-2026-01-01_dead", "--seed", "5"]) == 2
    assert "cmp-2026-01-01_dead" in capsys.readouterr().err


def test_opponents_need_against(monkeypatch, capsys, tmp_path):
    monkeypatch.setenv("PARSER_BENCH_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(execute, "benchmark_gate", lambda: {"protocol_commit": "abc123", "bench_tree": None})
    assert cli.main(["compare", "create", "--tools", "gammatool", "--opponents", "current", "--seed", "5"]) == 2
    assert "--opponents needs --against" in capsys.readouterr().err


def test_clear_models_deletes_a_heavy_methods_models_only(monkeypatch, capsys, tmp_path):
    monkeypatch.setenv("PARSER_BENCH_MODELS", str(tmp_path / "models"))
    blob = tmp_path / "models" / "docling" / "huggingface" / "blob"
    blob.parent.mkdir(parents=True)
    blob.write_bytes(b"x" * 2**20)
    assert cli.main(["clear-models", "docling"]) == 0
    assert "docling: 1 MB of models deleted" in capsys.readouterr().out
    assert not (tmp_path / "models" / "docling").exists()
    assert cli.main(["clear-models", "current"]) == 2
    assert "keeps no downloaded models" in capsys.readouterr().err


def test_clear_models_refuses_a_method_whose_models_come_only_from_install(monkeypatch, capsys, tmp_path):
    monkeypatch.setenv("PARSER_BENCH_MODELS", str(tmp_path / "models"))
    blob = tmp_path / "models" / "mineru" / "blob"
    blob.parent.mkdir(parents=True)
    blob.write_bytes(b"x" * 2**20)
    assert cli.main(["clear-models", "mineru"]) == 2
    captured = capsys.readouterr()
    assert "not cleared" in captured.err and "install mineru" in captured.err
    assert "deleted" not in captured.out
    assert blob.exists()  # nothing was removed


def test_clear_models_force_clears_it_and_says_how_to_get_the_models_back(monkeypatch, capsys, tmp_path):
    monkeypatch.setenv("PARSER_BENCH_MODELS", str(tmp_path / "models"))
    blob = tmp_path / "models" / "marker" / "blob"
    blob.parent.mkdir(parents=True)
    blob.write_bytes(b"x" * 2**20)
    assert cli.main(["clear-models", "marker", "--force"]) == 0
    out = capsys.readouterr().out
    assert "marker: 1 MB of models deleted" in out
    assert "install marker" in out
    assert not (tmp_path / "models" / "marker").exists()


def test_clear_models_says_the_next_warm_up_downloads_them_for_a_lazy_method(monkeypatch, capsys, tmp_path):
    monkeypatch.setenv("PARSER_BENCH_MODELS", str(tmp_path / "models"))
    assert cli.main(["clear-models", "docling"]) == 0
    assert "next warm-up downloads them again" in capsys.readouterr().out


def test_tools_shows_each_heavy_methods_model_folder(monkeypatch, capsys, tmp_path):
    monkeypatch.setenv("PARSER_BENCH_MODELS", str(tmp_path / "models"))
    assert cli.main(["tools"]) == 0
    lines = capsys.readouterr().out.splitlines()
    assert "models 0.0 MB" in next(line for line in lines if line.startswith("docling"))
    assert "models" not in next(line for line in lines if line.startswith("current"))
