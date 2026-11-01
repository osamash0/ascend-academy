import importlib.util
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.eval.parser_bench import paid, tools

UV = "/fake/uv"
FREEZE = "pypdf==6.7.0\nmarkitdown==0.1.6\n"  # deliberately unsorted
JAVA_STDERR = 'openjdk version "22.0.2" 2024-07-16\nOpenJDK Runtime Environment\n'


IMPORT_ERROR = "Traceback (most recent call last):\n  File \"<string>\", line 1, in <module>\nModuleNotFoundError: No module named 'markitdown'\n"


def _fake_uv(monkeypatch, *, fail_install=False, fail_import=False, hang_import=False,
             hang_venv=False, hang_install=False, calls=None):
    """Stand in for uv and the environment's python: `uv venv` makes bin/python or
    hangs past its timeout, `uv pip install` succeeds, raises or hangs, the import
    check passes, fails or hangs past its timeout, and freeze, --version and
    -version answer. Every call's arguments go to `calls` when given."""

    def run(args, **kwargs):
        if calls is not None:
            calls.append((list(args), kwargs))
        if args[1:3] == ["-I", "-c"]:
            if hang_import:
                assert kwargs.get("timeout") == 300  # the probe must be bounded
                raise subprocess.TimeoutExpired(args, kwargs["timeout"])
            return subprocess.CompletedProcess(args, 1 if fail_import else 0, "", IMPORT_ERROR if fail_import else "")
        if args[1:2] == ["venv"]:
            if hang_venv:
                raise subprocess.TimeoutExpired(args, kwargs["timeout"])
            python = Path(args[-1]) / "bin" / "python"
            python.parent.mkdir(parents=True, exist_ok=True)
            python.write_text("")
        elif args[1:3] == ["pip", "install"]:
            if hang_install:
                raise subprocess.TimeoutExpired(args, kwargs["timeout"])
            if fail_install:
                raise subprocess.CalledProcessError(1, args)
        elif args[1:3] == ["pip", "freeze"]:
            return subprocess.CompletedProcess(args, 0, FREEZE, "")
        elif args[-1] == "--version":
            return subprocess.CompletedProcess(args, 0, "Python 3.12.9\n", "")
        elif args[-1] == "-version":
            return subprocess.CompletedProcess(args, 0, "", JAVA_STDERR)
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(tools, "_uv", lambda: UV)
    monkeypatch.setattr(tools.subprocess, "run", run)


def test_every_runner_exists_and_every_group_is_known():
    for tool in tools.TOOLS.values():
        assert tool.runner_path.exists(), tool.id
        assert tool.group in tools.GROUPS, tool.id
        assert tool.kind in ("python", "node"), tool.id


HEAVY = ["docling", "marker", "mineru", "paddleocr", "paddleocr_vl", "paddleocr_vl_hf", "paddleocr_vl_mlx"]


def test_the_methods_are_registered():
    fast = ["current", "pymupdf4llm", "pdfjs", "markitdown", "opendataloader"]
    assert list(tools.TOOLS) == [*fast, "ai_vision", "ai_vision_strong", *HEAVY]
    assert [t.id for t in tools.TOOLS.values() if t.group == "fast"] == fast
    assert [t.id for t in tools.TOOLS.values() if t.paid] == ["ai_vision", "ai_vision_strong"]
    assert [t.id for t in tools.TOOLS.values() if t.group == "heavy"] == HEAVY


def test_the_heavy_methods_are_pinned_limited_and_keep_their_models_apart():
    for tool in (tools.TOOLS[t] for t in HEAVY):
        assert tool.downloads_models and tool.limit_per_page == 120.0 and tool.exclude_newer == "2026-10-31", tool.id
        assert tool.requirements and all("==" in r for r in tool.requirements), tool.id
        assert tool.python == "3.12" and tool.import_name and not tool.paid, tool.id


def test_docling_is_pinned():
    assert tools.TOOLS["docling"].requirements == ("docling==2.145.0",)
    assert tools.TOOLS["docling"].import_name == "docling"


def test_marker_is_pinned_and_needs_llama_server():
    marker = tools.TOOLS["marker"]
    assert marker.requirements == ("marker-pdf==2.1.0",) and marker.import_name == "marker"
    assert marker.needs == ("llama-server",)


def test_marker_fetches_its_vlm_files_at_install(heavy_dirs):
    # the probe page never starts marker's VLM, so its GGUFs would otherwise download inside a timed run
    marker = tools.TOOLS["marker"]
    assert len(marker.prefetch) == 1
    step = marker.prefetch[0]
    assert step[0] == "python" and step[1] == "-I" and step[2] == "-c"
    code = step[3]
    assert "hf_hub_download" in code and "datalab-to/surya-ocr-2.5-gguf" in code
    assert "surya-2.5.gguf" in code and "surya-2.5-mmproj.gguf" in code
    compile(code, "<marker prefetch>", "exec")  # valid Python
    # its models come only from install: refused without force, and the note says to install again
    blob = tools.models_dir(marker) / "huggingface" / "m.gguf"
    blob.parent.mkdir(parents=True)
    blob.write_bytes(b"x" * 10)
    with pytest.raises(ValueError, match="models come only from install"):
        tools.clear_models(marker)
    assert blob.exists() and "install marker" in tools.clear_note(marker)


def test_mineru_is_pinned_and_downloads_its_basic_tier_models_at_install():
    mineru = tools.TOOLS["mineru"]
    assert mineru.requirements == ("mineru==4.1.3",) and mineru.import_name == "mineru"
    assert mineru.prefetch == (("mineru-kit", "models", "download", "--tier", "basic"),)
    assert mineru.downloads_models and mineru.limit_per_page == 120.0 and mineru.exclude_newer == "2026-10-31"


def test_both_paddle_methods_are_pinned_alike():
    pins = ("paddleocr[doc-parser]==3.7.0", "paddlex==3.7.2", "paddlepaddle==3.3.1")
    for tool_id in ("paddleocr", "paddleocr_vl"):
        assert tools.TOOLS[tool_id].requirements == pins and tools.TOOLS[tool_id].import_name == "paddleocr"


def test_the_paddle_methods_share_one_runner_and_differ_by_its_pipeline_argument(heavy_dirs):
    structure, vl = tools.TOOLS["paddleocr"], tools.TOOLS["paddleocr_vl"]
    assert structure.runner == vl.runner == "paddleocr_runner.py"
    assert structure.runner_args == ("--pipeline", "structure") and vl.runner_args == ("--pipeline", "vl")
    for tool in (structure, vl):
        cmd = tools.command(tool)
        assert cmd[1:] == ["-I", str(tool.runner_path), *tool.runner_args]  # the probe and every run get the argument
        assert tool.downloads_models and tool.limit_per_page == 120.0
    assert tools.command(tools.TOOLS["docling"])[-1].endswith("docling_runner.py")  # others take no arguments


def test_paddle_models_land_in_each_methods_own_folder(heavy_dirs):
    # paddlex 3.7.2 (paddlex/utils/cache.py) reads PADDLE_PDX_CACHE_HOME and keeps official models in
    # <it>/official_models; PADDLE_PDX_MODEL_SOURCE defaults to huggingface, which HF_HOME redirects
    for tool_id in ("paddleocr", "paddleocr_vl"):
        tool = tools.TOOLS[tool_id]
        env = tools.runner_env(tool)
        assert env["PADDLE_PDX_CACHE_HOME"] == str(tools.models_dir(tool) / "paddlex")
        assert env["HF_HOME"] == str(tools.models_dir(tool) / "huggingface")
        assert Path(env["HOME"]).is_relative_to(tools.models_dir(tool))  # HOME-relative defaults land there too
    assert tools.models_dir(tools.TOOLS["paddleocr"]) != tools.models_dir(tools.TOOLS["paddleocr_vl"])


def test_pp_structurev3_fetches_its_table_orientation_model_at_install(heavy_dirs):
    # paddlex builds the table-orientation classifier only on a first table (table_recognition/pipeline_v2.py), which
    # the probe page never has: without this step its download would land inside a timed run
    structure, vl = tools.TOOLS["paddleocr"], tools.TOOLS["paddleocr_vl"]
    assert len(structure.prefetch) == 1
    step = structure.prefetch[0]
    assert step[:3] == ("python", "-I", "-c")
    code = step[3]
    assert "paddlex.inference.utils.official_models import official_models" in code
    assert "get_model_path('PP-LCNet_x1_0_doc_ori')" in code
    compile(code, "<paddleocr prefetch>", "exec")
    assert vl.prefetch == ()  # PaddleOCR-VL builds every model in its __init__: the probe run fetches them all
    # its models come partly from install only: not cleared without force
    with pytest.raises(ValueError, match="models come only from install"):
        tools.clear_models(structure)


def test_the_paddle_install_sizes_cover_their_models():
    assert tools.TOOLS["paddleocr"].size_mb == 2800 and tools.TOOLS["paddleocr_vl"].size_mb == 3000


def test_paddleocr_vl_hf_is_pinned_and_fetches_exactly_its_revision_at_install(heavy_dirs):
    tool = tools.TOOLS["paddleocr_vl_hf"]
    assert tool.requirements == ("transformers==5.22.1", "torch==2.15.0", "pymupdf==1.27.1", "pillow==13.0.0")
    assert tool.import_name == "transformers" and tool.runner == "paddleocr_vl_hf_runner.py" and tool.runner_args == ()
    assert tools.TOOLS["ai_vision"].requirements[0] in tool.requirements  # the same PyMuPDF as ai_vision renders with
    assert tool.neighbours == tools.HEAVY_NEIGHBOURS and tool.size_mb == 3400
    assert tools.PADDLEOCR_VL_HF_REPO == "PaddlePaddle/PaddleOCR-VL-1.6"
    assert tools.PADDLEOCR_VL_HF_REVISION == "c5630abae1d940eafe0697512a0325494b02ab42"
    assert len(tool.prefetch) == 1
    step = tool.prefetch[0]
    assert step[:3] == ("python", "-I", "-c")
    code = step[3]
    assert "snapshot_download" in code and tools.PADDLEOCR_VL_HF_REPO in code and tools.PADDLEOCR_VL_HF_REVISION in code
    compile(code, "<paddleocr_vl_hf prefetch>", "exec")
    env = tools.runner_env(tool)  # HF_HOME is what the fetch step and the runner's snapshot lookup share
    assert env["HF_HOME"] == str(tools.models_dir(tool) / "huggingface")
    with pytest.raises(ValueError, match="models come only from install"):
        tools.clear_models(tool)


def test_paddleocr_vl_mlx_is_pinned_and_fetches_exactly_its_revision_at_install(heavy_dirs):
    tool = tools.TOOLS["paddleocr_vl_mlx"]
    assert tool.requirements == ("mlx-vlm==0.7.11", "mlx==0.32.4", "transformers==5.22.1", "pymupdf==1.27.1")
    assert tool.import_name == "mlx_vlm" and tool.runner == "paddleocr_vl_mlx_runner.py" and tool.runner_args == ()
    assert tools.TOOLS["ai_vision"].requirements[0] in tool.requirements  # the same PyMuPDF as ai_vision renders with
    assert tool.neighbours == tools.HEAVY_NEIGHBOURS and tool.size_mb == 1500
    assert tool.exclude_newer == tools.EXCLUDE_NEWER and tool.limit_per_page == tools.TIME_LIMIT_PER_PAGE
    assert tools.PADDLEOCR_VL_MLX_REPO == "mlx-community/PaddleOCR-VL-1.6-4bit"
    assert tools.PADDLEOCR_VL_MLX_REVISION == "c8987b277bdd8aaec8bd265d154f391bd03ad165"
    assert len(tool.prefetch) == 1
    step = tool.prefetch[0]
    assert step[:3] == ("python", "-I", "-c")
    code = step[3]
    assert "snapshot_download" in code and tools.PADDLEOCR_VL_MLX_REPO in code and tools.PADDLEOCR_VL_MLX_REVISION in code
    compile(code, "<paddleocr_vl_mlx prefetch>", "exec")
    env = tools.runner_env(tool)  # HF_HOME is what the fetch step and the runner's snapshot lookup share
    assert env["HF_HOME"] == str(tools.models_dir(tool) / "huggingface")
    assert tools.models_dir(tool) != tools.models_dir(tools.TOOLS["paddleocr_vl_hf"])  # own folder, own revision
    with pytest.raises(ValueError, match="models come only from install"):
        tools.clear_models(tool)


def test_ai_vision_is_the_production_vision_model():
    tool = tools.TOOLS["ai_vision"]
    assert (tool.group, tool.model, tool.temperature) == ("paid", "gpt-4.1-mini", 0.0)
    assert tool.runner_path.name == "ai_vision_runner.py" and tool.requirements == ("pymupdf==1.27.1",)
    assert tools.TOOLS["ai_vision_strong"].model == tools.AI_VISION_STRONG_MODEL
    # only the two vision methods are paid; every free method stays free and has no model id
    assert all(t.paid is (t.group == "paid") for t in tools.TOOLS.values())
    assert all(t.model == "" for t in tools.TOOLS.values() if not t.paid)


def _paid_tool(model="gpt-test", temperature=0.0):
    return tools.Tool("p", "p", "paid", "ai_vision_runner.py", "test", paid=True, model=model, temperature=temperature)


def _private_key(folder):
    key = folder / "openai_key"
    key.write_text("sk-test-0123\n")
    key.chmod(0o600)
    return key


def test_a_paid_method_without_a_model_id_is_not_ready_and_refused(tmp_path, monkeypatch):
    monkeypatch.setattr(paid, "KEY_FILE", _private_key(tmp_path))
    tool = _paid_tool(model="")
    assert any("model id" in gap for gap in tools.missing(tool))
    with pytest.raises(tools.ToolNotReady, match="model id"):
        tools.paid_args(tool, [1])
    assert tools.is_ready(_paid_tool())


def test_a_paid_method_without_the_key_file_is_not_ready(tmp_path, monkeypatch):
    monkeypatch.setattr(paid, "KEY_FILE", tmp_path / "absent")
    assert any(gap.startswith("key file missing") for gap in tools.missing(_paid_tool()))
    assert not tools.needs_install(_paid_tool())


def test_paid_args_name_the_pages_model_temperature_and_the_key_path(tmp_path, monkeypatch):
    monkeypatch.setattr(paid, "KEY_FILE", tmp_path / "openai_key")
    assert tools.paid_args(_paid_tool(), [5, 2, 5]) == [
        "--pages", "2,5", "--model", "gpt-test", "--temperature", "0.0", "--key-file", str(tmp_path / "openai_key")]
    assert tools.paid_args(_paid_tool(temperature=None), [1])[5] == "default"
    assert tools.paid_args(tools.TOOLS["current"], [1]) == []
    with pytest.raises(ValueError, match="pages"):
        tools.paid_args(_paid_tool(), [])


def test_current_runs_in_this_interpreter_isolated():
    cmd = tools.command(tools.TOOLS["current"])
    assert cmd[:2] == [sys.executable, "-I"] and cmd[2].endswith("current_runner.py")
    assert tools.is_ready(tools.TOOLS["current"])


def test_env_methods_use_their_own_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("PARSER_BENCH_ENVS", str(tmp_path))
    tool = tools.TOOLS["markitdown"]
    assert tools.command(tool)[0] == str(tmp_path / "markitdown" / "bin" / "python")
    assert any("environment" in gap for gap in tools.missing(tool))


def test_the_envs_root_expands_the_home_folder(monkeypatch):
    monkeypatch.setenv("PARSER_BENCH_ENVS", "~/lsbench-envs-not-created")
    assert tools.envs_root() == (Path.home() / "lsbench-envs-not-created").resolve()


def test_install_refuses_when_too_little_disk_would_remain(monkeypatch):
    monkeypatch.setattr(tools.subprocess, "run", lambda *a, **k: pytest.fail("must not install"))
    with pytest.raises(tools.DiskSpaceError, match="3 GB"):
        tools.install(tools.TOOLS["opendataloader"], free_bytes=3 * 2**30)


def test_a_runner_path_can_be_absolute(tmp_path):
    script = tmp_path / "fake.py"
    tool = tools.Tool("fake", "Fake", "fast", str(script), "test double")
    assert tool.runner_path == script


def test_environment_of_current_names_pymupdf():
    env = tools.environment(tools.TOOLS["current"])
    assert any(line.startswith("pymupdf==") for line in env)


def test_pymupdf4llm_is_pinned_to_one_exact_release():
    # 1.28.2 resolves pymupdf 1.28.2; no 1.x release resolves production's pymupdf 1.27.1, and the
    # one pin that does resolve there (pymupdf4llm 2.0) is an empty placeholder with no module.
    assert tools.TOOLS["pymupdf4llm"].requirements == ("pymupdf4llm==1.28.2",)


def test_every_method_with_its_own_environment_names_the_module_install_must_import():
    for tool in tools.TOOLS.values():
        assert (tool.import_name is not None) == bool(tool.requirements), tool.id
    assert tools.TOOLS["opendataloader"].import_name == "opendataloader_pdf"


def test_the_disk_guard_measures_the_volume_the_environment_lands_on(tmp_path, monkeypatch):
    monkeypatch.setenv("PARSER_BENCH_ENVS", str(tmp_path / "a" / "b"))
    probed = []

    def free_space(path):
        probed.append(Path(path))
        return SimpleNamespace(free=100 * 2**30)

    monkeypatch.setattr(tools.shutil, "disk_usage", free_space)
    _fake_uv(monkeypatch)
    tools.install(tools.TOOLS["markitdown"])
    assert probed == [tmp_path]


def test_a_python_without_the_install_marker_is_not_ready(tmp_path, monkeypatch):
    monkeypatch.setenv("PARSER_BENCH_ENVS", str(tmp_path))
    tool = tools.TOOLS["markitdown"]
    tools.env_python(tool).parent.mkdir(parents=True)
    tools.env_python(tool).write_text("")
    assert any("environment" in gap for gap in tools.missing(tool))
    assert not tools.is_ready(tool)


def test_a_completed_install_writes_the_marker_and_the_tool_is_ready(tmp_path, monkeypatch):
    monkeypatch.setenv("PARSER_BENCH_ENVS", str(tmp_path))
    _fake_uv(monkeypatch)
    tool = tools.TOOLS["markitdown"]
    tools.install(tool, free_bytes=100 * 2**30)
    assert tools.marker(tool).read_text(encoding="utf-8").splitlines() == ["markitdown==0.1.6", "pypdf==6.7.0"]
    assert tools.is_ready(tool)


def test_a_failed_pip_install_writes_no_marker(tmp_path, monkeypatch):
    monkeypatch.setenv("PARSER_BENCH_ENVS", str(tmp_path))
    _fake_uv(monkeypatch, fail_install=True)
    tool = tools.TOOLS["markitdown"]
    with pytest.raises(subprocess.CalledProcessError):
        tools.install(tool, free_bytes=100 * 2**30)
    assert not tools.marker(tool).exists()
    assert not tools.is_ready(tool)


def test_the_install_imports_the_module_before_it_writes_the_marker(tmp_path, monkeypatch):
    monkeypatch.setenv("PARSER_BENCH_ENVS", str(tmp_path))
    _fake_uv(monkeypatch)
    calls = []
    real_run = tools.subprocess.run

    def spy(args, **kwargs):
        calls.append((list(args), tools.marker(tools.TOOLS["markitdown"]).exists()))
        return real_run(args, **kwargs)

    monkeypatch.setattr(tools.subprocess, "run", spy)
    tool = tools.TOOLS["markitdown"]
    tools.install(tool, free_bytes=100 * 2**30)
    probes = [(args, marked) for args, marked in calls if args[1:3] == ["-I", "-c"]]
    assert probes == [([str(tools.env_python(tool)), "-I", "-c", "import markitdown"], False)]
    assert tools.marker(tool).exists()


def test_an_install_that_does_not_import_writes_no_marker_and_says_why(tmp_path, monkeypatch):
    monkeypatch.setenv("PARSER_BENCH_ENVS", str(tmp_path))
    _fake_uv(monkeypatch, fail_import=True)
    tool = tools.TOOLS["markitdown"]
    with pytest.raises(tools.ToolNotReady, match="markitdown installed but does not import: ModuleNotFoundError"):
        tools.install(tool, free_bytes=100 * 2**30)
    assert not tools.marker(tool).exists()
    assert not tools.is_ready(tool)


def test_an_import_that_hangs_times_out_with_no_marker(tmp_path, monkeypatch):
    monkeypatch.setenv("PARSER_BENCH_ENVS", str(tmp_path))
    _fake_uv(monkeypatch, hang_import=True)
    tool = tools.TOOLS["markitdown"]
    with pytest.raises(tools.ToolNotReady, match="markitdown installed but importing it timed out"):
        tools.install(tool, free_bytes=100 * 2**30)
    assert not tools.marker(tool).exists()
    assert not tools.is_ready(tool)


def test_a_reinstall_that_does_not_import_clears_the_earlier_marker(tmp_path, monkeypatch):
    monkeypatch.setenv("PARSER_BENCH_ENVS", str(tmp_path))
    tool = tools.TOOLS["markitdown"]
    tools.env_python(tool).parent.mkdir(parents=True)
    tools.env_python(tool).write_text("")
    tools.marker(tool).write_text("markitdown==0.1.6\n", encoding="utf-8")
    _fake_uv(monkeypatch, fail_import=True)
    with pytest.raises(tools.ToolNotReady):
        tools.install(tool, free_bytes=100 * 2**30)
    assert not tools.is_ready(tool)


def test_a_failed_reinstall_clears_the_marker_of_the_earlier_install(tmp_path, monkeypatch):
    monkeypatch.setenv("PARSER_BENCH_ENVS", str(tmp_path))
    tool = tools.TOOLS["markitdown"]
    tools.env_python(tool).parent.mkdir(parents=True)
    tools.env_python(tool).write_text("")
    tools.marker(tool).write_text("markitdown==0.1.6\n", encoding="utf-8")
    assert tools.is_ready(tool)
    _fake_uv(monkeypatch, fail_install=True)
    with pytest.raises(subprocess.CalledProcessError):
        tools.install(tool, free_bytes=100 * 2**30)
    assert not tools.is_ready(tool)


def test_an_environment_records_its_python_sorted_packages_and_java(tmp_path, monkeypatch):
    monkeypatch.setenv("PARSER_BENCH_ENVS", str(tmp_path))
    _fake_uv(monkeypatch)
    assert tools.environment(tools.TOOLS["opendataloader"]) == [
        "Python 3.12.9",
        "markitdown==0.1.6",
        "pypdf==6.7.0",
        'openjdk version "22.0.2" 2024-07-16',
    ]


def test_creating_the_environment_and_installing_into_it_are_bounded(tmp_path, monkeypatch):
    monkeypatch.setenv("PARSER_BENCH_ENVS", str(tmp_path))
    calls = []
    _fake_uv(monkeypatch, calls=calls)
    tools.install(tools.TOOLS["markitdown"], free_bytes=100 * 2**30)
    bounded = {tuple(args[1:3]): kwargs.get("timeout") for args, kwargs in calls if args[0] == UV and args[1] in ("venv", "pip")}
    assert bounded[("venv", "--python")] == tools.INSTALL_TIMEOUT == 1800
    assert bounded[("pip", "install")] == 1800


@pytest.mark.parametrize("hang", ["hang_venv", "hang_install"])
def test_an_install_that_hangs_times_out_with_no_marker(tmp_path, monkeypatch, hang):
    monkeypatch.setenv("PARSER_BENCH_ENVS", str(tmp_path))
    _fake_uv(monkeypatch, **{hang: True})
    tool = tools.TOOLS["markitdown"]
    with pytest.raises(tools.ToolNotReady, match="^markitdown install timed out$"):
        tools.install(tool, free_bytes=100 * 2**30)
    assert not tools.marker(tool).exists()
    assert not tools.is_ready(tool)


def test_a_reinstall_that_hangs_creating_the_environment_clears_the_earlier_marker(tmp_path, monkeypatch):
    """An environment whose python is gone but whose marker is left must not come back as ready
    from a half-made venv."""
    monkeypatch.setenv("PARSER_BENCH_ENVS", str(tmp_path))
    tool = tools.TOOLS["markitdown"]
    tools.marker(tool).parent.mkdir(parents=True)
    tools.marker(tool).write_text("markitdown==0.1.6\n", encoding="utf-8")
    _fake_uv(monkeypatch, hang_venv=True)
    with pytest.raises(tools.ToolNotReady, match="timed out"):
        tools.install(tool, free_bytes=100 * 2**30)
    assert not tools.marker(tool).exists()


# --- Plan 2: bounded version probes, Tesseract for OCR-capable methods ---------------


def test_every_version_probe_of_an_environment_is_bounded(tmp_path, monkeypatch):
    monkeypatch.setenv("PARSER_BENCH_ENVS", str(tmp_path))
    calls = []
    _fake_uv(monkeypatch, calls=calls)
    monkeypatch.setattr(tools.shutil, "which", lambda name: f"/bin/{name}")
    for tool_id in ("pdfjs", "pymupdf4llm", "opendataloader"):
        tools.environment(tools.TOOLS[tool_id])
    assert calls and all(kwargs.get("timeout") == tools.ENV_TIMEOUT == 60 for _, kwargs in calls)


def test_ocr_capable_methods_record_the_tesseract_version(tmp_path, monkeypatch):
    monkeypatch.setenv("PARSER_BENCH_ENVS", str(tmp_path))
    _fake_uv(monkeypatch)
    real_run = tools.subprocess.run

    def run(args, **kwargs):
        if args[-1] == "--version" and args[0].endswith("tesseract"):
            return subprocess.CompletedProcess(args, 0, "tesseract 5.5.2\n leptonica-1.85.0\n", "")
        return real_run(args, **kwargs)

    monkeypatch.setattr(tools.subprocess, "run", run)
    monkeypatch.setattr(tools.shutil, "which", lambda name: "/opt/homebrew/bin/tesseract" if name == "tesseract" else None)
    assert tools.TOOLS["pymupdf4llm"].ocr and not tools.TOOLS["markitdown"].ocr
    assert tools.environment(tools.TOOLS["pymupdf4llm"])[-1] == "tesseract 5.5.2"
    monkeypatch.setattr(tools.shutil, "which", lambda name: None)
    assert tools.environment(tools.TOOLS["pymupdf4llm"])[-1] == "tesseract: not installed"


def test_the_paid_methods_are_set_priced_and_named_in_the_protocol():
    from backend.eval.parser_bench import paid, store
    protocol = (store.REPO / "docs/thesis/experiments/parser-benchmark/PROTOCOL.md").read_text(encoding="utf-8")
    for tool_id in ("ai_vision", "ai_vision_strong"):
        model = tools.TOOLS[tool_id].model
        assert model and f"`{model}`" in protocol and model in paid.PRICES
    spec = importlib.util.spec_from_file_location("ai_vision_runner", tools.TOOLS["ai_vision"].runner_path)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    assert runner.PROMPT in protocol


PREFETCH_RUNNER = r'''
import json, os, sys
os.makedirs(os.environ["HF_HOME"], exist_ok=True)
open(os.path.join(os.environ["HF_HOME"], "model.bin"), "wb").write(b"m" * 1000)
json.dump({"version": "1", "settings": {}, "pages": {"1": "Probe page"}}, open(sys.argv[2], "w"))
'''


def heavy_tool(tmp_path, body, **kw):
    script = tmp_path / "heavy_runner.py"
    script.write_text(body)
    return tools.Tool("heavyfake", "Heavy fake", "heavy", str(script), "test double", downloads_models=True, **kw)


@pytest.fixture
def heavy_dirs(tmp_path, monkeypatch):
    monkeypatch.setenv("PARSER_BENCH_MODELS", str(tmp_path / "models"))
    monkeypatch.setenv("PARSER_BENCH_ENVS", str(tmp_path / "envs"))
    monkeypatch.setenv("PARSER_BENCH_BIN", str(tmp_path / "bin"))
    return tmp_path


def test_a_heavy_method_gets_its_own_model_folders_and_no_telemetry(heavy_dirs):
    tool = heavy_tool(heavy_dirs, "")
    env = tools.runner_env(tool)
    for var, sub in tools.CACHE_VARS.items():
        assert env[var] == str(tools.models_dir(tool) / sub), var
    assert tools.models_dir(tool) == (heavy_dirs / "models" / "heavyfake").resolve()
    assert all(env[var] == "1" for var in ("HF_HUB_DISABLE_TELEMETRY", "DO_NOT_TRACK", "MINERU_TELEMETRY_DISABLED"))
    assert env["PATH"].split(":")[0] == str(tools.bin_dir())
    assert tools.runner_env(tools.TOOLS["markitdown"]) is None  # every other method inherits the environment as is


def test_docling_reads_its_models_from_the_method_folder(heavy_dirs):
    # docling's own variable (docling.datamodel.settings, env_prefix DOCLING_, field cache_dir) is redirected
    assert tools.CACHE_VARS["DOCLING_CACHE_DIR"] == "docling"
    # DOCLING_ARTIFACTS_PATH must NOT be set to a folder: docling then looks for its models there and fails
    assert "DOCLING_ARTIFACTS_PATH" not in tools.CACHE_VARS
    assert "DOCLING_ARTIFACTS_PATH" in tools.INHERITED_CACHE_OVERRIDES


def test_cache_overrides_inherited_from_the_parent_do_not_leak_into_a_heavy_run(heavy_dirs, monkeypatch):
    for var in tools.INHERITED_CACHE_OVERRIDES:
        monkeypatch.setenv(var, "/elsewhere")
    assert {"HF_HUB_CACHE", "HUGGINGFACE_HUB_CACHE", "TRANSFORMERS_CACHE", "HF_DATASETS_CACHE"} <= set(tools.INHERITED_CACHE_OVERRIDES)
    env = tools.runner_env(heavy_tool(heavy_dirs, ""))
    assert not [var for var in tools.INHERITED_CACHE_OVERRIDES if var in env]
    assert env["HF_HOME"].startswith(str(tools.models_root()))  # what the library reads is ours


def test_a_heavy_run_gets_no_secrets_from_the_parent_environment(heavy_dirs, monkeypatch):
    secrets = ["OPENAI_API_KEY", "OPENAI_BASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL",
               "HF_TOKEN", "GITHUB_TOKEN", "SOME_SECRET", "ANTHROPIC_API_KEY", "AWS_ACCESS_KEY_ID", "AWS_PROFILE",
               "GOOGLE_APPLICATION_CREDENTIALS", "stripe_key"]
    for var in secrets:
        monkeypatch.setenv(var, "sentinel")
    monkeypatch.setenv("HOME", "/home/someone")
    monkeypatch.setenv("KEYBOARD_LAYOUT", "us")  # looks a little like a secret name; is not one
    env = tools.runner_env(heavy_tool(heavy_dirs, ""))
    assert [var for var in secrets if var in env] == []
    assert "sentinel" not in env.values()
    assert env["KEYBOARD_LAYOUT"] == "us" and env["HOME"] != "/home/someone"  # the rest is passed on; HOME is ours
    assert "PATH" in env


def test_which_finds_a_program_in_the_bench_bin_folder_first(heavy_dirs):
    program = heavy_dirs / "bin" / "ls-bench-fake-program"
    tool = tools.Tool("needsit", "Needs it", "heavy", "x.py", "test double", needs=("ls-bench-fake-program",))
    assert tools.which("ls-bench-fake-program") is None and any("ls-bench-fake-program" in g for g in tools.missing(tool))
    program.parent.mkdir(parents=True)
    program.write_text("#!/bin/sh\n")
    program.chmod(0o755)
    assert tools.which("ls-bench-fake-program") == str(program) and tools.missing(tool) == []


def test_the_llama_server_version_is_read_from_the_bench_bin_folder(heavy_dirs):
    script = heavy_dirs / "bin" / "llama-server"
    script.parent.mkdir(parents=True)
    script.write_text("#!/bin/sh\necho 'load_backend: loaded Metal' >&2\necho 'version: 6543 (abcdef0)' >&2\n")
    script.chmod(0o755)
    assert tools._llama_version() == "llama-server version: 6543 (abcdef0)"


def test_prefetch_runs_the_download_steps_then_the_runner_on_a_probe_page(heavy_dirs):
    fetch = heavy_dirs / "envs" / "heavyfake" / "bin" / "fetch"
    fetch.parent.mkdir(parents=True)
    fetch.write_text('#!/bin/sh\nmkdir -p "$MINERU_HOME" && echo "$@" > "$MINERU_HOME/args.txt"\n')
    fetch.chmod(0o755)
    tool = heavy_tool(heavy_dirs, PREFETCH_RUNNER, prefetch=(("fetch", "--tier", "basic"),))
    tools._prefetch(tool)
    assert (tools.models_dir(tool) / "mineru" / "args.txt").read_text().strip() == "--tier basic"
    assert (tools.models_dir(tool) / "huggingface" / "model.bin").stat().st_size == 1000
    assert tools.dir_bytes(tools.models_dir(tool) / "huggingface") == 1000
    assert tools.cache_mb(tool) == 0.0  # about 1 KB rounds to 0.0 MB


def test_prefetch_steps_and_the_probe_run_in_a_temporary_folder_never_the_repo(heavy_dirs):
    fetch = heavy_dirs / "envs" / "heavyfake" / "bin" / "fetch"
    fetch.parent.mkdir(parents=True)
    fetch.write_text('#!/bin/sh\npwd > "$MINERU_HOME/step-cwd.txt"\n')
    fetch.chmod(0o755)
    runner = PREFETCH_RUNNER + "\nopen(os.path.join(os.environ['HF_HOME'], 'run-cwd.txt'), 'w').write(os.getcwd())\n"
    tool = heavy_tool(heavy_dirs, runner, prefetch=(("fetch",),))
    (tools.models_dir(tool) / "mineru").mkdir(parents=True)
    tools._prefetch(tool)
    step_cwd = (tools.models_dir(tool) / "mineru" / "step-cwd.txt").read_text().strip()
    run_cwd = (tools.models_dir(tool) / "huggingface" / "run-cwd.txt").read_text().strip()
    for cwd in (step_cwd, run_cwd):
        assert not Path(cwd).resolve().is_relative_to(tools.REPO.resolve()) and not Path(cwd).exists()  # a deleted temp folder


@pytest.mark.parametrize("body, message", [
    ('import sys\nprint("no model here", file=sys.stderr)\nsys.exit(4)\n', "probe run failed: no model here"),
    ('import json, sys\njson.dump({"pages": {"1": "  "}}, open(sys.argv[2], "w"))\n', "no text for page 1"),
])
def test_a_probe_run_that_gives_nothing_is_refused(heavy_dirs, body, message):
    with pytest.raises(tools.ToolNotReady, match=message):
        tools._prefetch(heavy_tool(heavy_dirs, body))


def test_the_install_probe_leaves_no_process_alive_when_the_runner_forks_a_detached_child(heavy_dirs):
    import os
    import time

    pidfile = heavy_dirs / "child.pid"
    runner = (
        "import json, os, subprocess, sys\n"
        "child = subprocess.Popen(['sleep', '60'], start_new_session=True)  # a server that outlives its runner\n"
        f"open({str(pidfile)!r}, 'w').write(str(child.pid))\n"
        "json.dump({'version': '1', 'settings': {}, 'pages': {'1': 'Probe page'}}, open(sys.argv[2], 'w'))\n"
    )
    try:
        tools._prefetch(heavy_tool(heavy_dirs, runner))
        pid = int(pidfile.read_text())
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                break
            time.sleep(0.05)
        with pytest.raises(ProcessLookupError):
            os.kill(pid, 0)
    finally:
        if pidfile.exists():
            try:
                os.kill(int(pidfile.read_text()), 9)
            except ProcessLookupError:
                pass


def test_a_probe_run_that_cannot_start_is_refused_by_name_of_the_probe(heavy_dirs):
    tool = tools.Tool("heavyfake", "Heavy fake", "heavy", str(heavy_dirs / "r.py"), "test double",
                      downloads_models=True, requirements=("x",))  # its environment's python does not exist
    with pytest.raises(tools.ToolNotReady, match=r"probe run could not start"):
        tools._prefetch(tool)


def test_a_probe_run_that_times_out_is_refused_and_leaves_nothing(heavy_dirs, monkeypatch):
    monkeypatch.setattr(tools, "INSTALL_TIMEOUT", 1)
    body = "import time\ntime.sleep(60)\n"
    with pytest.raises(tools.ToolNotReady, match="probe run timed out"):
        tools._prefetch(heavy_tool(heavy_dirs, body))


def test_a_heavy_install_resolves_as_pypi_stood_on_the_plan_date_and_fetches_before_the_marker(heavy_dirs, monkeypatch):
    calls = []
    _fake_uv(monkeypatch, calls=calls)
    monkeypatch.setattr(tools, "_prefetch", lambda tool: calls.append((["prefetch", tools.marker(tool).exists()], {})))
    tool = heavy_tool(heavy_dirs, "", requirements=("heavyfake==1.0",), import_name="heavyfake",
                      exclude_newer=tools.EXCLUDE_NEWER)
    tools.install(tool, free_bytes=100 * 2**30)
    pip = next(args for args, _ in calls if args[1:3] == ["pip", "install"])
    assert pip[-3:] == ["--exclude-newer", "2026-10-31", "heavyfake==1.0"]
    assert ["prefetch", False] in [args for args, _ in calls]  # models fetched before the marker is written
    assert tools.marker(tool).exists()


def test_the_install_time_import_check_runs_under_the_heavy_environment(heavy_dirs, monkeypatch):
    calls = []
    _fake_uv(monkeypatch, calls=calls)
    monkeypatch.setattr(tools, "_prefetch", lambda tool: None)
    monkeypatch.setenv("HF_HUB_CACHE", "/elsewhere")
    tool = heavy_tool(heavy_dirs, "", requirements=("heavyfake==1.0",), import_name="heavyfake")
    tools.install(tool, free_bytes=100 * 2**30)
    kwargs = next(k for args, k in calls if args[1:3] == ["-I", "-c"])
    assert kwargs["env"]["HF_HOME"] == str(tools.models_dir(tool) / "huggingface") and "HF_HUB_CACHE" not in kwargs["env"]
    assert not Path(kwargs["cwd"]).resolve().is_relative_to(tools.REPO.resolve())
    # a method that downloads nothing is checked as before: inherited environment, no cwd change
    kwargs = {}
    _fake_uv(monkeypatch, calls=(seen := []))
    tools.install(tools.TOOLS["markitdown"], free_bytes=100 * 2**30)
    kwargs = next(k for args, k in seen if args[1:3] == ["-I", "-c"])
    assert kwargs.get("env") is None and kwargs.get("cwd") is None


def test_a_heavy_install_whose_probe_gives_nothing_writes_no_marker(heavy_dirs, monkeypatch):
    from backend.eval.parser_bench import execute

    _fake_uv(monkeypatch)  # stands in for every subprocess; the probe run (a real process) is stood in for too
    monkeypatch.setattr(execute, "invoke", lambda *a, **k: execute.Invocation({}, "1", {}, 0.1, None, ""))
    tool = heavy_tool(heavy_dirs, "", requirements=("heavyfake==1.0",), import_name="heavyfake")
    with pytest.raises(tools.ToolNotReady, match="no text for page 1"):
        tools.install(tool, free_bytes=100 * 2**30)
    assert not tools.marker(tool).exists()


def test_the_disk_guard_says_how_much_is_free(monkeypatch):
    monkeypatch.setattr(tools.subprocess, "run", lambda *a, **k: pytest.fail("must not install"))
    with pytest.raises(tools.DiskSpaceError, match=r"less than 3 GB free \(3\.0 GB free now\)"):
        tools.install(tools.TOOLS["opendataloader"], free_bytes=3 * 2**30)


def test_clear_models_deletes_only_that_methods_model_folder(heavy_dirs):
    tool = heavy_tool(heavy_dirs, "")
    blob = tools.models_dir(tool) / "huggingface" / "hub" / "blob"
    blob.parent.mkdir(parents=True)
    blob.write_bytes(b"x" * 3000)
    (blob.parent / "link").symlink_to(blob)  # a Hugging Face snapshot link: not counted twice
    other = tools.models_root() / "othertool" / "keep.bin"
    other.parent.mkdir(parents=True)
    other.write_bytes(b"y")
    assert tools.dir_bytes(tools.models_dir(tool)) == 3000
    assert tools.clear_models(tool) == 3000
    assert not tools.models_dir(tool).exists() and other.exists()
    assert tools.clear_models(tool) == 0
    with pytest.raises(ValueError, match="keeps no downloaded models"):
        tools.clear_models(tools.TOOLS["markitdown"])
    assert tools.cache_mb(tools.TOOLS["markitdown"]) is None


def test_the_clear_note_says_truthfully_how_the_models_come_back(heavy_dirs):
    lazy = heavy_tool(heavy_dirs, "")  # downloads on first use
    from_install = heavy_tool(heavy_dirs, "", prefetch=(("fetch",),))  # models come only from install-time steps
    assert "warm-up downloads them again" in tools.clear_note(lazy)
    note = tools.clear_note(from_install)
    assert "install heavyfake" in note and "warm-up" not in note


def test_a_failing_download_step_is_refused_by_name(heavy_dirs):
    fetch = heavy_dirs / "envs" / "heavyfake" / "bin" / "fetch"
    fetch.parent.mkdir(parents=True)
    fetch.write_text("#!/bin/sh\nexit 3\n")
    fetch.chmod(0o755)
    tool = heavy_tool(heavy_dirs, PREFETCH_RUNNER, prefetch=(("fetch", "--tier", "basic"),))
    with pytest.raises(tools.ToolNotReady, match=r"download step `fetch` failed \(exit 3\)"):
        tools._prefetch(tool)


# ---- fix round 1 ----

def test_a_heavy_methods_whole_home_is_inside_its_model_folder(heavy_dirs, monkeypatch):
    monkeypatch.setenv("HOME", "/home/someone")
    for var in ("XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "MINERU_TOOLS_CONFIG_JSON"):
        monkeypatch.setenv(var, "/elsewhere")
    tool = heavy_tool(heavy_dirs, "")
    env = tools.runner_env(tool)
    root = tools.models_root()
    for var in ("HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "MINERU_TOOLS_CONFIG_JSON"):
        assert Path(env[var]).resolve().is_relative_to(tools.models_dir(tool)), var
    assert Path(env["HOME"]) == tools.models_dir(tool) / "home" and Path(env["HOME"]).is_dir()
    assert Path(env["MINERU_TOOLS_CONFIG_JSON"]) == Path(env["HOME"]) / "mineru.json"
    assert Path(env["XDG_CACHE_HOME"]) == tools.models_dir(tool) / tools.CACHE_VARS["XDG_CACHE_HOME"]
    assert tools.models_dir(tool).parent == root


def test_clear_models_refuses_a_method_whose_models_come_only_from_install_unless_forced(heavy_dirs):
    tool = heavy_tool(heavy_dirs, "", prefetch=(("fetch",),))
    blob = tools.models_dir(tool) / "mineru" / "m.bin"
    blob.parent.mkdir(parents=True)
    blob.write_bytes(b"x" * 500)
    with pytest.raises(ValueError, match="models come only from install"):
        tools.clear_models(tool)
    assert blob.exists()
    assert tools.clear_models(tool, force=True) == 500 and not tools.models_dir(tool).exists()
    lazy = heavy_tool(heavy_dirs, "")  # a method that fetches on first use needs no force
    (tools.models_dir(lazy) / "huggingface").mkdir(parents=True)
    assert tools.clear_models(lazy) == 0


@pytest.mark.parametrize("bad_id", ["../x", "a/b", ".", "", "..", "/abs"])
def test_clear_models_refuses_an_id_that_leaves_the_model_root(heavy_dirs, bad_id):
    outside = heavy_dirs / "x"
    outside.mkdir()
    (outside / "keep").write_text("k")
    tool = tools.Tool(bad_id, "Bad", "heavy", "x.py", "test double", downloads_models=True)
    with pytest.raises(ValueError, match="not a model folder"):
        tools.clear_models(tool, force=True)
    assert (outside / "keep").exists() and tools.models_root().parent.exists()


def test_a_missing_download_program_is_refused_by_name(heavy_dirs):
    tool = heavy_tool(heavy_dirs, PREFETCH_RUNNER, prefetch=(("no-such-fetch", "--tier", "basic"),))
    with pytest.raises(tools.ToolNotReady, match=r"download step `no-such-fetch` could not start"):
        tools._prefetch(tool)


def test_uv_calls_get_the_environment_minus_secrets(heavy_dirs, monkeypatch):
    calls = []
    _fake_uv(monkeypatch, calls=calls)
    monkeypatch.setattr(tools, "_prefetch", lambda tool: None)
    for var in ("OPENAI_API_KEY", "SUPABASE_URL", "DB_PASSWORD", "ADMIN_PASSWD", "HF_TOKEN"):
        monkeypatch.setenv(var, "sentinel")
    monkeypatch.setenv("HOME", "/home/someone")
    tool = heavy_tool(heavy_dirs, "", requirements=("heavyfake==1.0",), import_name="heavyfake")
    tools.install(tool, free_bytes=100 * 2**30)
    uv_calls = [k for args, k in calls if args[1:2] == ["venv"] or args[1:3] in (["pip", "install"], ["pip", "freeze"])]
    assert len(uv_calls) >= 3  # venv, pip install, and freeze (once for the marker, once for the environment)
    for kwargs in uv_calls:
        assert "sentinel" not in kwargs["env"].values()
        assert kwargs["env"]["HOME"] == "/home/someone"  # the uv cache stays where it is


@pytest.mark.parametrize("name", ["DB_PASSWORD", "ADMIN_PASSWD", "db_password"])
def test_password_variables_are_secrets_too(heavy_dirs, monkeypatch, name):
    monkeypatch.setenv(name, "sentinel")
    assert name not in tools.runner_env(heavy_tool(heavy_dirs, ""))


def test_more_usage_reporting_is_off(heavy_dirs):
    env = tools.runner_env(heavy_tool(heavy_dirs, ""))
    assert env["ANONYMIZED_TELEMETRY"] == "False" and env["SCARF_NO_ANALYTICS"] == "true"
    assert env["NO_ALBUMENTATIONS_UPDATE"] == "1" and env["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] == "True"


def test_onnx_runtime_telemetry_is_off_in_a_heavy_run(heavy_dirs):
    assert tools.QUIET_VARS["ORT_DISABLE_TELEMETRY"] == "1"
    assert tools.runner_env(heavy_tool(heavy_dirs, ""))["ORT_DISABLE_TELEMETRY"] == "1"


def test_the_heavy_methods_get_the_page_set_and_n_neighbours():
    assert isinstance(tools.HEAVY_NEIGHBOURS, int) and tools.HEAVY_NEIGHBOURS >= 0
    assert all(tools.TOOLS[t].neighbours == tools.HEAVY_NEIGHBOURS for t in HEAVY)
    assert all(t.neighbours is None for t in tools.TOOLS.values() if t.group != "heavy")


def test_the_heavy_methods_are_named_in_the_protocol():
    from backend.eval.parser_bench import store

    protocol = (store.REPO / "docs/thesis/experiments/parser-benchmark/PROTOCOL.md").read_text(encoding="utf-8")
    for tool_id in HEAVY:  # paddleocr_vl_hf and paddleocr_vl_mlx are named by deviation 4
        assert f"`{tool_id}`" in protocol, tool_id
        for requirement in tools.TOOLS[tool_id].requirements:
            name, _, pinned = requirement.partition("==")
            assert f"{name.split('[')[0]} {pinned}" in protocol, requirement
    assert "2026-10-31" in protocol and "20261102" in protocol and "120 s/page" in protocol and "20261103" in protocol
