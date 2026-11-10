# LlamaParse: one-deck trial, 2026-10-31

*Written 2026-11-09 from the session notes kept on Abi's machine. The trial itself left nothing in git; this file exists so the thesis can cite a dated record instead of a memory. Facts that the repository can confirm are marked with a path. Everything else is "as noted on 2026-10-31" and should be cited as such.*

## Question

Abi asked whether the LlamaIndex framework, and its hosted PDF parser LlamaParse, should replace parts of Learnstation's own pipeline. Luna's retrieval is about 600 lines of hand-written pgvector code; a framework would add dependencies that the supply-chain scan has to carry.

## Setup

- One deck: *Softwaretechnik* deck 1 (27 pages). It was chosen because the parser benchmark had excluded it after Abi had seen its outputs unblinded (`docs/thesis/experiments/parser-benchmark/LAB_LOG.md`, first entry), so an ad-hoc trial could not contaminate the blind judging.
- Adapter: `backend/services/llamaparse_service.py` (added 2026-07-07 in `b35a861a` as one of several optional extractors).
- Package: `llama-cloud-services==0.6.35` pinned in `backend/requirements.txt`; the local `.venv` had 0.6.94. The production image never contains it: `backend/requirements-docker.txt` leaves it out ("lazy import, parser v3/v4 only"), so production has never parsed with LlamaParse.

## Findings (as noted 2026-10-31)

1. **Page numbering was wrong from page 8 on.** LlamaParse's default page separator is a Markdown rule (`---`), which also appears above slide footers, so the adapter received 35 documents for 27 pages and fell back to the document index. Setting `page_separator` to a unique marker that carries the page number gave 27 of 27 pages. The fix was not applied to the code.
2. **The package is deprecated.** Upstream ended maintenance of `llama-cloud-services` on 2026-05-01; the successor is `llama-cloud>=1.0`.
3. **Quality.** About 14 s for 27 pages. Clean headings, nested bullets and quotes; it read a screenshot table on page 26. Against that: footers kept on 23 of 27 pages, inline HTML (`<mark>`, `<u>`) in the Markdown, a diagram on page 17 turned into a table, and a meme image on page 12 turned into an invented two-column table.

## Decision

Not adopted. The framework was judged not worth its dependencies, and the parser was not added to the benchmark, because that would have needed a protocol deviation (`PROTOCOL.md`), and the benchmark already had a hosted-AI arm (`ai_vision`, `ai_vision_strong`).

## How to cite

As a one-deck, unblinded, author-judged trial: it shows what a hosted parser gets right (structure) and wrong (footers, invented tables), nothing more. It must not be compared with the benchmark scores.
