"""Parser v3 — five-stage PDF → course pipeline.

Stage 1  stage1_ingest.py    Docling + PyMuPDF → ExtractedPage per slide
Stage 2  stage2_synthesize.py  Single LLM call → DeckOutline
Stage 3  stage3_generate.py  Per-slide AI (batched text + individual vision)
Stage 4  stage4_embed.py     FastEmbed bge-small → slide_chunks
Stage 5  stage5_finalize.py  Deck quiz + summary → mark run COMPLETED

Entry point: orchestrator.parse_pdf (Arq job target)
"""
