"""Parser benchmark: which extraction gives learners clean text.

Spec: docs/superpowers/specs/2026-10-30-parser-benchmark-design.md

Runs PDF extraction methods on lecture decks, keeps every run as a permanent
record outside git (slide text must never reach the public repo), and scores
each page with automatic checks. It imports nothing from the app: importing
backend.core loads the main checkout's .env, which holds production credentials.

    python -m backend.eval.parser_bench tools
"""
