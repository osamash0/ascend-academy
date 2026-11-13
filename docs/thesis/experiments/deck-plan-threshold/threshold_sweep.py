"""How much the deck plan's 60 % boilerplate threshold matters (thesis 4.4.3).

For each threshold, find_boilerplate (deck_plan.py, unchanged since the pin
dfc20df6) runs on every deck. The script prints counts only: no line of slide
text, because the decks are course material and stay outside the repository,
in ~/Downloads (as for backend/eval/decks.py). Text extraction is the same as
production (PyMuPDF page.get_text("text"), unified_orchestrator._extract_pages).
No model call. Run from the repository root:
  .venv/bin/python -I docs/thesis/experiments/deck-plan-threshold/threshold_sweep.py .
"""
import sys, pathlib
from collections import Counter
sys.path.insert(0, str(pathlib.Path(sys.argv[1])))
from backend.eval.decks import DECK_DIR, discover_decks, load_pdf_pages
from backend.services.parser.deck_plan import _lines, find_boilerplate, normalize_line

names = discover_decks()
decks = {n: load_pdf_pages(DECK_DIR / n) for n in names}
course = {n: "DBS" if " DBS " in n else "SR" for n in names}
print(f"decks: {len(decks)} ({sum(c == 'DBS' for c in course.values())} DBS, "
      f"{sum(c == 'SR' for c in course.values())} SR), pages: {sum(map(len, decks.values()))}")

# Share of pages each normalised line appears on (once per page), per deck.
shares = []
for n, pages in decks.items():
    c = Counter()
    for p in pages:
        c.update({normalize_line(l) for l in _lines(p)})
    shares += [(k / len(pages), course[n]) for line, k in c.items() if line]

print("\nlines by share of pages (all decks):")
for lo in range(20, 100, 10):
    hi = lo + 10
    n = sum(lo / 100 <= s < hi / 100 + (0.01 if hi == 100 else 0) for s, _ in shares)
    print(f"  {lo:>3}-{hi:<3} %: {n:>4}")

base = {n: find_boilerplate(p, 0.6) for n, p in decks.items()}
print("\nthreshold  boilerplate lines  decks whose boilerplate differs from 60 % (DBS, SR)")
for t in (0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0):
    sets = {n: find_boilerplate(p, t) for n, p in decks.items()}
    diff = [n for n in names if sets[n] != base[n]]
    print(f"  {int(t * 100):>3} %     {sum(map(len, sets.values())):>4}               {len(diff):>2} "
          f"({sum(course[n] == 'DBS' for n in diff)}, {sum(course[n] == 'SR' for n in diff)})")

print("\nboilerplate lines at 60 %, by course: total, and how many recur on >= 90 % of pages")
for c in ("DBS", "SR"):
    at = [s for s, k in shares if k == c and s >= 0.6]
    print(f"  {c}: {len(at)} lines, {sum(s >= 0.9 for s in at)} of them on >= 90 %")
