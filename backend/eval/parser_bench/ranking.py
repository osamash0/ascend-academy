"""Bradley–Terry ratings from duel votes (spec "Analysis").

The model: entrant i beats j with probability p_i / (p_i + p_j). It is fitted with the MM
algorithm (Hunter 2004, "MM algorithms for generalized Bradley–Terry models"). "Same" and
"Both unusable" count as half a win for each side.

A weak prior keeps every strength finite: each entrant also plays one virtual drawn game, spread
evenly over its opponents (1/(n−1) of a draw against each). Without it an entrant that wins
nothing (likely in a bootstrap resample of a small comparison) would get strength 0 and minus
infinite points. The prior moves a rating by a few to about ten points, more where a tool almost
never wins; the protocol says so. In a 150-duel comparison of 4–5 tools each entrant plays about
60 to 75 real duels, so the prior is a small correction. The prior links every pair, so strengths
are normalised to a geometric mean of 1 after each step, which keeps MM fast.

Ratings are points, 1000 + 400·log10(p / p_anchor), so the anchor (`current`) is 1000. Intervals
come from resampling the votes 1,000 times; the 2.5th and 97.5th percentiles bound each 95%
interval, and those intervals are what is displayed. The anchor's interval is exactly 1000–1000:
every other interval is relative to it.

H1 is decided with a Bonferroni correction over the k challengers (the non-anchor entrants): a
challenger counts as above `current` when the (2.5/k)th percentile of its unrounded bootstrap
points is above 1000. That keeps the chance of a false H1 near 2.5% when all tools are equal.

Pure Python: the fits are small (at most a dozen entrants).
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass
from typing import Sequence

RESAMPLES = 1000
PRIOR_GAMES = 1.0
TOLERANCE = 1e-6  # in log-strength; a tenth of a point is about 6e-4
MAX_ITERATIONS = 10_000
CHOICES = ("left", "right", "same", "both_bad")


@dataclass(frozen=True)
class Outcome:
    a: str
    b: str
    score_a: float  # 1.0 a won, 0.0 b won, 0.5 a draw ("same" or "both unusable")


def outcome(left: str, right: str, choice: str) -> Outcome:
    if choice not in CHOICES:
        raise ValueError(f"choice must be one of {CHOICES}, not {choice!r}")
    if left == right:
        raise ValueError(f"self-duel: {left!r} cannot be paired with itself")
    return Outcome(left, right, {"left": 1.0, "right": 0.0}.get(choice, 0.5))


def fit(outcomes: Sequence[Outcome], entrants: Sequence[str]) -> dict[str, float]:
    """Strengths by MM: p_i = W_i / Σ_j n_ij / (p_i + p_j), with the prior's draws in W and n."""
    n = len(entrants)
    if n < 2:
        raise ValueError("a ranking needs at least two entrants")
    index = {e: i for i, e in enumerate(entrants)}
    if len(index) != n:
        raise ValueError(f"duplicate entrants in {list(entrants)}")
    share = PRIOR_GAMES / (n - 1)
    wins = [PRIOR_GAMES / 2] * n
    games = [[0.0 if i == j else share for j in range(n)] for i in range(n)]
    for o in outcomes:
        for name in (o.a, o.b):
            if name not in index:
                raise ValueError(f"unknown entrant {name!r} in a vote")
        if o.a == o.b:
            raise ValueError(f"self-duel: {o.a!r} cannot be paired with itself")
        i, j = index[o.a], index[o.b]
        wins[i] += o.score_a
        wins[j] += 1.0 - o.score_a
        games[i][j] += 1.0
        games[j][i] += 1.0
    others = [[j for j in range(n) if j != i] for i in range(n)]
    p = [1.0] * n
    converged = False
    for _ in range(MAX_ITERATIONS):
        new = [wins[i] / sum(games[i][j] / (p[i] + p[j]) for j in others[i]) for i in range(n)]
        mean = math.exp(sum(math.log(x) for x in new) / n)
        new = [x / mean for x in new]
        change = max(abs(math.log(a / b)) for a, b in zip(new, p))
        p = new
        if change < TOLERANCE:
            converged = True
            break
    if not converged:
        raise RuntimeError("Bradley–Terry did not converge")
    return dict(zip(entrants, p))


def points(strengths: dict[str, float], anchor: str) -> dict[str, float]:
    base = strengths[anchor]
    return {e: 1000.0 + 400.0 * math.log10(s / base) for e, s in strengths.items()}


def percentile(values: Sequence[float], q: float) -> float:
    """Linear interpolation between the closest ranks (numpy's default)."""
    ordered = sorted(values)
    k = (len(ordered) - 1) * q
    lo, hi = math.floor(k), math.ceil(k)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


def _draws(outcomes: Sequence[Outcome], entrants: Sequence[str], anchor: str,
           resamples: int, seed: int) -> dict[str, list[float]]:
    """Unrounded points of every entrant in each resample of the votes (with replacement)."""
    rng = random.Random(seed)
    draws: dict[str, list[float]] = {e: [] for e in entrants}
    n = len(outcomes)
    for _ in range(resamples):
        sample = [outcomes[rng.randrange(n)] for _ in range(n)]
        for e, value in points(fit(sample, entrants), anchor).items():
            draws[e].append(value)
    return draws


def bootstrap(outcomes: Sequence[Outcome], entrants: Sequence[str], anchor: str, *,
              resamples: int = RESAMPLES, seed: int = 0) -> dict[str, tuple[float, float]]:
    """Each entrant's 95% interval of points from `resamples` resamples of the votes (with replacement)."""
    draws = _draws(outcomes, entrants, anchor, resamples, seed)
    return {e: (percentile(v, 0.025), percentile(v, 0.975)) for e, v in draws.items()}


def analyse(outcomes: Sequence[Outcome], entrants: Sequence[str], anchor: str, *,
            resamples: int = RESAMPLES, seed: int = 0) -> dict:
    """Rows as `rate` returns them, plus the H1 verdict:
    {"rows": [...], "h1": bool, "h1_above": [...], "h1_k": k}, with k the number of challengers
    (non-anchor entrants).

    Each row is {"entrant", "points", "lo", "hi", "h1_lower"}. `lo`/`hi` are the displayed 95%
    interval. `h1_lower` is the (2.5/k)th percentile of the unrounded bootstrap points, rounded
    for display, and None for the anchor. `h1_above` is the sorted list of challengers whose
    unrounded h1_lower is above 1000 (Bonferroni over the k challengers), and `h1` is
    `bool(h1_above)`. "raw" holds each entrant's unrounded points and interval; the stopping rule
    reads it, results.json does not.
    """
    if anchor not in entrants:
        raise ValueError(f"the anchor {anchor!r} is not an entrant")
    k = len(entrants) - 1
    if not outcomes:
        return {"rows": [], "h1": False, "h1_above": [], "h1_k": k, "raw": {}}
    estimate = points(fit(outcomes, entrants), anchor)
    draws = _draws(outcomes, entrants, anchor, resamples, seed)
    h1_lower = {e: percentile(v, 0.025 / k) for e, v in draws.items() if e != anchor}
    raw = {e: {"points": estimate[e], "lo": percentile(draws[e], 0.025), "hi": percentile(draws[e], 0.975)}
           for e in entrants}
    rows = []
    for e in entrants:
        rows.append({
            "entrant": e,
            "points": round(estimate[e], 1),
            "lo": round(raw[e]["lo"], 1),
            "hi": round(raw[e]["hi"], 1),
            "h1_lower": None if e == anchor else round(h1_lower[e], 1),
        })
    h1_above = sorted(e for e, v in h1_lower.items() if v > 1000.0)
    rows.sort(key=lambda r: (-r["points"], r["entrant"]))
    return {"rows": rows, "h1": bool(h1_above), "h1_above": h1_above, "h1_k": k, "raw": raw}


def rate(outcomes: Sequence[Outcome], entrants: Sequence[str], anchor: str, *,
         resamples: int = RESAMPLES, seed: int = 0) -> list[dict[str, float | str | None]]:
    """Points with 95% intervals, best first: [{"entrant", "points", "lo", "hi", "h1_lower"}].
    See `analyse` for the H1 verdict; `rate` returns only the rows."""
    return analyse(outcomes, entrants, anchor, resamples=resamples, seed=seed)["rows"]
