import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

import backend.eval.parser_bench as bench_pkg
from backend.eval.parser_bench.store import REPO
from backend.tests.unit.parser_bench_fixtures import TITLES, make_deck

RUNNERS = Path(bench_pkg.__file__).parent / "runners"


def _load(name):
    spec = importlib.util.spec_from_file_location(name, RUNNERS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_current_matches_production(tmp_path):
    """The standalone copy must equal production's own function, byte for byte."""
    from backend.services.parser.unified_orchestrator import _extract_pages

    pdf = make_deck(tmp_path / "deck.pdf").read_bytes()
    assert _load("current_runner").extract(pdf) == _extract_pages(pdf)


def test_current_runner_writes_the_contract(tmp_path):
    deck, out = make_deck(tmp_path / "deck.pdf"), tmp_path / "out.json"
    subprocess.run([sys.executable, "-I", str(RUNNERS / "current_runner.py"), str(deck), str(out)], check=True)
    data = json.loads(out.read_text(encoding="utf-8"))
    assert set(data) == {"version", "settings", "pages"}
    assert sorted(data["pages"], key=int) == [str(n) for n in range(1, 7)]
    assert TITLES[2] in data["pages"]["3"]


def test_every_runner_has_usage_in_its_docstring_and_is_registered():
    from backend.eval.parser_bench import tools

    runners = [f for f in RUNNERS.iterdir() if f.is_file() and f.suffix in (".py", ".mjs")]
    assert {f.name for f in runners} == {t.runner_path.name for t in tools.TOOLS.values()}
    for f in runners:
        assert "Usage:" in f.read_text(encoding="utf-8"), f.name


def _odl_markdown(odl, pages):
    """What ODL writes: the runner's own separator, placeholder filled, before every page."""
    return "".join("\n" + odl.SEPARATOR.replace("%page-number%", str(n)) + "\n" + text for n, text in pages)


def test_opendataloader_split_pages_reads_the_separator_it_asks_for():
    odl = _load("opendataloader_runner")  # imports without opendataloader_pdf: that import lives in main()
    assert odl.split_pages(_odl_markdown(odl, [(1, "A\n\nline two"), (2, "  B  "), (3, "")])) == {
        "1": "A\n\nline two",
        "2": "B",
        "3": "",
    }
    assert odl.split_pages("\n<<<LS-PAGE 1>>>\nA\n<<<LS-PAGE 2>>>\nB") == {"1": "A", "2": "B"}


@pytest.mark.parametrize(
    "markdown, why",
    [
        ("", "empty output"),
        ("Plain markdown, separator not honoured", "no separator at all"),
        ("stray text\n<<<LS-PAGE 1>>>\nA", "text before the first separator"),
        ("\n<<<LS-PAGE 1>>>\nA\n<<<LS-PAGE 3>>>\nC", "a page missing in the middle"),
        ("\n<<<LS-PAGE 2>>>\nB\n<<<LS-PAGE 3>>>\nC", "does not start at page 1"),
        ("\n<<<LS-PAGE 1>>>\nA\n<<<LS-PAGE 1>>>\nA again", "a repeated page"),
    ],
)
def test_opendataloader_split_pages_refuses_a_partial_result(markdown, why):
    odl = _load("opendataloader_runner")
    with pytest.raises(ValueError):
        odl.split_pages(markdown)


def _fake_opendataloader(monkeypatch, markdown, calls):
    """Stand in for opendataloader_pdf: write `markdown` where the real one would, record the arguments."""
    import types

    def convert(**kwargs):
        calls.append(kwargs)
        target = Path(kwargs["output_dir"])
        target.mkdir(parents=True)
        (target / "input.md").write_text(markdown, encoding="utf-8")

    monkeypatch.setitem(sys.modules, "opendataloader_pdf", types.SimpleNamespace(convert=convert))


def test_opendataloader_main_exits_nonzero_and_writes_nothing_when_the_split_fails(tmp_path, monkeypatch):
    odl = _load("opendataloader_runner")
    deck, out = make_deck(tmp_path / "deck.pdf"), tmp_path / "out.json"
    _fake_opendataloader(monkeypatch, "Plain markdown, separator not honoured", [])
    with pytest.raises(SystemExit) as raised:
        odl.main(["runner", str(deck), str(out)])
    assert raised.value.code not in (0, None) and "opendataloader" in str(raised.value.code)
    assert not out.exists()


def test_opendataloader_main_records_what_it_applied(tmp_path, monkeypatch):
    odl = _load("opendataloader_runner")
    monkeypatch.setattr(odl, "version", lambda name: "0.0-test")
    deck, out, calls = make_deck(tmp_path / "deck.pdf"), tmp_path / "out.json", []
    _fake_opendataloader(monkeypatch, _odl_markdown(odl, [(1, "A"), (2, "B")]), calls)
    odl.main(["runner", str(deck), str(out)])
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["pages"] == {"1": "A", "2": "B"}
    (applied,) = calls
    settings = data["settings"]
    assert applied["include_header_footer"] is False and settings["include_header_footer"] is False
    assert applied["quiet"] is True and settings["quiet"] is True
    assert applied["image_output"] == settings["image_output"] == "off"
    assert applied["format"] == settings["format"] == "markdown"
    assert applied["markdown_page_separator"] == "\n" + settings["markdown_page_separator"] + "\n"


def test_pymupdf4llm_pages_from_chunks_wants_one_chunk_per_page():
    mod = _load("pymupdf4llm_runner")
    chunks = [{"text": "one"}, {"text": "two"}]
    assert mod.pages_from_chunks(chunks, 2) == {"1": "one", "2": "two"}
    with pytest.raises(ValueError):
        mod.pages_from_chunks(chunks, 3)
    with pytest.raises(ValueError):
        mod.pages_from_chunks(chunks[:1], 2)
    with pytest.raises(KeyError):  # no silent default for a chunk without text
        mod.pages_from_chunks([{"text": "one"}, {}], 2)


NODE = shutil.which("node")
PDFJS = REPO / "node_modules" / "pdfjs-dist"


@pytest.mark.skipif(not NODE or not PDFJS.exists(), reason="node or node_modules/pdfjs-dist missing")
def test_pdfjs_runner(tmp_path):
    deck, out = make_deck(tmp_path / "deck.pdf"), tmp_path / "out.json"
    subprocess.run([NODE, str(RUNNERS / "pdfjs_runner.mjs"), str(deck), str(out)], check=True)
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["version"].startswith("5.")
    assert TITLES[2] in data["pages"]["3"]
    assert data["settings"]["isEvalSupported"] is False and data["settings"]["verbosity"] == 0


class FakeDoclingDoc:
    """What DoclingDocument offers the runner: pages by number and a Markdown export per page."""

    def __init__(self, numbers):
        self.pages = {n: object() for n in numbers}

    def export_to_markdown(self, page_no=None):
        return f"# page {page_no}"


def test_docling_reads_one_markdown_text_per_page():
    docling = _load("docling_runner")  # imports without docling: that import lives in main()
    assert docling.pages_from_document(FakeDoclingDoc([2, 1, 3]), 3) == {"1": "# page 1", "2": "# page 2", "3": "# page 3"}
    with pytest.raises(ValueError, match=r"pages \[1, 3\] for a PDF of 3 pages"):
        docling.pages_from_document(FakeDoclingDoc([1, 3]), 3)
    # docling 2.92.0 is in the backend .venv from the design demo, so the device may resolve here or be "unknown"
    assert isinstance(docling.device(), str) and docling.device()


def _paginated(pages):
    return "".join(f"\n\n{{{n}}}" + "-" * 48 + f"\n\n{text}" for n, text in pages)


def test_marker_splits_its_paginated_markdown_at_its_page_marks():
    marker = _load("marker_runner")  # imports without marker: that import lives in main()
    assert marker.split_pages(_paginated([(0, "# A\n\nline"), (1, ""), (2, "C  ")]), 3) == {"1": "# A\n\nline", "2": "", "3": "C"}
    with pytest.raises(ValueError, match="page marks"):
        marker.split_pages(_paginated([(0, "A"), (2, "C")]), 3)
    with pytest.raises(ValueError, match="page marks"):
        marker.split_pages("no marks at all", 1)
    with pytest.raises(ValueError, match="before the first page mark"):
        marker.split_pages("stray" + _paginated([(0, "A")]), 1)
    dashed = "a line of ------------------------------------------------ dashes"
    assert marker.split_pages(_paginated([(0, dashed)]), 1) == {"1": dashed}
    # a final empty page (a mark with nothing after it) is a page with empty text
    assert marker.split_pages(_paginated([(0, "A"), (1, "")]), 2) == {"1": "A", "2": ""}
    assert marker.split_pages(_paginated([(0, "A"), (1, "")]).rstrip("\n"), 2) == {"1": "A", "2": ""}
    # marker may or may not be importable here, so the device is a string either way (like docling's)
    assert isinstance(marker.device(), str) and marker.device()


def test_mineru_renders_each_page_of_its_middle_json():
    mineru = _load("mineru_runner")  # imports without mineru: that import lives in main()
    middle = {"pages": [{"page_idx": 1, "blocks": ["b"]}, {"page_idx": 0, "blocks": ["a"]}], "_backend": "x"}
    seen = []

    def to_markdown(one_page):
        seen.append(one_page)
        return "# " + "".join(one_page["pages"][0].get("blocks", []))

    assert mineru.pages_from_middle(middle, to_markdown, 2) == {"1": "# a", "2": "# b"}
    assert all(m["_backend"] == "x" and len(m["pages"]) == 1 for m in seen)  # each page keeps the document's keys
    with pytest.raises(ValueError, match=r"pages \[1\] for a PDF of 2 pages"):
        mineru.pages_from_middle({"pages": [{"page_idx": 0}]}, to_markdown, 2)
    with pytest.raises(ValueError, match="no pages list"):
        mineru.pages_from_middle({"pdf_info": []}, to_markdown, 1)
    with pytest.raises(ValueError, match="page_idx 0 twice"):
        mineru.pages_from_middle({"pages": [{"page_idx": 0}, {"page_idx": 0}]}, to_markdown, 1)
    with pytest.raises(ValueError, match="no page_idx"):
        mineru.pages_from_middle({"pages": [{"blocks": []}]}, to_markdown, 1)
    assert mineru.TIER == "basic"


def test_mineru_content_list_items_must_lie_on_the_pdfs_pages():
    mineru = _load("mineru_runner")
    mineru.check_content_list([{"type": "text", "page_idx": 0}, {"type": "table", "page_idx": 1}], 2)
    with pytest.raises(ValueError, match=r"page_idx \[2\]"):
        mineru.check_content_list([{"type": "text", "page_idx": 2}], 2)
    with pytest.raises(ValueError, match="not a list"):
        mineru.check_content_list({"type": "text"}, 2)


class _FakeMiddle:
    """Stands in for mineru's MiddleJson: pages are objects with page_idx; model_copy keeps the other fields."""

    def __init__(self, pages):
        self.pages = pages

    def model_copy(self, update):
        return _FakeMiddle(update["pages"])


def _fake_mineru(monkeypatch, pages, content_list):
    """A fake `mineru` package: parse() returns the pages; render() honours MarkdownRenderOptions.image_renderer."""
    import enum
    import types
    from dataclasses import dataclass
    from typing import Callable, Optional

    class RenderFormat(enum.Enum):
        MARKDOWN = "markdown"
        CONTENT_LIST = "content_list"

    @dataclass
    class MarkdownRenderOptions:
        image_renderer: Optional[Callable] = None

    seen = {}

    def render(middle, fmt, options=None):
        if fmt is RenderFormat.CONTENT_LIST:
            return content_list
        seen["options"] = options
        out = []
        for page in middle.pages:
            for block in page["blocks"]:
                if block["type"] == "image":
                    # the real renderer: image_renderer wins over the block's own bytes, and a chart with content
                    # still emits its image from the bytes
                    out.append(options.image_renderer(block) if options and options.image_renderer
                               else f"![](data:image/png;base64,{block['bytes']})")
                elif block["type"] == "chart":
                    out.append(f"![](data:image/png;base64,{block['bytes']})\n\n<details>{block['text']}</details>")
                else:
                    out.append(block["text"])
        return "\n\n".join(out)

    def parse(path, tier):
        seen["tier"] = tier
        return types.SimpleNamespace(middle_json=_FakeMiddle(pages),
                                     to_dict=lambda: pytest.fail("pages must come from the live object"))

    parser_mod, render_mod = types.ModuleType("mineru.parser"), types.ModuleType("mineru.render")
    parser_mod.parse = parse
    render_mod.render, render_mod.RenderFormat = render, RenderFormat
    render_mod.MarkdownRenderOptions = MarkdownRenderOptions
    root = types.ModuleType("mineru")
    root.parser, root.render = parser_mod, render_mod
    for name, mod in (("mineru", root), ("mineru.parser", parser_mod), ("mineru.render", render_mod)):
        monkeypatch.setitem(sys.modules, name, mod)
    return seen


def test_mineru_marks_every_image_as_a_figure_and_keeps_no_image_bytes(tmp_path, monkeypatch):
    from backend.eval.parser_bench.normalize import normalize_figures

    mineru = _load("mineru_runner")
    pages = [
        {"page_idx": 0, "blocks": [{"type": "text", "text": "Title"},
                                   {"type": "image", "bytes": "AAAA"}, {"type": "text", "text": "after"}]},
        {"page_idx": 1, "blocks": [{"type": "chart", "bytes": "BBBB", "text": "a | b"}]},
    ]
    seen = _fake_mineru(monkeypatch, pages, [{"type": "text", "page_idx": 0}, {"type": "chart", "page_idx": 1}])
    monkeypatch.setattr(mineru, "count_pages", lambda path: 2)
    monkeypatch.setattr(mineru, "version", lambda name: "4.1.3")
    src, out = tmp_path / "in.pdf", tmp_path / "out.json"
    src.write_bytes(b"%PDF-1.4")
    mineru.main(["mineru_runner.py", str(src), str(out)])
    data = json.loads(out.read_text(encoding="utf-8"))
    assert seen["tier"] == "basic" and seen["options"].image_renderer is mineru.figure_marker
    assert "data:" not in out.read_text(encoding="utf-8") and "AAAA" not in out.read_text(encoding="utf-8")
    assert "BBBB" not in out.read_text(encoding="utf-8")  # a chart's own image bytes are marked too
    assert normalize_figures(data["pages"]["1"]) == "Title\n\n[figure]\n\nafter"
    assert normalize_figures(data["pages"]["2"]).startswith("[figure]\n\n<details>a | b")
    assert data["settings"]["images"].startswith("marker ![figure](figure)")
    assert data["settings"]["small_model_backend"] == "unknown" and data["settings"]["device"] == "unknown"  # no mineru here


def test_mineru_records_the_backend_and_device_it_resolves_to(monkeypatch):
    import types

    mineru = _load("mineru_runner")
    device = types.ModuleType("mineru.model.runtime.device")
    device.get_device, device.resolve_small_model_backend = lambda: "mps", lambda: "torch"
    config = types.ModuleType("mineru.config")
    config.get_config = lambda: types.SimpleNamespace(model=types.SimpleNamespace(onnx_device="auto"))
    for name in ("mineru", "mineru.model", "mineru.model.runtime"):
        monkeypatch.setitem(sys.modules, name, types.ModuleType(name))
    monkeypatch.setitem(sys.modules, "mineru.model.runtime.device", device)
    monkeypatch.setitem(sys.modules, "mineru.config", config)
    assert mineru.runtime() == {"small_model_backend": "torch", "device": "mps", "onnx_device_setting": "auto"}


def test_mineru_loads_its_weights_on_one_thread_set_before_mineru_is_imported(tmp_path, monkeypatch):
    import types

    mineru = _load("mineru_runner")
    monkeypatch.setenv("HF_DEACTIVATE_ASYNC_LOAD", "x")
    monkeypatch.delenv("HF_DEACTIVATE_ASYNC_LOAD")  # unset now, and unset again when the test ends
    at_import = {}

    def fake_parse(path, tier):
        raise SystemExit("stop: the import is what this test looks at")

    parser_mod, render_mod = types.ModuleType("mineru.parser"), types.ModuleType("mineru.render")
    parser_mod.parse = fake_parse
    render_mod.render = render_mod.RenderFormat = render_mod.MarkdownRenderOptions = None

    class Recording(types.ModuleType):
        def __getattr__(self, name):
            raise AttributeError(name)

    root = Recording("mineru")
    root.__dict__["__path__"] = []
    for name, mod in (("mineru", root), ("mineru.parser", parser_mod), ("mineru.render", render_mod)):
        monkeypatch.setitem(sys.modules, name, mod)
    real_import = __builtins__["__import__"] if isinstance(__builtins__, dict) else __builtins__.__import__

    def watching_import(name, *args, **kwargs):
        if name == "mineru.parser":
            at_import["value"] = __import__("os").environ.get("HF_DEACTIVATE_ASYNC_LOAD")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr("builtins.__import__", watching_import)
    src = tmp_path / "in.pdf"
    src.write_bytes(b"%PDF-1.4")
    monkeypatch.setattr(mineru, "count_pages", lambda path: 1)
    with pytest.raises(SystemExit):
        mineru.main(["mineru_runner.py", str(src), str(tmp_path / "out.json")])
    assert at_import == {"value": "1"}


def test_mineru_records_that_it_loads_its_weights_on_one_thread(tmp_path, monkeypatch):
    mineru = _load("mineru_runner")
    monkeypatch.setenv("HF_DEACTIVATE_ASYNC_LOAD", "x")
    monkeypatch.delenv("HF_DEACTIVATE_ASYNC_LOAD")
    _fake_mineru(monkeypatch, [{"page_idx": 0, "blocks": [{"type": "text", "text": "T"}]}], [{"type": "text", "page_idx": 0}])
    monkeypatch.setattr(mineru, "count_pages", lambda path: 1)
    monkeypatch.setattr(mineru, "version", lambda name: "4.1.3")
    src, out = tmp_path / "in.pdf", tmp_path / "out.json"
    src.write_bytes(b"%PDF-1.4")
    mineru.main(["mineru_runner.py", str(src), str(out)])
    assert json.loads(out.read_text(encoding="utf-8"))["settings"]["weight_loading"].startswith("one thread (HF_DEACTIVATE_ASYNC_LOAD=1")
    import os

    assert os.environ["HF_DEACTIVATE_ASYNC_LOAD"] == "1"


def test_mineru_leaked_image_syntax_becomes_the_figure_marker():
    mineru = _load("mineru_runner")
    assert mineru.mark_leaked_images("a ![x](data:image/png;base64,QQ) b <img src='data:x'> c") == \
        "a ![figure](figure) b ![figure](figure) c"
    assert mineru.figure_marker(object()) == "![figure](figure)"


class FakePaddlePage(dict):
    """A PaddleX result: dict-like, with its page_index when the input was a PDF, and a markdown dict."""

    def __init__(self, text, index=None):
        super().__init__({} if index is None else {"page_index": index})
        self.markdown = {"markdown_texts": text, "markdown_images": {}}


def test_paddle_runner_reads_one_markdown_text_per_page():
    paddle = _load("paddleocr_runner")  # imports without paddleocr: that import lives in main()
    assert paddle.pages_from_results([FakePaddlePage("a"), FakePaddlePage("b")], 2) == {"1": "a", "2": "b"}
    assert paddle.pages_from_results([FakePaddlePage("b", 1), FakePaddlePage("a", 0)], 2) == {"1": "a", "2": "b"}
    with pytest.raises(ValueError, match=r"pages \[1\] for a PDF of 2 pages"):
        paddle.pages_from_results([FakePaddlePage("a")], 2)
    with pytest.raises(ValueError, match="page 1 came twice"):
        paddle.pages_from_results([FakePaddlePage("a", 0), FakePaddlePage("b", 0)], 2)
    broken = FakePaddlePage("a")
    broken.markdown = {}
    with pytest.raises(ValueError, match="page 1 has no Markdown text"):
        paddle.pages_from_results([broken], 1)
    assert paddle.page_index({"page_index": True}) is None and paddle.page_index([]) is None


def test_marker_points_surya_s_server_registry_at_a_folder_of_its_own_run(tmp_path):
    import types

    marker = _load("marker_runner")
    spawn = types.SimpleNamespace(_cache_dir=lambda: Path("/elsewhere"))
    folder = marker.isolate_servers(spawn, tmp_path)
    assert spawn._cache_dir() == folder and folder.is_dir() and folder.parent == tmp_path
    shutil.rmtree(folder)
    assert spawn._cache_dir() == folder and folder.is_dir()  # surya's helper makes its folder on every call too


def test_marker_stops_every_server_named_in_its_own_registry(tmp_path):
    import os
    import time

    marker = _load("marker_runner")
    servers = tmp_path / "servers"
    servers.mkdir()
    # stand-ins for surya's servers: each leads a session of its own, as surya starts them
    started = [subprocess.Popen(["sleep", "60"], start_new_session=True) for _ in range(2)]
    stubborn = subprocess.Popen([sys.executable, "-c", "import signal, time; signal.signal(signal.SIGTERM, signal.SIG_IGN); "
                                 "print('ready', flush=True); time.sleep(60)"], start_new_session=True, stdout=subprocess.PIPE)
    stubborn.stdout.readline()  # SIGTERM is ignored from here on
    try:
        for name, proc in (("layout", started[0]), ("llamacpp", started[1]), ("ocr_error", stubborn)):
            (servers / f"{name}_server.json").write_text(json.dumps({"port": 1, "pid": proc.pid, "backend": name}))
        (servers / "broken_server.json").write_text("{not json")
        (servers / "nopid_server.json").write_text(json.dumps({"port": 1, "pid": None}))
        before = time.monotonic()
        marker.stop_servers(servers, grace=0.5)
        assert 0.5 <= time.monotonic() - before < 10  # the one that ignores SIGTERM got its grace, then SIGKILL
        for proc in (*started, stubborn):
            proc.wait(timeout=5)
            with pytest.raises(ProcessLookupError):
                os.kill(proc.pid, 0)
    finally:
        for proc in (*started, stubborn):
            if proc.poll() is None:
                proc.kill()
                proc.wait()
        stubborn.stdout.close()


def test_marker_stops_its_servers_on_failure_and_removes_its_registry_folder(tmp_path, monkeypatch):
    import os
    import types

    marker = _load("marker_runner")
    seen = {}

    def converting(argv, run_dir):
        seen["run_dir"] = run_dir
        folder = marker.isolate_servers(types.SimpleNamespace(), run_dir)
        server = subprocess.Popen(["sleep", "60"], start_new_session=True)
        seen["server"] = server
        (folder / "llamacpp_server.json").write_text(json.dumps({"port": 1, "pid": server.pid}))
        raise SystemExit("marker_runner: failed half way")

    monkeypatch.setattr(marker, "_convert", converting)
    monkeypatch.setattr(marker, "stop_children", lambda *a, **k: None)  # the children of the test process are not ours
    try:
        with pytest.raises(SystemExit, match="half way"):
            marker.main(["marker_runner.py", "in.pdf", "out.json"])
        seen["server"].wait(timeout=5)
        with pytest.raises(ProcessLookupError):
            os.kill(seen["server"].pid, 0)
        assert not Path(seen["run_dir"]).exists()
    finally:
        if seen["server"].poll() is None:
            seen["server"].kill()
            seen["server"].wait()


def test_marker_stops_a_descendant_that_has_no_sentinel():
    """stop_children runs in a process of its own, so that it only ever sees the descendants started there."""
    import os

    helper = (
        "import importlib.util, os, subprocess, sys\n"
        "spec = importlib.util.spec_from_file_location('marker_runner', sys.argv[1])\n"
        "marker = importlib.util.module_from_spec(spec)\n"
        "spec.loader.exec_module(marker)\n"
        "child = subprocess.Popen(['sleep', '60'], start_new_session=True, stdout=subprocess.DEVNULL,\n"
        "                         stderr=subprocess.DEVNULL)  # as surya starts its servers\n"
        "print(child.pid, flush=True)\n"
        "marker.stop_children(grace=0.5)\n"
        "print(marker._alive(child.pid), flush=True)\n"
    )
    done = subprocess.run([sys.executable, "-c", helper, str(RUNNERS / "marker_runner.py")],
                          capture_output=True, text=True, timeout=60)
    pid, alive_after = done.stdout.split()
    try:
        assert done.returncode == 0 and alive_after == "False", done.stderr
        with pytest.raises(ProcessLookupError):
            os.kill(int(pid), 0)
    finally:  # a failing run must not leave the sleeper behind
        try:
            os.killpg(int(pid), 9)
        except (ProcessLookupError, PermissionError):
            pass


def _marker_main_with(marker, monkeypatch, convert_error, failing_step):
    """Run marker.main with a fake conversion and every cleanup step recorded; `failing_step` raises when it runs."""
    steps, seen = [], {}

    def converting(argv, run_dir):
        seen["run_dir"] = run_dir
        if convert_error:
            raise SystemExit(convert_error)

    def step(name):
        def run(*a, **k):
            steps.append(name)
            if name == failing_step:
                raise OSError(f"{name} broke")
        return run

    monkeypatch.setattr(marker, "_convert", converting)
    monkeypatch.setattr(marker, "stop_servers", step("stop_servers"))
    monkeypatch.setattr(marker, "stop_children", step("stop_children"))
    return steps, seen


def test_marker_s_cleanup_steps_all_run_and_never_replace_the_conversion_s_error(monkeypatch, capsys):
    marker = _load("marker_runner")
    steps, seen = _marker_main_with(marker, monkeypatch, "marker_runner: failed half way", "stop_servers")
    with pytest.raises(SystemExit, match="half way"):  # not the OSError of the failed step
        marker.main(["marker_runner.py", "in.pdf", "out.json"])
    assert steps == ["stop_servers", "stop_children"] and not Path(seen["run_dir"]).exists()
    assert "stop_servers failed" in capsys.readouterr().err  # the failed step is reported, not hidden


def test_marker_s_cleanup_failing_after_a_good_conversion_does_not_fail_the_run(monkeypatch):
    marker = _load("marker_runner")
    steps, seen = _marker_main_with(marker, monkeypatch, None, "stop_children")
    marker.main(["marker_runner.py", "in.pdf", "out.json"])
    assert steps == ["stop_servers", "stop_children"] and not Path(seen["run_dir"]).exists()


def test_marker_records_that_its_servers_are_its_own(tmp_path, monkeypatch):
    import types

    marker = _load("marker_runner")
    spawn_pkg = {"surya": types.ModuleType("surya"), "surya.inference": types.ModuleType("surya.inference"),
                 "surya.inference.backends": types.ModuleType("surya.inference.backends")}
    spawn = types.ModuleType("surya.inference.backends.spawn")
    spawn._cache_dir = lambda: Path("/elsewhere")
    spawn_pkg["surya.inference.backends"].spawn = spawn
    modules = {**spawn_pkg, "surya.inference.backends.spawn": spawn}

    seen = {}

    class Converter:
        config, llm_service, mode = {"paginate_output": True}, None, "fast"

        def __init__(self, artifact_dict, config):
            pass

        def __call__(self, src):
            seen["registry"] = spawn._cache_dir()
            return "{0}" + "-" * 48 + "\nHello"

    for name, mod in modules.items():
        monkeypatch.setitem(sys.modules, name, mod)
    for name, attrs in (("marker.converters.pdf", {"PdfConverter": Converter}),
                        ("marker.models", {"create_model_dict": lambda: {}}),
                        ("marker.output", {"text_from_rendered": lambda rendered: (rendered, None, None)})):
        mod = types.ModuleType(name)
        mod.__dict__.update(attrs)
        monkeypatch.setitem(sys.modules, name, mod)
    for name in ("marker", "marker.converters"):
        monkeypatch.setitem(sys.modules, name, types.ModuleType(name))
    monkeypatch.setattr(marker, "count_pages", lambda path: 1)
    monkeypatch.setattr(marker, "version", lambda name: "2.1.0")
    monkeypatch.setattr(marker, "stop_children", lambda *a, **k: None)
    out = tmp_path / "out.json"
    marker.main(["marker_runner.py", "in.pdf", str(out)])
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["pages"] == {"1": "Hello"} and data["settings"]["paginate_output"] is True
    assert data["settings"]["servers"] == "started by this run and stopped at its end; never shared between runs"
    # redirected before use; asked inside the run, because surya's helper makes its folder on every call
    assert seen["registry"] != Path("/elsewhere") and "ls-marker-" in str(seen["registry"])
    assert not seen["registry"].parent.exists()  # the run folder is gone


def _inside(path, folder):
    import os

    return os.path.realpath(path).startswith(os.path.realpath(folder) + os.sep)


def test_mineru_copies_the_pdf_into_its_run_folder_and_removes_the_copy(tmp_path, monkeypatch):
    mineru = _load("mineru_runner")
    run = tmp_path / "run"
    run.mkdir()
    monkeypatch.chdir(run)  # execute.invoke() starts every runner in a folder of its own and removes it afterwards
    seen = _fake_mineru(monkeypatch, [{"page_idx": 0, "blocks": [{"type": "text", "text": "T"}]}], [{"type": "text", "page_idx": 0}])
    parser_mod, plain_parse = sys.modules["mineru.parser"], sys.modules["mineru.parser"].parse
    copies = []

    def parse(path, tier):
        copies.append(path)
        return plain_parse(path, tier)

    parser_mod.parse = parse
    monkeypatch.setattr(mineru, "count_pages", lambda path: 1)
    monkeypatch.setattr(mineru, "version", lambda name: "4.1.3")
    src, out = tmp_path / "elsewhere" / " in.pdf", tmp_path / "out.json"
    src.parent.mkdir()
    src.write_bytes(b"%PDF-1.4")
    mineru.main(["mineru_runner.py", str(src), str(out)])
    assert seen["tier"] == "basic" and len(copies) == 1
    assert _inside(copies[0], run) and not Path(copies[0]).exists() and list(run.iterdir()) == []


def test_marker_makes_its_run_folder_inside_the_working_folder(tmp_path, monkeypatch):
    marker = _load("marker_runner")
    run = tmp_path / "run"
    run.mkdir()
    monkeypatch.chdir(run)
    steps, seen = _marker_main_with(marker, monkeypatch, None, None)
    marker.main(["marker_runner.py", "in.pdf", "out.json"])
    assert _inside(seen["run_dir"], run) and not Path(seen["run_dir"]).exists()


def test_the_runners_count_pages_the_same_way():
    """Runners run with `python -I` and cannot import each other: each carries its own count_pages, and
    the copies must not drift."""
    import inspect

    copies = {name: inspect.getsource(_load(name).count_pages)
              for name in ("docling_runner", "marker_runner", "mineru_runner", "paddleocr_runner")}
    assert len(set(copies.values())) == 1, copies


def _fake_paddleocr(monkeypatch, pages):
    """A paddleocr module whose two pipelines record how they were built and called, and return `pages`."""
    import types

    seen = {"built": [], "predicted": []}

    def pipeline(name):
        class Pipeline:
            def __init__(self, *args, **kwargs):
                seen["built"].append((name, args, kwargs))
                if name == "vl":
                    self.pipeline_version, self._paddlex_pipeline_name = "v1.6", "PaddleOCR-VL-1.6"
                else:
                    self._paddlex_pipeline_name = "PP-StructureV3"
                self.paddlex_pipeline = types.SimpleNamespace(use_doc_preprocessor=True)

            def predict(self, input, **kwargs):
                seen["predicted"].append((name, input, kwargs))
                return iter(pages)

        return Pipeline

    module = types.ModuleType("paddleocr")
    module.PPStructureV3, module.PaddleOCRVL = pipeline("structure"), pipeline("vl")
    monkeypatch.setitem(sys.modules, "paddleocr", module)
    return seen


@pytest.mark.parametrize("flag,pipeline,expected", [("structure", "PP-StructureV3", "structure"),
                                                    ("vl", "PaddleOCR-VL", "vl")])
def test_one_paddle_runner_serves_both_pipelines_on_their_defaults(tmp_path, monkeypatch, flag, pipeline, expected):
    paddle = _load("paddleocr_runner")
    run = tmp_path / "run"
    run.mkdir()
    monkeypatch.chdir(run)  # execute.invoke() starts every runner in a folder of its own and removes it afterwards
    seen = _fake_paddleocr(monkeypatch, [FakePaddlePage("one", 0), FakePaddlePage("two", 1)])
    monkeypatch.setattr(paddle, "count_pages", lambda path: 2)
    monkeypatch.setattr(paddle, "version", lambda name: "3.7.0")
    src, out = tmp_path / "in.pdf", tmp_path / "out.json"
    src.write_bytes(b"%PDF-1.4")
    paddle.main(["paddleocr_runner.py", "--pipeline", flag, str(src), str(out)])
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["pages"] == {"1": "one", "2": "two"} and data["version"] == "3.7.0"
    assert data["settings"]["pipeline"] == pipeline and data["settings"]["defaults"] is True
    assert [(name, args, kwargs) for name, args, kwargs in seen["built"]] == [(expected, (), {})]  # defaults: no arguments
    [(name, given, kwargs)] = seen["predicted"]
    assert name == expected and given != str(src) and given.endswith("input.pdf") and kwargs == {}  # a plain copy
    assert _inside(given, run) and not Path(given).exists() and list(run.iterdir()) == []  # kept in the run's folder, removed


def test_the_paddle_runner_needs_a_known_pipeline(tmp_path, monkeypatch):
    paddle = _load("paddleocr_runner")
    seen = _fake_paddleocr(monkeypatch, [])
    out = tmp_path / "out.json"
    for argv in (["r.py", "in.pdf", str(out)], ["r.py", "--pipeline", "other", "in.pdf", str(out)]):
        with pytest.raises(SystemExit) as stopped:
            paddle.main(argv)
        assert stopped.value.code == 2
    assert not out.exists() and seen["built"] == []  # nothing was built or written


def test_a_partial_paddle_result_writes_nothing(tmp_path, monkeypatch):
    paddle = _load("paddleocr_runner")
    _fake_paddleocr(monkeypatch, [FakePaddlePage("one", 0)])
    monkeypatch.setattr(paddle, "count_pages", lambda path: 2)
    src, out = tmp_path / "in.pdf", tmp_path / "out.json"
    src.write_bytes(b"%PDF-1.4")
    with pytest.raises(SystemExit, match=r"paddleocr_runner: the results have pages \[1\] for a PDF of 2 pages"):
        paddle.main(["paddleocr_runner.py", "--pipeline", "vl", str(src), str(out)])
    assert not out.exists()


def test_paddle_images_become_the_figure_marker_and_no_image_bytes_are_kept(tmp_path, monkeypatch):
    from backend.eval.parser_bench.normalize import normalize_figures

    paddle = _load("paddleocr_runner")
    page = ('Title\n\n<div style="text-align: center;"><img src="imgs/img_in_image_box_1.jpg" alt="Image" '
            'width="40%" /></div>\n\n![](imgs/chart_2.jpg)\n\n'
            '<div style="text-align: center;"><img src="data:image/png;base64,QUFBQQ==" alt="Image" /></div>\n\n'
            '<table border="1"><tr><td>a</td></tr></table>')
    _fake_paddleocr(monkeypatch, [FakePaddlePage(page, 0)])
    monkeypatch.setattr(paddle, "count_pages", lambda path: 1)
    monkeypatch.setattr(paddle, "version", lambda name: "3.7.0")
    src, out = tmp_path / "in.pdf", tmp_path / "out.json"
    src.write_bytes(b"%PDF-1.4")
    paddle.main(["paddleocr_runner.py", "--pipeline", "structure", str(src), str(out)])
    raw = out.read_text(encoding="utf-8")
    assert "data:" not in raw and "QUFB" not in raw and "imgs/" not in raw
    text = json.loads(raw)["pages"]["1"]
    assert normalize_figures(text).count("[figure]") == 3 and "<img" not in normalize_figures(text)
    assert '<table border="1"><tr><td>a</td></tr></table>' in text  # HTML tables stay as Paddle writes them
    assert 'Title' in text and '<div style="text-align: center;">' in text  # nothing else is touched


def test_paddle_leaked_image_syntax_becomes_the_figure_marker():
    paddle = _load("paddleocr_runner")
    assert paddle.mark_images("a ![x](data:image/png;base64,QQ) b <img src='data:x'/> c <IMG src=\"imgs/a.jpg\" /> d") == \
        "a ![figure](figure) b ![figure](figure) c ![figure](figure) d"


@pytest.mark.parametrize("flag,version_,pipeline", [("vl", "v1.6", "PaddleOCR-VL-1.6"),
                                                    ("structure", "unknown", "PP-StructureV3")])
def test_paddle_settings_record_the_pipeline_that_actually_ran(tmp_path, monkeypatch, flag, version_, pipeline):
    paddle = _load("paddleocr_runner")
    _fake_paddleocr(monkeypatch, [FakePaddlePage("one", 0)])
    monkeypatch.setattr(paddle, "count_pages", lambda path: 1)
    monkeypatch.setattr(paddle, "version", lambda name: "3.7.0")
    src, out = tmp_path / "in.pdf", tmp_path / "out.json"
    src.write_bytes(b"%PDF-1.4")
    paddle.main(["paddleocr_runner.py", "--pipeline", flag, str(src), str(out)])
    settings = json.loads(out.read_text(encoding="utf-8"))["settings"]
    # the effective values, read from the objects, not the YAML defaults: the layout pipeline turns the
    # document preprocessor on through its own True defaults even though its YAML says False
    assert (settings["pipeline_version"], settings["paddlex_pipeline"], settings["use_doc_preprocessor"]) == \
        (version_, pipeline, True)


def test_paddle_settings_say_unknown_for_what_cannot_be_read():
    paddle = _load("paddleocr_runner")
    assert paddle.describe(object()) == {"pipeline_version": "unknown", "paddlex_pipeline": "unknown",
                                         "use_doc_preprocessor": "unknown"}


# paddleocr_vl_hf: fakes for torch, huggingface_hub and transformers; no model, no network

class _Seq(list):
    """A stand-in for a 1-D tensor: indexing, slicing and .shape[-1]."""

    @property
    def shape(self):
        return (len(self),)

    def __getitem__(self, key):
        item = list.__getitem__(self, key)
        return _Seq(item) if isinstance(key, slice) else item


class _Inputs(dict):
    def to(self, device):
        self.device_seen = device
        return self


def _fake_vl(monkeypatch, *, generated=(11, 12, 13, 2), fail=None, mps=True, eos=2):
    """Fake torch + huggingface_hub + transformers. `generated` is what generate() adds after the 3 prompt tokens.
    `fail` is a callable (device, dtype name, call) -> exception or None, called on each generate()."""
    import contextlib
    import types

    log = {"calls": [], "decode": [], "loads": [], "snapshot": None, "template": [], "env": {}}
    torch = types.ModuleType("torch")
    torch.bfloat16, torch.float16, torch.float32 = "bfloat16", "float16", "float32"
    torch.backends = types.SimpleNamespace(mps=types.SimpleNamespace(is_available=lambda: mps))
    torch.inference_mode = contextlib.nullcontext
    torch.mps = types.SimpleNamespace(empty_cache=lambda: log.setdefault("emptied", []).append(1))
    hub = types.ModuleType("huggingface_hub")

    def snapshot_download(**kwargs):
        log["snapshot"] = kwargs
        return "/snap/dir"

    hub.snapshot_download = snapshot_download
    transformers = types.ModuleType("transformers")

    class Processor:
        image_processor = types.SimpleNamespace(size=types.SimpleNamespace(shortest_edge=147384))  # a SizeDict, as in 5.22.1

        @classmethod
        def from_pretrained(cls, path, **kwargs):
            log["processor"] = (path, kwargs)
            return cls()

        def apply_chat_template(self, messages, **kwargs):
            log["template"].append((messages, kwargs))
            log["env"].setdefault("at_template", __import__("os").environ.get("HF_DEACTIVATE_ASYNC_LOAD"))
            return _Inputs(input_ids=_Seq([5, 6, 7]))

        def decode(self, tokens, **kwargs):
            log["decode"].append((list(tokens), kwargs))
            return "text " + ",".join(str(t) for t in tokens if t != 2)

    class Model:
        generation_config = types.SimpleNamespace(eos_token_id=eos)
        device = "device-of-model"

        def __init__(self, dtype):
            self.dtype, self.where = dtype, None

        @classmethod
        def from_pretrained(cls, path, dtype=None, **kwargs):
            log["loads"].append((path, dtype, kwargs))
            log["env"].setdefault("at_load", __import__("os").environ.get("HF_DEACTIVATE_ASYNC_LOAD"))
            return cls(dtype)

        def to(self, device):
            self.where = device
            return self

        def eval(self):
            return self

        def generate(self, **kwargs):
            log["calls"].append((self.where, self.dtype, kwargs.pop("max_new_tokens"), kwargs.pop("do_sample", None)))
            problem = fail(self.where, self.dtype, len(log["calls"])) if fail else None
            if problem:
                raise problem
            return _Seq([_Seq([5, 6, 7, *generated])])

    transformers.AutoProcessor, transformers.AutoModelForImageTextToText = Processor, Model
    for name, mod in (("torch", torch), ("huggingface_hub", hub), ("transformers", transformers)):
        monkeypatch.setitem(sys.modules, name, mod)
    return log


def _vl_main(tmp_path, monkeypatch, pages=2, **fake):
    runner = _load("paddleocr_vl_hf_runner")
    monkeypatch.setenv("HF_DEACTIVATE_ASYNC_LOAD", "x")
    monkeypatch.delenv("HF_DEACTIVATE_ASYNC_LOAD")  # unset now, and unset again when the test ends
    monkeypatch.delenv("HF_HUB_OFFLINE", raising=False)
    log = _fake_vl(monkeypatch, **fake)
    monkeypatch.setattr(runner, "version", lambda name: {"transformers": "5.22.1"}.get(name, "9.9"))
    src, out = make_deck(tmp_path / "deck.pdf", pages), tmp_path / "out.json"
    return runner, log, src, out


def test_paddleocr_vl_hf_reads_every_page_with_the_card_prompt_and_decodes_only_new_tokens(tmp_path, monkeypatch):
    runner, log, src, out = _vl_main(tmp_path, monkeypatch, pages=3)
    runner.main(["paddleocr_vl_hf_runner.py", str(src), str(out)])
    data = json.loads(out.read_text(encoding="utf-8"))
    assert set(data) == {"version", "settings", "pages"}
    assert data["pages"] == {"1": "text 11,12,13", "2": "text 11,12,13", "3": "text 11,12,13"}  # no prompt tokens, no EOS
    assert [d[0] for d in log["decode"]] == [[11, 12, 13, 2]] * 3 and all(d[1] == {"skip_special_tokens": True} for d in log["decode"])
    assert len(log["loads"]) == 1 and len(log["template"]) == 3  # one load per run, one chat template per page
    for messages, kwargs in log["template"]:
        content = messages[0]["content"]
        assert [c["type"] for c in content] == ["image", "text"] and content[1]["text"] == "OCR:"
        image = content[0]["image"]
        assert image.mode == "RGB" and image.size == (842 * 2, 595 * 2)  # zoom 2 of a 842 x 595 pt page
        assert kwargs["add_generation_prompt"] and kwargs["tokenize"] and kwargs["return_dict"] and kwargs["return_tensors"] == "pt"
        assert kwargs["images_kwargs"] == {"size": {"shortest_edge": 147384, "longest_edge": 1280 * 28 * 28}}
    assert all(c == ("mps", "bfloat16", 4096, False) for c in log["calls"]) and len(log["calls"]) == 3
    assert data["version"] == "transformers 5.22.1 + PaddleOCR-VL-1.6@c5630ab"


def test_paddleocr_vl_hf_loads_one_pinned_local_snapshot_on_one_thread_set_before_transformers(tmp_path, monkeypatch):
    runner, log, src, out = _vl_main(tmp_path, monkeypatch, pages=1)
    runner.main(["paddleocr_vl_hf_runner.py", str(src), str(out)])
    import os

    assert log["snapshot"] == {"repo_id": "PaddlePaddle/PaddleOCR-VL-1.6",
                               "revision": "c5630abae1d940eafe0697512a0325494b02ab42", "local_files_only": True}
    assert log["loads"][0][0] == "/snap/dir" and log["loads"][0][2] == {"local_files_only": True}  # never a download
    assert log["processor"] == ("/snap/dir", {"local_files_only": True})
    assert os.environ["HF_DEACTIVATE_ASYNC_LOAD"] == "1" and os.environ["HF_HUB_OFFLINE"] == "1"
    assert log["env"]["at_load"] == "1"


def test_paddleocr_vl_hf_sets_the_one_thread_switch_before_it_imports_transformers(tmp_path, monkeypatch):
    runner, log, src, out = _vl_main(tmp_path, monkeypatch, pages=1)
    seen = {}
    real_import = __builtins__["__import__"] if isinstance(__builtins__, dict) else __builtins__.__import__

    def watching_import(name, *args, **kwargs):
        if name in ("transformers", "torch"):
            seen.setdefault(name, __import__("os").environ.get("HF_DEACTIVATE_ASYNC_LOAD"))
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr("builtins.__import__", watching_import)
    runner.main(["paddleocr_vl_hf_runner.py", str(src), str(out)])
    assert seen == {"torch": "1", "transformers": "1"}


def test_paddleocr_vl_hf_records_its_settings_the_device_and_the_dtype_it_used(tmp_path, monkeypatch):
    runner, log, src, out = _vl_main(tmp_path, monkeypatch, pages=2)
    runner.main(["paddleocr_vl_hf_runner.py", str(src), str(out)])
    s = json.loads(out.read_text(encoding="utf-8"))["settings"]
    assert (s["repo"], s["revision"]) == (runner.REPO, runner.REVISION) == ("PaddlePaddle/PaddleOCR-VL-1.6", "c5630abae1d940eafe0697512a0325494b02ab42")
    assert (s["device"], s["dtype"], s["prompt"], s["zoom"]) == ("mps", "bfloat16", "OCR:", 2.0)
    assert (s["max_pixels"], s["min_pixels"], s["max_new_tokens"]) == (1280 * 28 * 28, 147384, 4096)
    assert s["decoding"] == "greedy (do_sample False)" and s["failed_attempts"] == []
    assert s["route"] == "transformers (element-level per the model card; whole page image)"
    assert s["weight_loading"].startswith("one thread (HF_DEACTIVATE_ASYNC_LOAD=1")
    assert s["truncated_pages"] == [] and s["new_tokens"] == {"1": 4, "2": 4}


def test_paddleocr_vl_hf_reads_the_lower_pixel_bound_from_the_processors_size():
    import types

    runner = _load("paddleocr_vl_hf_runner")
    as_object = types.SimpleNamespace(image_processor=types.SimpleNamespace(size=types.SimpleNamespace(shortest_edge=112896)))
    as_dict = types.SimpleNamespace(image_processor=types.SimpleNamespace(size={"shortest_edge": 112896}))
    assert runner.min_pixels_of(as_object) == runner.min_pixels_of(as_dict) == 112896  # no min_pixels attribute in 5.22.1


def test_paddleocr_vl_hf_runner_constants_equal_the_tool_entrys():
    from backend.eval.parser_bench import tools

    runner = _load("paddleocr_vl_hf_runner")
    assert (runner.REPO, runner.REVISION) == (tools.PADDLEOCR_VL_HF_REPO, tools.PADDLEOCR_VL_HF_REVISION)


def test_paddleocr_vl_hf_names_a_page_that_hit_max_new_tokens_as_truncated(tmp_path, monkeypatch):
    runner, log, src, out = _vl_main(tmp_path, monkeypatch, pages=2, generated=tuple(range(100, 100 + 4096)))
    runner.main(["paddleocr_vl_hf_runner.py", str(src), str(out)])
    s = json.loads(out.read_text(encoding="utf-8"))["settings"]
    assert s["truncated_pages"] == [1, 2] and s["new_tokens"] == {"1": 4096, "2": 4096}
    # an answer that ends with EOS exactly at the limit is complete, not truncated
    runner, log, src, out = _vl_main(tmp_path, monkeypatch, pages=1, generated=(*range(100, 100 + 4095), 2))
    runner.main(["paddleocr_vl_hf_runner.py", str(src), str(out)])
    assert json.loads(out.read_text(encoding="utf-8"))["settings"]["truncated_pages"] == []


def test_paddleocr_vl_hf_falls_back_to_the_next_dtype_and_device_and_says_so(tmp_path, monkeypatch):
    def fail(device, dtype, call):
        if device == "mps":
            return NotImplementedError("op not implemented for MPS")

    runner, log, src, out = _vl_main(tmp_path, monkeypatch, pages=2, fail=fail)
    runner.main(["paddleocr_vl_hf_runner.py", str(src), str(out)])
    data = json.loads(out.read_text(encoding="utf-8"))
    assert [(c[0], c[1]) for c in log["calls"]] == [("mps", "bfloat16"), ("mps", "float16"), ("cpu", "float32"),
                                                      ("cpu", "float32")]  # the first page is the trial; the model is reloaded
    s = data["settings"]
    assert (s["device"], s["dtype"]) == ("cpu", "float32") and len(s["failed_attempts"]) == 2
    assert s["failed_attempts"][0].startswith("mps bfloat16: NotImplementedError") and sorted(data["pages"]) == ["1", "2"]


def test_paddleocr_vl_hf_goes_straight_to_the_cpu_without_mps(tmp_path, monkeypatch):
    runner, log, src, out = _vl_main(tmp_path, monkeypatch, pages=1, mps=False)
    runner.main(["paddleocr_vl_hf_runner.py", str(src), str(out)])
    s = json.loads(out.read_text(encoding="utf-8"))["settings"]
    assert (s["device"], s["dtype"], s["failed_attempts"]) == ("cpu", "float32", [])


def test_paddleocr_vl_hf_exits_non_zero_writing_nothing_when_no_device_can_run_it(tmp_path, monkeypatch):
    runner, log, src, out = _vl_main(tmp_path, monkeypatch, pages=1, fail=lambda d, t, c: RuntimeError("boom"))
    with pytest.raises(SystemExit) as exc:
        runner.main(["paddleocr_vl_hf_runner.py", str(src), str(out)])
    assert "no device and dtype could run the model" in str(exc.value) and not out.exists()


def test_paddleocr_vl_hf_exits_non_zero_writing_nothing_when_a_later_page_fails(tmp_path, monkeypatch):
    runner, log, src, out = _vl_main(tmp_path, monkeypatch, pages=3, fail=lambda d, t, call: RuntimeError("page 2 broke") if call == 2 else None)
    with pytest.raises(RuntimeError, match="page 2 broke"):  # not a fallback: only the first page is the trial
        runner.main(["paddleocr_vl_hf_runner.py", str(src), str(out)])
    assert not out.exists()
