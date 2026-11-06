"""`paddleocr_vl_hf`: PaddleOCR-VL 1.6 (Baidu's 0.9B document vision-language model) run through Hugging Face
transformers on the Mac's GPU. The official PaddlePaddle pipeline (method `paddleocr_vl`) is too heavy for an 8 GB
Mac; the model card's transformers route does element-level recognition, not page-level document parsing, so
each whole page is sent as one image with the card's own "OCR:" prompt: a local, free counterpart of `ai_vision`.

Every page of the given PDF is rendered with PyMuPDF at 2× as RGB (the zoom of ai_vision) and run on its own,
following the model card's example: the processor's chat template with the image size limits (the card's
1280 * 28 * 28 pixel ceiling for the page image), greedy decoding, only the newly generated tokens decoded. The
weights are loaded once per run from the local snapshot of one pinned revision (local_files_only: a run never
downloads; install fetches it). float16 on "mps" with PyTorch's SDPA attention is tried first: on this M1 it
ran about twice as fast as the card's bfloat16 (0.57 against 1.07 s per generated token, same text, 2026-10-31);
when the model cannot run there (an operation MPS lacks, a dtype it refuses) on the first page, the next of
bfloat16 on mps and float32 on the CPU is used, and settings records every attempt that failed. A page that reaches max_new_tokens is kept and
named in settings ("truncated_pages").

Exits non-zero, writing nothing, when any page fails: a partial result must never be scored as this method's.

Usage: python -I paddleocr_vl_hf_runner.py <in.pdf> <out.json>
"""
import json
import os
import sys
from importlib.metadata import version

# Pinned in tools.py (PADDLEOCR_VL_HF_REPO, PADDLEOCR_VL_HF_REVISION), which install fetches; repeated here because
# a runner runs under `python -I` and imports nothing from the bench (a unit test keeps the two equal).
REPO = "PaddlePaddle/PaddleOCR-VL-1.6"
REVISION = "c5630abae1d940eafe0697512a0325494b02ab42"
PROMPT = "OCR:"
ZOOM = 2.0
MAX_PIXELS = 1280 * 28 * 28   # the card's ceiling for every task but spotting
MAX_NEW_TOKENS = 4096
ROUTE = "transformers (element-level per the model card; whole page image)"
WEIGHT_LOADING = "one thread (HF_DEACTIVATE_ASYNC_LOAD=1; transformers' threaded loading deadlocks here)"


def render_pages(path: str) -> list:
    """Every page of the PDF as an RGB image at ZOOM, in page order."""
    import pymupdf
    from PIL import Image

    images = []
    with pymupdf.open(path) as doc:
        for page in doc:
            pix = page.get_pixmap(matrix=pymupdf.Matrix(ZOOM, ZOOM), colorspace=pymupdf.csRGB, alpha=False)
            images.append(Image.frombytes("RGB", (pix.width, pix.height), pix.samples))
    return images


ATTENTION = "sdpa"  # PyTorch scaled-dot-product attention; also the speed-up measured above


def candidates(mps_available: bool) -> list:
    """The (device, dtype name) pairs to try, in order."""
    if mps_available:
        return [("mps", "float16"), ("mps", "bfloat16"), ("cpu", "float32")]
    return [("cpu", "float32")]


def _eos_ids(model) -> set:
    eos = getattr(getattr(model, "generation_config", None), "eos_token_id", None)
    if eos is None:
        return set()
    return {int(e) for e in eos} if isinstance(eos, (list, tuple)) else {int(eos)}


def min_pixels_of(processor) -> int:
    """The processor's lower pixel bound. The model card reads processor.image_processor.min_pixels, which
    transformers 5.22.1 no longer has: the value (112896 from preprocessor_config.json) is size.shortest_edge now."""
    size = processor.image_processor.size
    return int(size["shortest_edge"] if isinstance(size, dict) else size.shortest_edge)


def recognise(torch, processor, model, image) -> tuple:
    """(text, new token count, truncated) for one page image, the way the model card does it."""
    messages = [{"role": "user", "content": [{"type": "image", "image": image}, {"type": "text", "text": PROMPT}]}]
    inputs = processor.apply_chat_template(
        messages, add_generation_prompt=True, tokenize=True, return_dict=True, return_tensors="pt",
        images_kwargs={"size": {"shortest_edge": min_pixels_of(processor), "longest_edge": MAX_PIXELS}},
    ).to(model.device)
    with torch.inference_mode():
        outputs = model.generate(**inputs, max_new_tokens=MAX_NEW_TOKENS, do_sample=False)
    new = outputs[0][inputs["input_ids"].shape[-1]:]  # only what was generated, never the prompt
    count = int(new.shape[-1])
    truncated = count >= MAX_NEW_TOKENS and int(new[-1]) not in _eos_ids(model)
    return processor.decode(new, skip_special_tokens=True), count, truncated


def _release(torch, device) -> None:
    mps = getattr(torch, "mps", None)
    if device == "mps" and mps is not None and hasattr(mps, "empty_cache"):
        mps.empty_cache()


def main(argv: list) -> None:
    # transformers 5.x loads weights on a thread pool, and on this Mac that deadlocks at 0% CPU (as for mineru):
    # transformers' own switch loads on one thread instead. Set before transformers is imported. HF_HUB_OFFLINE: the
    # weights come from the snapshot install fetched, never from the network.
    os.environ["HF_DEACTIVATE_ASYNC_LOAD"] = "1"
    os.environ["HF_HUB_OFFLINE"] = "1"
    import torch
    from huggingface_hub import snapshot_download
    from transformers import AutoModelForImageTextToText, AutoProcessor

    src, out = argv[1], argv[2]
    images = render_pages(src)
    if not images:
        raise SystemExit("paddleocr_vl_hf_runner: the PDF has no pages")
    snapshot = snapshot_download(repo_id=REPO, revision=REVISION, local_files_only=True)
    processor = AutoProcessor.from_pretrained(snapshot, local_files_only=True)
    min_pixels = min_pixels_of(processor)
    failed_attempts, pages, tokens, truncated = [], {}, {}, []
    device = dtype_name = None
    for device, dtype_name in candidates(bool(torch.backends.mps.is_available())):
        model = None
        try:
            model = AutoModelForImageTextToText.from_pretrained(
                snapshot, dtype=getattr(torch, dtype_name), attn_implementation=ATTENTION,
                local_files_only=True).to(device).eval()
            first = recognise(torch, processor, model, images[0])  # the first page is the trial of this device and dtype
        except Exception as err:
            failed_attempts.append(f"{device} {dtype_name}: {type(err).__name__}: {str(err)[:200]}")
            del model
            _release(torch, device)
            continue
        break
    else:
        raise SystemExit("paddleocr_vl_hf_runner: no device and dtype could run the model: " + "; ".join(failed_attempts))
    for n, image in enumerate(images, start=1):
        text, count, cut = first if n == 1 else recognise(torch, processor, model, image)
        pages[str(n)] = text
        tokens[str(n)] = count
        if cut:
            truncated.append(n)
        _release(torch, device)
    data = {
        "version": f"transformers {version('transformers')} + PaddleOCR-VL-1.6@{REVISION[:7]}",
        "settings": {"repo": REPO, "revision": REVISION, "route": ROUTE, "prompt": PROMPT, "zoom": ZOOM,
                     "max_pixels": MAX_PIXELS, "min_pixels": min_pixels, "device": device, "dtype": dtype_name, "attention": ATTENTION,
                     "decoding": "greedy (do_sample False)", "max_new_tokens": MAX_NEW_TOKENS,
                     "truncated_pages": truncated, "new_tokens": tokens, "weight_loading": WEIGHT_LOADING,
                     "weights": "local snapshot only (local_files_only, HF_HUB_OFFLINE=1)",
                     "failed_attempts": failed_attempts, "renderer": f"pymupdf {version('pymupdf')}",
                     "torch": version("torch")},
        "pages": pages,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv)
