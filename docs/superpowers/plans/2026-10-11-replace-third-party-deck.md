# Replace the Third-Party Lecture Deck — superseded

**Status (2026-11-15):** superseded. The 2026-10-11 plan (an 82-page original deck with the same shape) was never started. A smaller replacement landed instead, on branch `claude/replace-normalization-deck`:

- `public/v4-mock/normalization.pdf` is now a 12-page Normalization deck written for Learnstation, rendered from `src/features/spaces/mocks/normalization-deck.json` by `scripts/v4-mock/build_normalization_deck.py`. The same JSON feeds the Lesson's slides (`content.normalization.ts`), its Material pages (`lessons.ts`) and the concept page ranges (`content.ts`), and the script also rebuilds the Studio fixture (`studio-normalization.json` and `public/v4-mock/studio/normalization-p1..p12.webp`).
- `backend/tests/unit/test_sample_deck.py` holds the PDF to its JSON, page by page.
- The lecturer's name is gone from every tracked file this deck touched (tests, mocks, plans, reports).

What this plan's decisions became:

| # | Question | Where it stands |
|---|---|---|
| D1 | Publish the original deck with the author's permission? | Not pursued: the deck is replaced. |
| D2 | Purge the old PDF and its extracted text from git history? | Open. Removing it from `main` leaves it in history and in every clone; a rewrite needs the owner's decision (listed in the PR). |
| D3 | Remove the group-wiki export from `project_docs/`? | Done in `d46056d3`. A second infrastructure PDF, `GPU-Server/GPU-Server_2024-05-02.pdf`, is still on `main`. |
| D4 | Make the `lecture-pdfs` bucket private? | Migration `20261024010000_lecture_pdfs_private_reads.sql`; check prod before relying on it. |

The full original plan is in git history (this file before 2026-11-15).
