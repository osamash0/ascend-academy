"""results.json: what the scoreboard shows, recomputed from votes.jsonl (spec "Analysis").

A pure function of compare.json, votes.jsonl and the entrants' checks.csv. It carries no time
stamp, so recomputing it gives the same file, and it names the digest of the votes it was
computed from, so a stale copy is never shown.

A comparison that builds on finished ones (compare.create_pooled) is rated on one scale with them: the ranking,
its counts, H1 (over every challenger) and the win rates use their votes and its own, which are only read.
Its own vote count, self-consistency and decision time stay its own. It also reports H1 on round-1 votes alone,
as a sensitivity line beside the pooled verdict (round 2 depends on round 1: PROTOCOL.md §9).
A comparison that names its opponents (Deviation 3) asks the stopping rule only about the pairs it schedules (schedule.pair_allowed); its pooled block lists them.
"""
from __future__ import annotations

import hashlib
import json
import statistics
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from backend.eval.parser_bench import ranking, schedule, store
from backend.eval.parser_bench.compare import CompareRun, active_from_events

REFERENCE_BIASED = ("current", "pymupdf4llm")  # checks 6–7 use PyMuPDF's own text layer as the reference


def votes_digest(cmp: CompareRun) -> str:
    return cmp.read_log()[1]


def _outcome_label(vote: Mapping[str, Any]) -> str:
    """Who won a duel: the winning entrant, or "same" / "both_bad"."""
    return {"left": vote["left"], "right": vote["right"]}.get(vote["choice"], vote["choice"])


def self_consistency(meta: Mapping[str, Any], active: Mapping[int, Mapping[str, Any]]) -> dict[str, Any]:
    """Share of hidden repeats judged like their original; "Same" against a winner disagrees."""
    agree = total = 0
    for d in meta["schedule"]:
        original = d.get("repeat_of")
        if original is None or d["duel"] not in active or original not in active:
            continue
        total += 1
        agree += _outcome_label(active[d["duel"]]) == _outcome_label(active[original])
    return {"agree": agree, "total": total, "share": round(agree / total, 3) if total else None}


def _score(vote: Mapping[str, Any], side: str) -> float:
    other = "right" if side == "left" else "left"
    return {side: 1.0, other: 0.0}.get(vote["choice"], 0.5)


def win_rate_by_type(meta: Mapping[str, Any], votes: Sequence[Mapping[str, Any]]) -> dict[str, dict[str, dict[str, Any]]]:
    """Per entrant and page type: duels and score share (a win 1, a draw ½). Descriptive only. A pooled vote
    carries its own page type ("page_type"); the others take it from this comparison's schedule."""
    types = {d["duel"]: d["type"] for d in meta["schedule"]}
    tally: dict[str, dict[str, list[float]]] = {}
    for v in votes:
        page_type = v["page_type"] if "page_type" in v else types[v["duel"]]
        for side in ("left", "right"):
            cell = tally.setdefault(v[side], {}).setdefault(page_type, [0, 0.0])
            cell[0] += 1
            cell[1] += _score(v, side)
    return {tool: {t: {"duels": int(n), "score": round(s / n, 3)} for t, (n, s) in sorted(by_type.items())}
            for tool, by_type in sorted(tally.items())}


def tallies(entrants: Sequence[str], votes: Sequence[Mapping[str, Any]]) -> dict[str, dict[str, int]]:
    out = {e: {"duels": 0, "wins": 0, "losses": 0, "same": 0, "both_bad": 0} for e in entrants}
    for v in votes:
        for side in ("left", "right"):
            row = out[v[side]]
            row["duels"] += 1
            if v["choice"] in ("same", "both_bad"):
                row[v["choice"]] += 1
            elif v["choice"] == side:
                row["wins"] += 1
            else:
                row["losses"] += 1
    return out


def _mean(values: Iterable[Any]) -> float | None:
    kept = [v for v in values if v is not None]
    return round(sum(kept) / len(kept), 3) if kept else None


def _share(values: Iterable[Any]) -> float | None:
    kept = [v for v in values if v is not None]
    return round(sum(bool(v) for v in kept) / len(kept), 3) if kept else None


def check_table(meta: Mapping[str, Any], root: Path | None = None) -> dict[str, dict[str, Any]]:
    """Every automatic check per entrant over the comparison's pages, with its cost."""
    wanted = {(p["sha256"], int(p["page"])) for p in meta["pages"]}
    table = {}
    for tool, runs in sorted(meta["entrants"].items()):
        rows: list[dict[str, Any]] = []
        seconds, peaks = [], []
        for sha, run_id in sorted(runs.items()):
            run = store.ExtractRun(store.find_run(run_id, root))
            rows += [r for r in run.typed_checks() if (sha, r["page"]) in wanted]
            run_meta = run.meta
            if run_meta.get("seconds_per_page") is not None:
                seconds.append(run_meta["seconds_per_page"])
            if run_meta.get("peak_memory_mb") is not None:
                peaks.append(run_meta["peak_memory_mb"])

        def total(field: str) -> int:
            return sum(r.get(field) or 0 for r in rows)

        table[tool] = {
            "pages": len(rows),
            "footer_leaks": total("footer_leaks"),
            "pages_with_footer_leak": sum(bool(r.get("footer_leaked")) for r in rows),
            "footer_token_share": _mean(r.get("footer_token_share") for r in rows),
            "title_first": _share(r.get("title_first") for r in rows),
            "wrong_symbols": total("wrong_symbols"),
            "lonely_bullets": total("lonely_bullets"),
            "broken_line_pct": _mean(r.get("broken_line_pct") for r in rows),
            "dropped_words_pct": _mean(r.get("dropped_words_pct") for r in rows),
            "invented_words_pct": _mean(r.get("invented_words_pct") for r in rows),
            "headings": total("headings"),
            "list_items": total("list_items"),
            "tables": total("tables"),
            "math_spans": total("math_spans"),
            # An unweighted mean over the PDFs: each PDF's run counts once, however many pages it has.
            "seconds_per_page": _mean(seconds),
            "peak_memory_mb": max(peaks) if peaks else None,
            "reference_biased": tool in REFERENCE_BIASED,
        }
    return table


def _tag_all(votes: Sequence[Mapping[str, Any]], meta: Mapping[str, Any], cid: str) -> list[dict[str, Any]]:
    """Votes with their page type, round and comparison, so votes of several comparisons can be pooled.
    (A vote line's own "type" is "vote", so the page type cannot use that key.)"""
    by_duel = {d["duel"]: d for d in meta["schedule"]}
    return [dict(v, page_type=by_duel[v["duel"]]["type"], round=by_duel[v["duel"]]["round"], comparison=cid)
            for v in votes]


def _pooled(meta: Mapping[str, Any], root: Path | None) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    """The counted votes of the comparisons this one builds on (each log read once, never written), and what
    was read from each: {cmp_id: {"status", "votes", "votes_digest", "unlocked_early"}}."""
    votes: list[dict[str, Any]] = []
    sources: dict[str, dict[str, Any]] = {}
    for cid in meta.get("builds_on") or []:
        base = CompareRun.open(cid, root)
        base_meta = base.meta
        events, digest = base.read_log()
        active = active_from_events(events)
        votes += _tag_all([active[k] for k in sorted(active)], base_meta, cid)
        sources[cid] = {"status": base_meta["status"], "votes": len(active), "votes_digest": digest,
                        "unlocked_early": bool(base_meta.get("unlocked_early"))}
    return votes, sources


def _round1_h1(votes: Sequence[Mapping[str, Any]], entrants: Sequence[str], anchor: str, resamples: int,
               seed: int) -> dict[str, Any]:
    """H1 on round-1 votes alone (hidden repeats included): a sensitivity line beside the verdict on every vote.
    Descriptive: round 2 depends on round 1, so this is not a second test. The votes must be tagged with their
    round (_tag_all): raw vote lines carry none, and untagged votes would silently read as "no challenger"."""
    if any("round" not in v for v in votes):
        raise ValueError("round-1 sensitivity needs votes tagged with their round")
    first = [v for v in votes if v["round"] == 1]
    verdict = ranking.analyse([ranking.outcome(v["left"], v["right"], v["choice"]) for v in first], entrants, anchor,
                              resamples=resamples, seed=seed)
    return {"votes": len(first), "h1_above": verdict["h1_above"], "h1_k": verdict["h1_k"],
            "h1_lower": {r["entrant"]: r["h1_lower"] for r in verdict["rows"] if r["h1_lower"] is not None}}


def _summarize(cmp: CompareRun, *, resamples: int = ranking.RESAMPLES,
               root: Path | None = None) -> tuple[dict[str, Any], dict[str, dict[str, float]]]:
    """results.json's content, and each entrant's unrounded points and interval for the stopping rule."""
    meta = cmp.meta
    events, digest = cmp.read_log()  # one read: the votes, the retractions and the digest come from the same bytes
    active = active_from_events(events)
    votes = [active[k] for k in sorted(active)]
    entrants = sorted(meta["entrants"])
    anchor = meta["anchor"]
    pooled = bool(meta.get("builds_on"))
    if pooled:
        earlier, sources = _pooled(meta, root)
        rated = earlier + _tag_all(votes, meta, cmp.run_id)
    else:
        rated = votes
    verdict = ranking.analyse([ranking.outcome(v["left"], v["right"], v["choice"]) for v in rated], entrants,
                              anchor, resamples=resamples, seed=meta["seed"])
    rows = verdict["rows"]
    counts = tallies(entrants, rated)
    # The H1 verdict and the challengers above the anchor both come from analyse(), decided on the
    # unrounded bootstrap points; h1 is bool(h1_above).
    above = verdict["h1_above"]
    data = {
        "run_id": meta["run_id"],
        "status": meta["status"],
        "votes_digest": digest,
        "votes": len(votes),
        "retracted": sum(e["type"] == "retract" for e in events),
        "scheduled": len(meta["schedule"]),
        "rounds": meta["rounds"],
        "round2_duels": meta["round2_duels"],
        "anchor": anchor,
        "bootstrap": {"resamples": resamples, "seed": meta["seed"]},
        "ranking": [dict(r, **counts[r["entrant"]]) for r in rows],
        "h1": {"holds": verdict["h1"], "above_anchor": above},
        "h1_k": verdict["h1_k"],
        "self_consistency": self_consistency(meta, active),
        "win_rate_by_type": win_rate_by_type(meta, rated),
        "median_seconds": round(statistics.median(v["seconds"] for v in votes), 1) if votes else None,
        "checks": check_table(meta, root),
    }
    if pooled:
        data["pooled"] = {
            "builds_on": list(meta["builds_on"]),
            "new_entrants": list(meta.get("new_entrants") or []),
            **({"opponents": list(meta["opponents"])} if meta.get("opponents") is not None else {}),
            "votes": len(rated),
            "sources": sources,
            "note": ("ranking, its counts, H1 and win rates use the pooled votes; votes, self-consistency and "
                     "median_seconds are this comparison's own"),
        }
        data["sensitivity"] = {"round1_only": _round1_h1(rated, entrants, anchor, resamples, meta["seed"])}
    return data, verdict["raw"]


def summarize(cmp: CompareRun, *, resamples: int = ranking.RESAMPLES, root: Path | None = None) -> dict[str, Any]:
    return _summarize(cmp, resamples=resamples, root=root)[0]


def _decision_rows(raw: Mapping[str, Mapping[str, float]]) -> list[dict[str, Any]]:
    """The stopping rule's ranking: unrounded points and intervals, best first (ties by name)."""
    return sorted(({"entrant": e, **v} for e, v in raw.items()), key=lambda r: (-r["points"], r["entrant"]))


def write_results(cmp: CompareRun, *, resamples: int = ranking.RESAMPLES, root: Path | None = None) -> dict[str, Any]:
    data = summarize(cmp, resamples=resamples, root=root)
    store._write_json(cmp.path / "results.json", data)
    return data


def _key(digest: Any, status: Any, resamples: Any, seed: Any, scheduled: Any, rounds: Any, round2_duels: Any,
         sources: Any) -> tuple:
    return (digest, status, resamples, seed, scheduled, rounds, round2_duels, sources)


def _stored_key(data: Mapping[str, Any]) -> tuple:
    bootstrap = data.get("bootstrap") or {}
    return _key(data.get("votes_digest"), data.get("status"), bootstrap.get("resamples"), bootstrap.get("seed"),
                data.get("scheduled"), data.get("rounds"), data.get("round2_duels"),
                (data.get("pooled") or {}).get("sources"))


def _current_key(cmp: CompareRun, resamples: int, root: Path | None) -> tuple:
    """What results.json must match to be reused: the votes (digest), the status, the bootstrap, the schedule's
    length, rounds and round-2 count (a round-2 extension changes the last three without changing the digest),
    and, for a pooled comparison, what was read from the earlier ones. A comparison that builds on none has
    None there, as its stored results.json does."""
    meta = cmp.meta
    sources = _pooled(meta, root)[1] if meta.get("builds_on") else None
    return _key(cmp.read_log()[1], meta["status"], resamples, meta["seed"], len(meta["schedule"]),
                meta["rounds"], meta["round2_duels"], sources)


def current_results(cmp: CompareRun, *, resamples: int = ranking.RESAMPLES, root: Path | None = None) -> dict[str, Any]:
    """results.json if its freshness key matches the comparison as it is now; otherwise recomputed and rewritten."""
    path = cmp.path / "results.json"
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        if _stored_key(data) == _current_key(cmp, resamples, root):
            return data
    return write_results(cmp, resamples=resamples, root=root)


def advance(cmp: CompareRun, *, resamples: int = ranking.RESAMPLES, root: Path | None = None) -> dict[str, Any]:
    """After a vote. When every scheduled duel has a vote, apply the stopping rule: add the next
    round-2 batch while the top two overlap and the 75-duel cap has room, or else finish.

    The decision is made on one snapshot of the log. Before it extends or finishes, the guard re-checks
    under the vote lock that the log has the same digest, every duel still has a vote and the schedule
    has the same length. An undo or a concurrent extension in between leaves the comparison judging."""
    meta = cmp.meta
    if meta["status"] != "judging":
        return {"added": 0, "finished": True}
    done, total = cmp.progress()  # the cheap exit comes first: a partial round never pays for the bootstrap
    if done < total:
        return {"added": 0, "finished": False}
    data, raw = _summarize(cmp, resamples=resamples, root=root)
    decision = _decision_rows(raw)
    if data["votes"] < data["scheduled"]:  # the round was incomplete in the snapshot itself
        return {"added": 0, "finished": False}
    digest, scheduled = data["votes_digest"], data["scheduled"]

    def still_the_snapshot() -> bool:
        current = cmp.meta
        done, total = cmp.progress()
        return (current["status"] == "judging" and done == total == scheduled
                and len(current["schedule"]) == scheduled and cmp.read_log()[1] == digest)

    room = schedule.ROUND2_CAP - meta["round2_duels"]
    new = meta.get("new_entrants") or None  # an added comparison: round 2 only for its new methods' pairs
    rivals = meta.get("opponents")  # and only against its chosen opponents, when it names them (deviation 3)
    if room > 0 and schedule.needs_round2(decision, new=new, opponents=rivals):
        pages = [schedule.SchedPage(p["key"], p["type"]) for p in meta["pages"]]
        batch = schedule.round2_batch([r["entrant"] for r in decision], pages, meta["schedule"],
                                      meta["seed"], meta["rounds"], room, only_with=new, opponents=rivals)
        if batch:
            if cmp.extend_if(still_the_snapshot, batch):
                return {"added": len(batch), "finished": False}
            return {"added": 0, "finished": False}
    if not cmp.finish_if(still_the_snapshot):
        return {"added": 0, "finished": False}
    write_results(cmp, resamples=resamples, root=root)
    return {"added": 0, "finished": True}
