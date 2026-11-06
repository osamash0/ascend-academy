"""Which extraction methods exist, where each one runs, and how it is installed.

Each method with requirements gets its own uv environment (Python 3.12), because
the tools pin conflicting libraries. `current` runs in this interpreter, the
backend .venv, so it uses production's own PyMuPDF version. `pdfjs` runs on Node
with this repo's node_modules. The paid methods (ai_vision, ai_vision_strong) run in their own environment
too; they need the key file (paid.py) and a model id.

Heavy methods (docling, marker, mineru, paddleocr, paddleocr_vl, paddleocr_vl_hf, paddleocr_vl_mlx) download models. Each keeps them in its own
folder under models_root() (every cache variable its libraries read points there, CACHE_VARS), with usage
reporting off (QUIET_VARS). Its install resolves as PyPI stood on EXCLUDE_NEWER, imports the module, and then
fetches the models (its own download command, then one run of its runner on a synthetic page) before it counts
as installed. Its timed runs are held to the spec's time limit (TIME_LIMIT_PER_PAGE; execute.py). Its runs get
the parent environment minus secrets and minus cache overrides that would send models somewhere else.
"""
from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from importlib.metadata import version as dist_version
from pathlib import Path
from typing import Sequence

from backend.eval.parser_bench import paid
from backend.eval.parser_bench.store import REPO

RUNNERS = Path(__file__).resolve().parent / "runners"
GROUPS = ("fast", "heavy", "paid")
FREE_FLOOR = 3 * 2**30
IMPORT_TIMEOUT = 300  # seconds the post-install import may take (a first import compiles bytecode)
INSTALL_TIMEOUT = 1800  # seconds `uv venv` and `uv pip install` may each take
ENV_TIMEOUT = 60  # seconds each version probe in environment() may take
INSTALLED_MARKER = ".ls-installed"  # written last by install(); its presence means the install finished
TIME_LIMIT_PER_PAGE = 120.0  # spec: "A variant slower than 120 s/page on the M1 is recorded as did not run here"
EXCLUDE_NEWER = "2026-10-31"  # heavy installs resolve as PyPI stood on this day (Plan 3b): a reinstall is the same
HEAVY_NEIGHBOURS = 1  # deviation 3 (Abi, 2026-10-31): a heavy method is given the page set's pages and N neighbours
# Every place a heavy method's libraries keep downloaded models, each pointed into that method's own folder under
# models_root(): never the repository, never the data folder, never a cache shared with Abi's other tools.
CACHE_VARS = {
    "HF_HOME": "huggingface",            # Hugging Face hub: docling, surya (marker), mineru, paddlex
    "TORCH_HOME": "torch",
    "XDG_CACHE_HOME": "xdg",
    "DOCLING_CACHE_DIR": "docling",      # docling's own cache (docling.datamodel.settings: env_prefix DOCLING_, cache_dir)
    "MODELSCOPE_CACHE": "modelscope",    # mineru and paddlex can download from ModelScope
    "PADDLE_PDX_CACHE_HOME": "paddlex",  # PaddleX official models (paddleocr, paddleocr_vl)
    "MINERU_HOME": "mineru",             # MinerU's config.yaml and models
    "MODEL_CACHE_DIR": "datalab",        # surya's model cache (marker)
    "EASYOCR_MODULE_PATH": "easyocr",
}
# Overrides a heavy run must NOT inherit from the parent, because they win over (or bypass) CACHE_VARS and would
# send models to Abi's own caches. DOCLING_ARTIFACTS_PATH is dropped, not pointed at a folder: docling then expects
# its models inside that folder and fails when they are not (docling.pipeline.base_pipeline), instead of using
# DOCLING_CACHE_DIR.
INHERITED_CACHE_OVERRIDES = (
    "HF_HUB_CACHE", "HUGGINGFACE_HUB_CACHE", "HF_ASSETS_CACHE", "HUGGINGFACE_ASSETS_CACHE", "HF_XET_CACHE",
    "HF_DATASETS_CACHE", "TRANSFORMERS_CACHE", "PYTORCH_TRANSFORMERS_CACHE", "PYTORCH_PRETRAINED_BERT_CACHE",
    "DOCLING_ARTIFACTS_PATH", "PADDLE_HOME", "PADDLEOCR_HOME",
)
# Usage reporting off: nothing of the benchmark leaves the Mac except through the paid methods (spec, Safety).
# Values are each library's own spelling: paddlex compares with the string "True", chromadb/posthog-style flags
# read "False", albumentations and scarf accept "1"/"true". Not verifiable offline here (none is installed in
# the backend venv); a wrong spelling only leaves one reporting channel on, it breaks nothing.
QUIET_VARS = {
    "HF_HUB_DISABLE_TELEMETRY": "1", "DO_NOT_TRACK": "1", "MINERU_TELEMETRY_DISABLED": "1",
    "ANONYMIZED_TELEMETRY": "False", "SCARF_NO_ANALYTICS": "true", "NO_ALBUMENTATIONS_UPDATE": "1",
    "PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK": "True",
    # ONNX Runtime's built-in usage telemetry to Microsoft (compiled into onnxruntime 1.31.1 on macOS; mineru's
    # environment has it); onnxruntime reads the variable at import.
    "ORT_DISABLE_TELEMETRY": "1",
}
# Third-party model code gets the parent environment minus these (spec, Safety: only the paid methods may use a key).
_SECRET_PREFIXES = ("OPENAI_", "SUPABASE_", "AWS_")
_SECRET_NAMES = ("DATABASE_URL", "GOOGLE_APPLICATION_CREDENTIALS")
_SECRET_SUFFIXES = ("_KEY", "_TOKEN", "_SECRET", "_PASSWORD", "_PASSWD")


class DiskSpaceError(RuntimeError):
    """Installing would leave less than FREE_FLOOR on the disk."""


class ToolNotReady(RuntimeError):
    """A method is missing its environment or a program it needs."""


@dataclass(frozen=True)
class Tool:
    id: str
    label: str
    group: str
    runner: str
    description: str
    kind: str = "python"                 # "python" | "node"
    requirements: tuple[str, ...] = ()   # empty: runs in an interpreter that already has it
    python: str = "3.12"
    needs: tuple[str, ...] = ()          # programs that must be on PATH
    size_mb: int = 0                     # rough install size, for the disk guard
    import_name: str | None = None       # module install() must be able to import before the env counts as installed
    ocr: bool = False                    # may call Tesseract by default; its version is recorded with every run
    paid: bool = False                   # sends page images to a paid API: key file, model id, a cost OK per run
    model: str = ""                      # paid methods: the API model id (PROTOCOL.md deviation 2)
    temperature: float | None = 0.0      # paid methods: None = the model's default, only when it rejects 0 (recorded)
    downloads_models: bool = False       # heavy methods: models in models_dir(), fetched at install (_prefetch)
    prefetch: tuple[tuple[str, ...], ...] = ()  # download commands from the environment's bin/, run at install
    limit_per_page: float | None = None  # the spec's time limit (s/page) for its timed runs; None: no limit
    exclude_newer: str | None = None     # uv resolves the install as PyPI stood on this date
    # Arguments between the runner and <in.pdf> <out.json>, which is how two methods share one runner file. Python
    # methods only: command() adds them for kind "python"; the node method takes none.
    runner_args: tuple[str, ...] = ()
    neighbours: int | None = None  # heavy methods (deviation 3): given only the scored pages and this many on each side

    @property
    def runner_path(self) -> Path:
        p = Path(self.runner)
        return p if p.is_absolute() else RUNNERS / p


# Production's vision model: OPENAI_VISION_MODEL defaults to OPENAI_MODEL, whose launch setting is gpt-4.1-mini
# (.env.example; backend/services/ai/orchestrator.py). Taken from there, not from the production environment.
AI_VISION_MODEL = "gpt-4.1-mini"
# One current stronger OpenAI vision model, chosen with Abi from the account's live model list (Plan 3a Task 16).
# Empty until then: the method is not ready and paid_args() refuses it.
AI_VISION_STRONG_MODEL = "gpt-6.1-sol"

# marker's surya VLM weights. The probe page is a clean text page that never starts the VLM server, so the
# probe run would not fetch them; surya's LlamaCppBackend.start() downloads them on first use, which would land
# inside a timed run. Fetched here instead, with the names and repo of surya-ocr 0.23.0 (surya/settings.py:
# SURYA_GGUF_REPO, SURYA_GGUF_MODEL_FILE, SURYA_GGUF_MMPROJ_FILE; the only hf_hub_download calls, in
# surya/inference/backends/llamacpp.py). HF_HOME is the method's model folder (runner_env).
MARKER_VLM_REPO = "datalab-to/surya-ocr-2.5-gguf"
MARKER_VLM_FILES = ("surya-2.5.gguf", "surya-2.5-mmproj.gguf")
MARKER_VLM_FETCH = ("python", "-I", "-c",
                    "from huggingface_hub import hf_hub_download as d\n"
                    f"[d(repo_id={MARKER_VLM_REPO!r}, filename=f) for f in {MARKER_VLM_FILES!r}]")

# PaddleOCR-VL 1.6 through transformers (method paddleocr_vl_hf). The runner loads exactly this revision from the
# method's own model folder (HF_HOME, runner_env); install fetches it with the step below, a run never downloads.
# Apache-2.0, model.safetensors 1,917,255,968 bytes (bf16); transformers 5.22.1 has the architecture natively
# (transformers.models.paddleocr_vl, no trust_remote_code). Revision checked 2026-10-31.
PADDLEOCR_VL_HF_REPO = "PaddlePaddle/PaddleOCR-VL-1.6"
PADDLEOCR_VL_HF_REVISION = "c5630abae1d940eafe0697512a0325494b02ab42"
PADDLEOCR_VL_HF_FETCH = ("python", "-I", "-c",
                         "from huggingface_hub import snapshot_download as d\n"
                         f"d(repo_id={PADDLEOCR_VL_HF_REPO!r}, revision={PADDLEOCR_VL_HF_REVISION!r})")

# PaddleOCR-VL 1.6, 4-bit, through MLX (method paddleocr_vl_mlx): the community conversion of the official model
# (base PaddlePaddle/PaddleOCR-VL-1.6) that mlx-vlm loads. The runner loads exactly this revision from the method's
# own model folder (HF_HOME, runner_env); install fetches it with the step below, a run never downloads.
# Apache-2.0, 682 MB. Revision checked 2026-11-01. The pins (mlx-vlm 0.7.11, 2026-10-28; mlx 0.32.4, 2026-10-14;
# transformers 5.22.1, 2026-10-30) were all on PyPI before EXCLUDE_NEWER, so the install keeps that date.
PADDLEOCR_VL_MLX_REPO = "mlx-community/PaddleOCR-VL-1.6-4bit"
PADDLEOCR_VL_MLX_REVISION = "c8987b277bdd8aaec8bd265d154f391bd03ad165"
PADDLEOCR_VL_MLX_FETCH = ("python", "-I", "-c",
                          "from huggingface_hub import snapshot_download as d\n"
                          f"d(repo_id={PADDLEOCR_VL_MLX_REPO!r}, revision={PADDLEOCR_VL_MLX_REVISION!r})")

# PaddleOCR 3: both methods install the same pins (paddleocr's doc-parser extra pulls PaddleX's OCR and genai
# clients). They differ only by the runner's --pipeline argument. Their models (PaddleX official models, in
# PADDLE_PDX_CACHE_HOME/official_models, from Hugging Face by default) are fetched when the pipeline is built, and
# paddlex 3.7.2 builds the sub-models its config uses at that moment (PADDLE_PDX_EAGER_INIT defaults to True), so
# install's probe run fetches those. One model it builds only on a first table (table_recognition/pipeline_v2.py:
# table_orientation_classify_model, PP-LCNet_x1_0_doc_ori) the probe page never reaches: PP-StructureV3 fetches it
# in a prefetch step through PaddleX's own official_models. PaddleOCR-VL has no such lazy path (every create_model
# call is in its __init__).
PADDLE_PINS = ("paddleocr[doc-parser]==3.7.0", "paddlex==3.7.2", "paddlepaddle==3.3.1")
PADDLE_TABLE_ORIENTATION_MODEL = "PP-LCNet_x1_0_doc_ori"
PADDLE_TABLE_ORIENTATION_FETCH = ("python", "-I", "-c",
                                  "from paddlex.inference.utils.official_models import official_models\n"
                                  f"official_models.get_model_path({PADDLE_TABLE_ORIENTATION_MODEL!r})")

TOOLS: dict[str, Tool] = {t.id: t for t in (
    Tool("current", "Our pipeline (PyMuPDF)", "fast", "current_runner.py",
         "exactly what production stores today"),
    Tool("pymupdf4llm", "pymupdf4llm", "fast", "pymupdf4llm_runner.py",
         "Markdown mode of the same library", requirements=("pymupdf4llm==1.28.2",), size_mb=230, import_name="pymupdf4llm",
         ocr=True),
    Tool("pdfjs", "PDF.js", "fast", "pdfjs_runner.mjs",
         "the browser's text layer", kind="node", needs=("node",)),
    Tool("markitdown", "MarkItDown", "fast", "markitdown_runner.py",
         "Microsoft's converter, page by page", requirements=("markitdown[pdf]==0.1.6", "pypdf"), size_mb=190, import_name="markitdown"),
    Tool("opendataloader", "OpenDataLoader", "fast", "opendataloader_runner.py",
         "layout-aware, uses Java", requirements=("opendataloader-pdf==2.4.1",), needs=("java",), size_mb=30,
         import_name="opendataloader_pdf"),
    Tool("ai_vision", "AI vision", "paid", "ai_vision_runner.py",
         "the OpenAI model our pipeline uses, reading each page as a 2× image", requirements=("pymupdf==1.27.1",),
         size_mb=60, import_name="pymupdf", paid=True, model=AI_VISION_MODEL),
    Tool("ai_vision_strong", "AI vision, stronger model", "paid", "ai_vision_runner.py",
         "a current stronger OpenAI model, same prompt and image", requirements=("pymupdf==1.27.1",),
         size_mb=60, import_name="pymupdf", paid=True, model=AI_VISION_STRONG_MODEL,
         temperature=None),  # gpt-6.1-sol rejects 0 (HTTP 400 unsupported_value, probe 2026-10-31): model default
    Tool("docling", "Docling", "heavy", "docling_runner.py",
         "IBM's layout model and TableFormer, default pipeline", requirements=("docling==2.145.0",),
         size_mb=1800, import_name="docling", downloads_models=True, limit_per_page=TIME_LIMIT_PER_PAGE,
         exclude_newer=EXCLUDE_NEWER, neighbours=HEAVY_NEIGHBOURS),
    Tool("marker", "Marker", "heavy", "marker_runner.py",
         "surya layout and OCR models, LLM enhancement off; its VLM runs through llama.cpp",
         requirements=("marker-pdf==2.1.0",), needs=("llama-server",), size_mb=4000, import_name="marker",
         downloads_models=True, prefetch=(MARKER_VLM_FETCH,), limit_per_page=TIME_LIMIT_PER_PAGE,
         exclude_newer=EXCLUDE_NEWER, neighbours=HEAVY_NEIGHBOURS),
    Tool("mineru", "MinerU", "heavy", "mineru_runner.py",
         "OpenDataLab's model pipeline (tier basic, no VLM)", requirements=("mineru==4.1.3",), size_mb=2600,
         import_name="mineru", downloads_models=True, prefetch=(("mineru-kit", "models", "download", "--tier", "basic"),),
         limit_per_page=TIME_LIMIT_PER_PAGE, exclude_newer=EXCLUDE_NEWER, neighbours=HEAVY_NEIGHBOURS),
    Tool("paddleocr", "PaddleOCR PP-StructureV3", "heavy", "paddleocr_runner.py",
         "Baidu's document pipeline, Markdown; CPU (PaddlePaddle has no MPS)", requirements=PADDLE_PINS,
         size_mb=2800, import_name="paddleocr", downloads_models=True, runner_args=("--pipeline", "structure"),
         prefetch=(PADDLE_TABLE_ORIENTATION_FETCH,), limit_per_page=TIME_LIMIT_PER_PAGE, exclude_newer=EXCLUDE_NEWER,
         neighbours=HEAVY_NEIGHBOURS),
    Tool("paddleocr_vl", "PaddleOCR-VL", "heavy", "paddleocr_runner.py",
         "Baidu's 0.9B document VLM, tried as well; CPU", requirements=PADDLE_PINS,
         size_mb=3000, import_name="paddleocr", downloads_models=True, runner_args=("--pipeline", "vl"),
         limit_per_page=TIME_LIMIT_PER_PAGE, exclude_newer=EXCLUDE_NEWER, neighbours=HEAVY_NEIGHBOURS),
    Tool("paddleocr_vl_hf", "PaddleOCR-VL 1.6 (transformers)", "heavy", "paddleocr_vl_hf_runner.py",
         "Baidu's 0.9B document VLM via Hugging Face transformers on the Mac's GPU; whole page image, prompt OCR:",
         requirements=("transformers==5.22.1", "torch==2.15.0", "pymupdf==1.27.1", "pillow==13.0.0"),
         size_mb=3400, import_name="transformers", downloads_models=True, prefetch=(PADDLEOCR_VL_HF_FETCH,),
         limit_per_page=TIME_LIMIT_PER_PAGE, exclude_newer=EXCLUDE_NEWER, neighbours=HEAVY_NEIGHBOURS),
    Tool("paddleocr_vl_mlx", "PaddleOCR-VL 1.6 (MLX, 4-bit)", "heavy", "paddleocr_vl_mlx_runner.py",
         "Baidu's 0.9B document VLM, 4-bit, through Apple's MLX on the Mac's GPU; whole page image, prompt OCR:",
         requirements=("mlx-vlm==0.7.11", "mlx==0.32.4", "transformers==5.22.1", "pymupdf==1.27.1"),
         size_mb=1500, import_name="mlx_vlm", downloads_models=True, prefetch=(PADDLEOCR_VL_MLX_FETCH,),
         limit_per_page=TIME_LIMIT_PER_PAGE, exclude_newer=EXCLUDE_NEWER, neighbours=HEAVY_NEIGHBOURS),
)}


def envs_root() -> Path:
    root = Path(os.environ.get("PARSER_BENCH_ENVS") or Path.home() / ".cache" / "learnstation-parser-bench" / "envs")
    return root.expanduser().resolve()


def env_python(tool: Tool) -> Path:
    return envs_root() / tool.id / "bin" / "python"


def marker(tool: Tool) -> Path:
    return envs_root() / tool.id / INSTALLED_MARKER


def models_root() -> Path:
    root = Path(os.environ.get("PARSER_BENCH_MODELS") or Path.home() / ".cache" / "learnstation-parser-bench" / "models")
    return root.expanduser().resolve()


def models_dir(tool: Tool) -> Path:
    return models_root() / tool.id


def bin_dir() -> Path:
    """Programs the bench needs that uv cannot install (llama.cpp's llama-server, for marker) may live here."""
    root = Path(os.environ.get("PARSER_BENCH_BIN") or Path.home() / ".cache" / "learnstation-parser-bench" / "bin")
    return root.expanduser().resolve()


def which(program: str) -> str | None:
    """A program in bin_dir() first, else on PATH."""
    local = bin_dir() / program
    if local.is_file() and os.access(local, os.X_OK):
        return str(local)
    return shutil.which(program)


def _is_secret(name: str) -> bool:
    upper = name.upper()
    return upper.startswith(_SECRET_PREFIXES) or upper in _SECRET_NAMES or upper.endswith(_SECRET_SUFFIXES)


def _without_secrets(environ: dict[str, str] | os._Environ) -> dict[str, str]:
    return {k: v for k, v in environ.items() if not _is_secret(k)}


def runner_env(tool: Tool) -> dict[str, str] | None:
    """The environment a heavy method's runner starts with: the parent's, minus secrets and minus cache overrides
    that would bypass the model folders, plus its own model folders, usage reporting off and bin_dir() first on
    PATH. None for every other method, which inherits the environment unchanged."""
    if not tool.downloads_models:
        return None
    env = {k: v for k, v in _without_secrets(os.environ).items() if k not in INHERITED_CACHE_OVERRIDES}
    env.update({var: str(models_dir(tool) / sub) for var, sub in CACHE_VARS.items()})
    # HOME itself moves into the model folder: libraries whose defaults are HOME-relative (MinerU's ~/mineru.json,
    # platformdirs' ~/Library/Caches on macOS, ~/.cache/paddle, XDG config/data/state) then land there too.
    home = models_dir(tool) / "home"
    home.mkdir(parents=True, exist_ok=True)
    env.update({
        "HOME": str(home),
        "XDG_CONFIG_HOME": str(home / ".config"),
        "XDG_DATA_HOME": str(home / ".local" / "share"),
        "XDG_STATE_HOME": str(home / ".local" / "state"),
        "MINERU_TOOLS_CONFIG_JSON": str(home / "mineru.json"),
    })
    env.update(QUIET_VARS)
    env["PATH"] = os.pathsep.join([str(bin_dir()), os.environ.get("PATH", "")])
    return env


def dir_bytes(path: Path) -> int:
    """Bytes in the regular files under `path`. Symbolic links (the Hugging Face cache's snapshots) are neither
    followed nor counted, so each downloaded file counts once."""
    total = 0
    for folder, _dirs, names in os.walk(path):
        for name in names:
            try:
                info = os.lstat(os.path.join(folder, name))
            except OSError:
                continue
            if stat.S_ISREG(info.st_mode):
                total += info.st_size
    return total


def cache_mb(tool: Tool) -> float | None:
    """The size of a heavy method's model folder in MB (0.0 when it has none yet); None for other methods."""
    if not tool.downloads_models:
        return None
    target = models_dir(tool)
    return round(dir_bytes(target) / 2**20, 1) if target.exists() else 0.0


def clear_models(tool: Tool, *, force: bool = False) -> int:
    """Delete a heavy method's downloaded models (spec: "its model files are deleted if needed"); its environment
    and its runs stay. Returns the bytes freed. What it takes to get them back depends on the method: clear_note.
    A method with install-time prefetch steps (`Tool.prefetch`) is refused unless `force`: for it, clearing the
    models cannot be undone by a warm-up."""
    if not tool.downloads_models:
        raise ValueError(f"{tool.id} keeps no downloaded models")
    target = models_dir(tool)
    if target.resolve().parent != models_root():
        raise ValueError(f"{tool.id!r} is not a model folder of the bench")
    if tool.prefetch and not force:
        raise ValueError(f"{tool.id}: not cleared, {clear_note(tool)}")
    if not target.exists():
        return 0
    freed = dir_bytes(target)
    shutil.rmtree(target)
    return freed


def clear_note(tool: Tool) -> str:
    """How a cleared method gets its models back, true for that method. A method with install-time prefetch steps
    (`Tool.prefetch`) gets its models only from install; a method without them fetches what is missing on first
    use, which the untimed warm-up absorbs."""
    if tool.prefetch:
        return (f"its models come only from install: run `python -m backend.eval.parser_bench install {tool.id}` "
                f"again before its next run")
    return "the next warm-up downloads them again, untimed"


def probe_pdf(path: Path) -> Path:
    """A one-page synthetic PDF with no course content: what install runs a heavy method on to fetch its models."""
    import fitz

    doc = fitz.open()
    page = doc.new_page(width=842, height=595)
    page.insert_text((60, 110), "Probe page", fontsize=28)
    page.insert_text((60, 170), "- a first point", fontsize=16)
    page.insert_text((60, 200), "- a second point", fontsize=16)
    doc.save(path)
    doc.close()
    return path


def pdfjs_package() -> Path:
    return REPO / "node_modules" / "pdfjs-dist" / "package.json"


def needs_install(tool: Tool) -> bool:
    """The method has requirements and its environment is not (completely) installed."""
    return bool(tool.requirements) and not (marker(tool).exists() and env_python(tool).exists())


def missing(tool: Tool) -> list[str]:
    gaps = [program for program in tool.needs if which(program) is None]
    if tool.kind == "node" and not pdfjs_package().exists():
        gaps.append("node_modules/pdfjs-dist (run npm install)")
    if needs_install(tool):
        gaps.append(f"its environment (python -m backend.eval.parser_bench install {tool.id})")
    if tool.paid:
        if not tool.model.strip():
            gaps.append("its model id (tools.py, set in the protocol step)")
        problem = paid.key_problem()
        if problem:
            gaps.append(problem)
    return gaps


def is_ready(tool: Tool) -> bool:
    return not missing(tool)


def command(tool: Tool) -> list[str]:
    if tool.kind == "node":
        return [shutil.which("node") or "node", str(tool.runner_path)]
    python = str(env_python(tool)) if tool.requirements else sys.executable
    return [python, "-I", str(tool.runner_path), *tool.runner_args]


def paid_args(tool: Tool, pages: Sequence[int]) -> list[str]:
    """The paid runner's arguments after <in.pdf> <out.json>: the pages to send, the model, the temperature and
    the key file's path (the path, never the key). Empty for a method that costs nothing."""
    if not tool.paid:
        return []
    if not tool.model.strip():
        raise ToolNotReady(f"{tool.id} has no model id; set it in tools.py (protocol step)")
    if not pages:
        raise ValueError("a paid method needs the pages to send")
    temperature = "default" if tool.temperature is None else repr(float(tool.temperature))
    return ["--pages", ",".join(str(p) for p in sorted(set(pages))), "--model", tool.model,
            "--temperature", temperature, "--key-file", str(paid.KEY_FILE)]


def _uv() -> str:
    uv = shutil.which("uv") or str(Path.home() / ".local" / "bin" / "uv")
    if not Path(uv).exists():
        raise ToolNotReady("uv is not installed (https://docs.astral.sh/uv/)")
    return uv


def _existing_ancestor(path: Path) -> Path:
    """The nearest path that exists: the volume can be probed before the environment folder is made."""
    while not path.exists():
        path = path.parent
    return path


def install(tool: Tool, *, free_bytes: int | None = None) -> list[str]:
    """Create the method's own environment, then mark it installed; return its exact package list."""
    if not tool.requirements:
        return environment(tool)
    free = shutil.disk_usage(_existing_ancestor(envs_root())).free if free_bytes is None else free_bytes
    if free - tool.size_mb * 2**20 < FREE_FLOOR:
        with_models = " with its models" if tool.downloads_models else ""
        raise DiskSpaceError(f"installing {tool.id} (~{tool.size_mb} MB{with_models}) would leave less than 3 GB free "
                             f"({free / 2**30:.1f} GB free now)")
    uv = _uv()
    env = envs_root() / tool.id
    marker(tool).unlink(missing_ok=True)  # a failed reinstall must not inherit the earlier "installed" mark
    try:
        if not env_python(tool).exists():
            subprocess.run([uv, "venv", "--python", tool.python, str(env)], check=True, timeout=INSTALL_TIMEOUT,
                           env=_without_secrets(os.environ))
        pip = [uv, "pip", "install", "--python", str(env_python(tool))]
        if tool.exclude_newer:
            pip += ["--exclude-newer", tool.exclude_newer]
        subprocess.run([*pip, *tool.requirements], check=True, timeout=INSTALL_TIMEOUT,
                       env=_without_secrets(os.environ))
    except subprocess.TimeoutExpired:
        raise ToolNotReady(f"{tool.id} install timed out") from None
    _check_imports(tool)
    _prefetch(tool)
    marker(tool).write_text("\n".join(_freeze(tool)) + "\n", encoding="utf-8")
    return environment(tool)


def _check_imports(tool: Tool) -> None:
    """An install that exits 0 can still leave nothing importable (an empty placeholder package): refuse to mark it."""
    if tool.import_name is None:
        return
    extra = {}
    try:
        with tempfile.TemporaryDirectory() as tmp:
            if tool.downloads_models:  # an import can create cache folders: under the method's own, from a scratch cwd
                extra = {"env": runner_env(tool), "cwd": tmp}
            probe = subprocess.run(
                [str(env_python(tool)), "-I", "-c", f"import {tool.import_name}"],
                capture_output=True, text=True, timeout=IMPORT_TIMEOUT, **extra,
            )
    except subprocess.TimeoutExpired:
        raise ToolNotReady(f"{tool.id} installed but importing it timed out") from None
    if probe.returncode != 0:
        lines = (probe.stderr or "").strip().splitlines()
        raise ToolNotReady(f"{tool.id} installed but does not import: {lines[-1] if lines else 'no error output'}")


def _prefetch(tool: Tool) -> None:
    """A heavy method downloads its models now, not in a run: its own download commands (from its environment's
    bin/), then one run of its runner on a synthetic page, which must give back text for page 1. The probe also
    checks the runner against the library actually installed. The probe goes through execute.invoke(), the
    measured run path, so it runs in its own process group and everything it started, a server that outlives its
    runner included, is stopped before install goes on. Every command runs from a temporary folder, never the
    repository. Any failure leaves the method uninstalled."""
    if not tool.downloads_models:
        return
    from backend.eval.parser_bench import execute  # execute imports this module
    env = runner_env(tool)
    models_dir(tool).mkdir(parents=True, exist_ok=True)
    try:
        with tempfile.TemporaryDirectory() as tmp:
            for step in tool.prefetch:
                subprocess.run([str(env_python(tool).parent / step[0]), *step[1:]], check=True,
                               timeout=INSTALL_TIMEOUT, env=env, cwd=tmp, stdin=subprocess.DEVNULL)
            pdf = probe_pdf(Path(tmp) / "probe.pdf")
            try:
                probe = execute.invoke(tool, pdf, timeout=INSTALL_TIMEOUT)
            except OSError as exc:  # the runner's own interpreter is missing or cannot start
                raise ToolNotReady(f"{tool.id} installed but its probe run could not start "
                                   f"({exc.strerror or type(exc).__name__})") from None
            except execute.RunnerError as exc:
                if exc.timed_out:
                    raise subprocess.TimeoutExpired([tool.id], INSTALL_TIMEOUT) from None
                if exc.output:
                    raise ToolNotReady(f"{tool.id} installed but its probe run gave no text for page 1") from None
                lines = exc.log.strip().splitlines()
                detail = lines[-1] if lines else str(exc)
                raise ToolNotReady(f"{tool.id} installed but its probe run failed: {detail}") from None
            if not probe.pages.get(1, "").strip():
                raise ToolNotReady(f"{tool.id} installed but its probe run gave no text for page 1")
    except subprocess.TimeoutExpired:
        raise ToolNotReady(f"{tool.id}: downloading its models or its probe run timed out") from None
    except OSError as exc:  # the download program is missing or cannot start
        raise ToolNotReady(f"{tool.id}: its download step `{Path(exc.filename or '?').name}` could not start "
                           f"({exc.strerror or type(exc).__name__})") from None
    except subprocess.CalledProcessError as exc:
        raise ToolNotReady(f"{tool.id}: its download step `{Path(exc.cmd[0]).name}` failed (exit {exc.returncode})") from None


def _freeze(tool: Tool) -> list[str]:
    """The sorted package list of a method's own environment."""
    frozen = subprocess.run(
        [_uv(), "pip", "freeze", "--python", str(env_python(tool))], capture_output=True, text=True, check=True,
        timeout=ENV_TIMEOUT, env=_without_secrets(os.environ),
    ).stdout
    return sorted(line for line in frozen.splitlines() if line.strip())


def _java_version() -> str:
    java = subprocess.run([shutil.which("java") or "java", "-version"], capture_output=True, text=True, timeout=ENV_TIMEOUT)
    text = (java.stderr or java.stdout).strip()  # java prints its version to stderr
    return text.splitlines()[0] if text else "java: no version output"


def _tesseract_version() -> str:
    tesseract = shutil.which("tesseract")
    if tesseract is None:
        return "tesseract: not installed"
    probe = subprocess.run([tesseract, "--version"], capture_output=True, text=True, timeout=ENV_TIMEOUT)
    text = (probe.stdout or probe.stderr).strip()
    return text.splitlines()[0] if text else "tesseract: no version output"


def _llama_version() -> str:
    """llama.cpp's version line, for a method that needs llama-server (marker runs its VLM through it here)."""
    program = which("llama-server")
    if program is None:
        return "llama-server: not installed"
    probe = subprocess.run([program, "--version"], capture_output=True, text=True, timeout=ENV_TIMEOUT)
    text = "\n".join(part for part in (probe.stdout, probe.stderr) if part).strip()
    found = [line for line in text.splitlines() if "version" in line.lower()]
    line = found[0] if found else (text.splitlines()[0] if text else "no version output")
    return f"llama-server {line.strip()}"


def environment(tool: Tool) -> list[str]:
    """Exact versions of what runs, recorded in every run.json."""
    if tool.kind == "node":
        node = subprocess.run([shutil.which("node") or "node", "--version"], capture_output=True, text=True,
                              timeout=ENV_TIMEOUT).stdout.strip()
        pkg = json.loads(pdfjs_package().read_text()) if pdfjs_package().exists() else {}
        lines = [f"node {node}", f"pdfjs-dist=={pkg.get('version', '?')}"]
    elif tool.requirements:
        python = subprocess.run([str(env_python(tool)), "--version"], capture_output=True, text=True, check=True,
                                timeout=ENV_TIMEOUT)
        lines = [(python.stdout or python.stderr).strip(), *_freeze(tool)]
    else:
        lines = [f"pymupdf=={dist_version('pymupdf')}", f"python {sys.version.split()[0]}"]
    if "java" in tool.needs:
        lines.append(_java_version())
    if "llama-server" in tool.needs:
        lines.append(_llama_version())
    if tool.ocr:
        lines.append(_tesseract_version())
    return lines
