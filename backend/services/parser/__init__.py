"""Parser package — unified PDF → course pipeline (PARSER_VERSION=5).

Modules
-------
unified_orchestrator.py  Server-authoritative parse pipeline (Arq job target:
                         ``parse_pdf_unified``); per-slide + lecture-level synthesis.
synthesis.py             LLM synthesis helpers (analyze_slide / analyze_lecture_meta /
                         generate_quiz_questions / _map_deck_quiz).
storage.py               PDF-bytes fetch from Supabase Storage.
persist.py, repos.py     Server-authoritative persistence + run lifecycle.

The legacy v3 (five-stage) and v4 orchestrators have been archived to
``backend/_legacy/`` (flag-not-delete); nothing here imports them.
"""
