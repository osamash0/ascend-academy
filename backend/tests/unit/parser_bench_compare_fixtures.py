"""A small comparison on disk: three entrants' finished benchmark runs of the synthetic deck, and
a comparison over its six pages. Not a test module (no test_ prefix)."""
from pathlib import Path

import fitz

from backend.eval.parser_bench import checks, compare, pageset, schedule, sources, store
from backend.tests.unit.parser_bench_fixtures import make_deck

TYPES = ("layout", "lists", "table_formula", "diagram", "dense_text")
ENTRANTS = ("current", "alphatool", "betatool")
SESSION = "s-0123456789abcdef"


def make_extract_run(root: Path, tool: str, deck: Path, pages=range(1, 7), *, purpose="benchmark", commit="abc123",
                     tree=None, finish_extra=None):
    """A finished run: `current` holds the raw text layer (footer included), the others clean Markdown.
    `tree` is recorded as the run's bench_tree when given; `finish_extra` adds fields to the sealed record."""
    facts = checks.document_facts(deck)
    sha = sources.sha256_file(deck)
    extra = {"protocol_commit": commit, **({"bench_tree": tree} if tree else {})}
    run = store.ExtractRun.create(
        tool=tool, version="1.0", purpose=purpose, root=root,
        source={"path": str(deck), "name": deck.name, "sha256": sha, "pages_total": 6},
        extra=extra, checks_version=checks.CHECKS_VERSION, git={"commit": "c0ffee", "dirty": False},
    )
    rows = []
    with fitz.open(deck) as doc:
        for page in pages:
            text = doc[page - 1].get_text("text") if tool == "current" else f"# {tool} heading {page}\n\nbody of page {page}\n"
            run.write_page(page, text)
            rows.append(checks.check_page(text, facts.pages[page], facts))
    run.write_checks(rows)
    run.finish("finished", pages_scored=list(pages), seconds_per_page=0.01, peak_memory_mb=None, environment=["x"],
               **(finish_extra or {}))
    return run


def page_entries(deck: Path) -> list[dict]:
    sha = sources.sha256_file(deck)
    return [{"key": f"d-p{n}", "source": "swt", "file": deck.name, "sha256": sha, "page": n,
             "type": TYPES[(n - 1) % len(TYPES)], "how": "chosen"} for n in range(1, 7)]


def make_comparison(root: Path, tmp: Path, *, entrants=ENTRANTS, seed=1) -> compare.CompareRun:
    deck = make_deck(tmp / "deck.pdf")
    sha = sources.sha256_file(deck)
    runs = {tool: {sha: make_extract_run(root, tool, deck).run_id} for tool in entrants}
    pages = page_entries(deck)
    duels = schedule.round1(list(entrants), [schedule.SchedPage(p["key"], p["type"]) for p in pages], seed)
    return compare.CompareRun.create(entrants=runs, pages=pages, seed=seed, duels=duels, protocol_commit="abc123", root=root)


def prefer(tool: str):
    """A judge who always picks `tool` and calls every other duel the same."""
    def choose(duel: dict) -> str:
        return "left" if duel["left"] == tool else "right" if duel["right"] == tool else "same"
    return choose


def vote_all(cmp: compare.CompareRun, choose=prefer("alphatool"), session: str = SESSION) -> None:
    while (duel := cmp.next_duel()) is not None:
        cmp.vote(duel=duel["duel"], choice=choose(duel), seconds=3.0, session=session)


def bench_pages_of(cmp: compare.CompareRun) -> list[pageset.BenchPage]:
    """A comparison's pages as page-set entries, so a test can make them the page set."""
    return [pageset.BenchPage(p["key"], p["source"], p["file"], p["sha256"], int(p["page"]), p["type"], p["how"], "r")
            for p in cmp.meta["pages"]]


def make_pooled(root: Path, tmp: Path, base: compare.CompareRun, new=("gammatool", "deltatool"), *, seed=5,
                commit="abc123", opponents=None) -> compare.CompareRun:
    """A comparison that adds `new` to the finished `base`, on its deck and pages; `opponents` restricts whom the
    new methods meet."""
    for tool in new:
        make_extract_run(root, tool, tmp / "deck.pdf", commit=commit)
    return compare.create_pooled(list(new), against=[base.run_id], seed=seed, commit=commit, tree=None,
                                 pages=bench_pages_of(base), opponents=opponents, root=root)
