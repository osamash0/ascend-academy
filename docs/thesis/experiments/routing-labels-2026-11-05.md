# Routing labels, 2026-11-05: which low-text figure pages need the image?

*Author's labelling, recorded 2026-11-09 so that chapter 4 can cite it by path. Calibration data, not a held-out test: the labels were made before the routing rule of PR #178 was written and the rule was shaped to catch them.*

**Question put to each page:** "Could the text model explain this page from its raw text alone?" Label `image` means no.

**Sample:** all 55 pages of the 25-deck Deck Lab corpus (1,593 pages, 11 DBS decks in English, 14 SR decks in German) that have at least one figure block and 25–150 raw characters. 53 were labelled, all `image`; 2 were left without a saved label (Relational Design p67, Index Structures p78). The sample was chosen to be the hard case and labelled by the author, so no percentage of "pages needing vision" follows from it.

**File:** `routing-labels-2026-11-05.csv`, one row per page: deck, page, raw characters, footer-free characters (`page_blocks.text_chars`), figure blocks, figure area as a fraction of the page, label, and the route the shipped rule gives (`page_blocks.route_page` at `dfc20df6`: `no_text` below 25 footer-free characters, `figure` when figure area ≥ 5 % and under 150 characters, otherwise `text`).

**What the rule does on this set and on the corpus** (computed 2026-11-09 from the stored signals):

| | pages |
|---|---|
| labelled `image`, routed to vision (`figure`) | 52 |
| labelled `image`, routed to `text` (missed) | 1 |
| unlabelled, routed to vision | 2 |
| corpus routed `text` / `figure` / `no_text` | 1,506 / 75 / 12 |
| corpus pages with at least one figure block | 421 |
| corpus pages with 15–39 raw characters | 0 |

The old rule (25 raw characters) sent exactly the 12 `no_text` pages to vision: the 11 empty closing photo pages of the DBS decks and one "Summary SQL" page. None of the 421 figure pages reached vision under it.

**Not in the repo:** the page texts and PDFs (`pages.json`, `signals.json` with text, the deck files) stay local in the author's `learnstation-parser-bench/routing-2026-11-05/`; the scripts there (`signals.py`, `run.py`) are twelve lines each and reproduce the signals from the decks with `backend.eval.decks` and `page_blocks.extract_blocks`.

**How to cite:** "the author labelled 53 low-text figure pages (`docs/thesis/experiments/routing-labels-2026-11-05.csv`); the shipped rule routes 52 of them to vision. This is the calibration set of the rule, not an independent test."
