"""Seed sweep of the study with scripted readers (thesis chapter 5); see PROTOCOL.md.

Runs `backend/eval/persona_study.py` at a342dea9 over 100 seed bases without changing
it, and counts in how many seeds each of the 23 pre-registered expectations holds.
It uses the study's own `build`, `summarise` and `check`; it adds only the loop over
seeds and the counting. Run it from a `git archive` of a342dea9 as PROTOCOL.md says.
It writes `sweep.json` (every seed, every arm) and `RESULTS.md` (the counts).
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import platform
import statistics
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import backend.eval.persona_study as ps

BASE = 20261109      # the published run's seed
STEP = 100           # base_j = BASE + STEP * j; arm k runs with base_j + k, as ps.main() does
PUBLISHED_MET = 18   # pre-registered expectations met in the published run


def run_base(base: int, prompts: list[str]) -> list[dict[str, Any]]:
    rows = []
    for k, arm in enumerate(ps.ARMS):
        data = ps.build(arm, base + k)
        before = len(prompts)
        body = asyncio.run(ps.service.landing_from(data, "en"))
        summary = ps.summarise(arm, body, before, len(prompts))
        summary["checks"] = ps.check(summary)
        rows.append(summary)
    return rows


def rule_of(kind: str, arm: str) -> str:
    rule = ps.EXPECTATIONS[kind]
    return "must" if arm in rule["must"] else "must not"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", required=True)
    ap.add_argument("--n", type=int, default=100)
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    prompts = ps.stub_model_and_cache()
    pre_arms = [a.name for a in ps.ARMS if not a.post_hoc]
    post_arms = [a.name for a in ps.ARMS if a.post_hoc]

    runs: list[dict[str, Any]] = []
    held: Counter[tuple[str, str]] = Counter()          # (kind, arm) -> seeds in which it held
    post_held: Counter[tuple[str, str]] = Counter()
    totals: list[int] = []
    kinds_seen: dict[str, Counter[str]] = defaultdict(Counter)
    page10: dict[str, Counter[str]] = defaultdict(Counter)
    numbers: Counter[str] = Counter()                   # arm -> seeds with a value in the weekly numbers
    themes_made: Counter[str] = Counter()
    reach_few: Counter[str] = Counter()

    for j in range(args.n):
        base = BASE + STEP * j
        rows = run_base(base, prompts)
        met = 0
        n_pre = 0
        for r in rows:
            arm = r["arm"]
            for kind in r["kinds"]:
                kinds_seen[arm][kind] += 1
            on10 = sorted({f["kind"] for f in r["findings"] if 10 in f["pages"]})
            page10[arm]["+".join(on10) or "(none)"] += 1
            if r["figures"]["landing"] is not None or r["figures"]["cleared"] is not None:
                numbers[arm] += 1
            if r["themes"]:
                themes_made[arm] += 1
            if r["reach"] == "few":
                reach_few[arm] += 1
            for kind, verdict in r["checks"].items():
                ok = verdict == "ok"
                if arm in pre_arms:
                    n_pre += 1
                    held[(kind, arm)] += ok
                    met += ok
                else:
                    post_held[(kind, arm)] += ok
        assert n_pre == 23, f"seed base {base}: {n_pre} pre-registered checks, expected 23"
        totals.append(met)
        runs.append({"j": j, "base": base, "met": met, "arms": [
            {"arm": r["arm"], "kinds": r["kinds"], "findings": r["findings"], "reach": r["reach"],
             "figures": r["figures"], "themes": len(r["themes"]), "checks": r["checks"]}
            for r in rows]})

    reproduced = totals[0] == PUBLISHED_MET
    src = Path(ps.__file__).read_bytes()
    meta = {
        "script": "backend/eval/persona_study.py at a342dea9",
        "script_sha256": hashlib.sha256(src).hexdigest(),
        "python": platform.python_version(),
        "seeds": {"bases": args.n, "base_0": BASE, "step": STEP},
        "published_run_reproduced": reproduced,
    }
    (out / "sweep.json").write_text(json.dumps({"meta": meta, "runs": runs}, indent=1) + "\n")

    n = args.n
    lines = [
        "# Seed sweep of the study with scripted readers: results",
        "",
        f"*Machine-written by `seed_sweep.py`; protocol in `PROTOCOL.md`. {n} seed bases, "
        f"10 arms each, script sha256 `{meta['script_sha256'][:12]}`, Python {meta['python']}.*",
        "",
        f"Seed base j = 0 reproduces the published run ({totals[0]} of 23 met): **{'yes' if reproduced else 'NO'}**.",
        "",
        "## The 23 pre-registered expectations: seeds in which each held",
        "",
        "| Expectation | Arm | Rule | Held in |",
        "|---|---|---|---|",
    ]
    for kind in ps.EXPECTATIONS:
        for arm in pre_arms:
            if (kind, arm) in held or arm in ps.EXPECTATIONS[kind]["must"] + ps.EXPECTATIONS[kind]["must_not"]:
                lines.append(f"| {kind} | {arm} | {rule_of(kind, arm)} | {held[(kind, arm)]} of {n} |")
    dist = Counter(totals)
    lines += [
        "",
        "## Expectations met per seed (of 23)",
        "",
        f"Minimum {min(totals)}, median {statistics.median(totals)}, maximum {max(totals)}. "
        "The engine that reports nothing meets 16 of 23 at every seed (`../mute_engine.out.txt`).",
        "",
        "| Met | Seeds |",
        "|---|---|",
    ]
    lines += [f"| {k} | {dist[k]} |" for k in sorted(dist)]
    lines += [
        "",
        "## What each arm showed",
        "",
        "| Arm | Finding kinds (seeds in which each appeared) | Page 10 (seeds) | Weekly numbers had a value | Themes made | Reach `few` |",
        "|---|---|---|---|---|---|",
    ]
    for a in ps.ARMS:
        ks = ", ".join(f"{k} {c}" for k, c in sorted(kinds_seen[a.name].items())) or "none"
        p10 = ", ".join(f"{k} {c}" for k, c in sorted(page10[a.name].items()))
        lines.append(f"| {a.name}{' (post hoc)' if a.post_hoc else ''} | {ks} | {p10} | "
                     f"{numbers[a.name]} | {themes_made[a.name]} | {reach_few[a.name]} |")
    lines += [
        "",
        "## Post-hoc expectations (arms I and J; they do not count)",
        "",
        "| Expectation | Arm | Held in |",
        "|---|---|---|",
    ]
    lines += [f"| {kind} | {arm} | {c} of {n} |" for (kind, arm), c in sorted(post_held.items())]
    (out / "RESULTS.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    return 0 if reproduced else 1


if __name__ == "__main__":
    raise SystemExit(main())
