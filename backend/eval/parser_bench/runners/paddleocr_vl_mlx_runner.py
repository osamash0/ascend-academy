"""`paddleocr_vl_mlx`: PaddleOCR-VL 1.6 (Baidu's 0.9B document vision-language model) as the 4-bit MLX conversion
of mlx-community, run through Apple's MLX (mlx-vlm) on the Mac's GPU. The same model as `paddleocr_vl_hf`, which
works but is far too slow on this M1 (1 to 2 tokens/s through transformers, over the time limit on real slides):
through MLX it generates at about 120 tokens/s. Each whole page is sent as one image with the model card's own
"OCR:" prompt: a local, free counterpart of `ai_vision`, like the transformers method (the card's route does
element-level recognition, not page-level document parsing).

Every page of the given PDF is rendered with PyMuPDF at 2× (the zoom of ai_vision), saved as a PNG in a temporary
folder inside the run's working folder, and run on its own with greedy decoding (temperature 0.0). The weights are
loaded once per run from the local snapshot of one pinned revision (snapshot_download with local_files_only: a run
never downloads; install fetches it). A page that reaches max_tokens is kept and named in settings
("truncated_pages").

Exits non-zero, writing nothing, when any page fails: a partial result must never be scored as this method's.

Usage: python -I paddleocr_vl_mlx_runner.py <in.pdf> <out.json>
"""
import json
import os
import sys
import tempfile
from importlib.metadata import version

# Pinned in tools.py (PADDLEOCR_VL_MLX_REPO, PADDLEOCR_VL_MLX_REVISION), which install fetches; repeated here because
# a runner runs under `python -I` and imports nothing from the bench (a unit test keeps the two equal). A 4-bit
# community conversion of the official model (base PaddlePaddle/PaddleOCR-VL-1.6), Apache-2.0.
REPO = "mlx-community/PaddleOCR-VL-1.6-4bit"
REVISION = "c8987b277bdd8aaec8bd265d154f391bd03ad165"
BASE_MODEL = "PaddlePaddle/PaddleOCR-VL-1.6"
QUANTISATION = "4-bit (mlx-community conversion)"
PROMPT = "OCR:"
ZOOM = 2.0
MAX_TOKENS = 4096
TEMPERATURE = 0.0
ROUTE = "mlx-vlm (whole page image, the model card's OCR: prompt)"


def render_pages(path: str, folder: str) -> list:
    """Every page of the PDF as a PNG file at ZOOM in `folder`, in page order; the file names."""
    import pymupdf

    files = []
    with pymupdf.open(path) as doc:
        for n, page in enumerate(doc, start=1):
            pix = page.get_pixmap(matrix=pymupdf.Matrix(ZOOM, ZOOM), colorspace=pymupdf.csRGB, alpha=False)
            name = os.path.join(folder, f"page-{n}.png")
            pix.save(name)
            files.append(name)
    return files


def main(argv: list) -> None:
    # HF_HUB_OFFLINE: the weights come from the snapshot install fetched, never from the network. Set before
    # mlx-vlm (and so huggingface_hub) is imported.
    os.environ["HF_HUB_OFFLINE"] = "1"
    import mlx.core as mx
    from huggingface_hub import snapshot_download
    from mlx_vlm import generate, load
    from mlx_vlm.prompt_utils import apply_chat_template

    src, out = argv[1], argv[2]
    pages, tokens, truncated = {}, {}, []
    with tempfile.TemporaryDirectory(prefix="pvl-mlx-", dir=os.getcwd()) as folder:
        files = render_pages(src, folder)
        if not files:
            raise SystemExit("paddleocr_vl_mlx_runner: the PDF has no pages")
        snapshot = snapshot_download(repo_id=REPO, revision=REVISION, local_files_only=True)
        model, processor = load(snapshot)
        prompt = apply_chat_template(processor, model.config, PROMPT, num_images=1)
        for n, png in enumerate(files, start=1):
            result = generate(model, processor, prompt, [png], max_tokens=MAX_TOKENS, temperature=TEMPERATURE,
                              verbose=False)
            pages[str(n)] = result.text
            tokens[str(n)] = int(result.generation_tokens)
            if tokens[str(n)] >= MAX_TOKENS:
                truncated.append(n)
        device = str(mx.default_device())
    data = {
        "version": f"mlx-vlm {version('mlx-vlm')} + PaddleOCR-VL-1.6@{REVISION[:7]}",
        "settings": {"repo": REPO, "revision": REVISION, "base_model": BASE_MODEL, "quantisation": QUANTISATION,
                     "route": ROUTE, "prompt": PROMPT, "zoom": ZOOM, "max_tokens": MAX_TOKENS,
                     "decoding": f"greedy (temperature {TEMPERATURE})", "device": device,
                     "truncated_pages": truncated, "generation_tokens": tokens,
                     "weights": "local snapshot only (local_files_only, HF_HUB_OFFLINE=1)",
                     "renderer": f"pymupdf {version('pymupdf')}", "mlx": version("mlx"),
                     "mlx_vlm": version("mlx-vlm")},
        "pages": pages,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv)
