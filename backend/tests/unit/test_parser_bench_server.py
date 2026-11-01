import json
import time

import pytest
from fastapi.testclient import TestClient

from backend.eval.parser_bench import blinding, files, pageset, paid, server, store, tools
from backend.eval.parser_bench.jobs import JobQueue
from backend.tests.unit.parser_bench_compare_fixtures import SESSION, bench_pages_of, make_comparison, make_extract_run, prefer, vote_all
from backend.tests.unit.parser_bench_fixtures import make_deck

WRITE = {"X-Parser-Bench": "1"}


def client_for(root, **kw):
    app = server.create_app(root=root, jobs=JobQueue(root, poll=0.05), resamples=40, **kw)
    return TestClient(app, base_url="http://127.0.0.1")


@pytest.fixture
def root(tmp_path):
    return tmp_path / "data"


@pytest.fixture
def client(root, tmp_path):
    return client_for(root, dist=tmp_path / "no-dist")


def test_a_foreign_host_is_refused(root, tmp_path):
    app = server.create_app(root=root, jobs=JobQueue(root), dist=tmp_path / "no-dist")
    assert TestClient(app, base_url="http://evil.example").get("/api/runs").status_code == 400


def test_a_change_without_the_header_is_refused(client):
    assert client.post("/api/jobs", json={"sha256": "0" * 64, "tools": ["current"]}).status_code == 403


def test_the_run_list_keeps_missing_measures_null_and_reads_old_records(client, root, tmp_path):
    run = make_extract_run(root, "current", make_deck(tmp_path / "deck.pdf"), purpose="explore")
    old = root / "runs" / "extract" / "2026-10-29_old-1_0000"
    old.mkdir(parents=True)
    (old / "run.json").write_text(json.dumps({"run_id": old.name, "kind": "extract", "tool": "current", "status": "finished",
                                              "source": {"name": "x.pdf", "sha256": "b" * 64}, "started_at": "2026-10-29T00:00:00+00:00"}))
    rows = {r["run_id"]: r for r in client.get("/api/runs").json()["runs"]}
    assert rows[run.run_id]["peak_memory_mb"] is None and rows[run.run_id]["checks_version"] == 3
    assert (rows[old.name]["record_version"], rows[old.name]["checks_version"]) == (0, 1)


def test_an_explore_page_shows_its_output_checks_and_footer_lines(client, root, tmp_path):
    run = make_extract_run(root, "current", make_deck(tmp_path / "deck.pdf"), purpose="explore")
    body = client.get(f"/api/runs/{run.run_id}/pages/3").json()
    assert body["checks"]["footer_leaks"] == 3 and len(body["footer_lines"]) == 3
    detail = client.get(f"/api/runs/{run.run_id}").json()
    assert [p["locked"] for p in detail["page_list"]] == [False] * 6 and len(detail["checks"]) == 6
    assert client.get(f"/api/runs/{run.run_id}/pages/9").status_code == 404


def test_benchmark_pages_are_locked_everywhere_while_judging(client, root, tmp_path):
    cmp = make_comparison(root, tmp_path)
    run_id = cmp.meta["entrants"]["alphatool"][cmp.meta["pages"][0]["sha256"]]
    sha = cmp.meta["pages"][0]["sha256"]
    assert client.get(f"/api/runs/{run_id}/pages/1").status_code == 423
    assert client.get(f"/api/outputs/{sha}/1").status_code == 423
    assert client.get(f"/api/runs/{run_id}").json()["checks"] == []
    assert client.get(f"/api/comparisons/{cmp.run_id}/results").status_code == 423
    assert client.get(f"/api/comparisons/{cmp.run_id}/votes").status_code == 423
    assert client.get("/api/runs").status_code == 200  # the run list itself stays visible


def test_a_duel_never_names_a_tool_or_a_run(client, root, tmp_path):
    cmp = make_comparison(root, tmp_path)
    body = client.get(f"/api/comparisons/{cmp.run_id}/next").json()
    assert body["duel"] == 0 and body["total"] == 10 and body["page"]["png"].endswith(".png")
    assert set(body["left"]) == set(body["right"]) == {"markdown"}  # the output only (its text is the tool's own)
    rest = json.dumps({k: v for k, v in body.items() if k not in ("left", "right")})
    run_ids = [r for runs in cmp.meta["entrants"].values() for r in runs.values()]
    for secret in ("alphatool", "betatool", "current", "run_id", *run_ids):
        assert secret not in rest


def judge_everything(client, cmp, choose=prefer("alphatool")):
    while True:
        body = client.get(f"/api/comparisons/{cmp.run_id}/next").json()
        if "duel" not in body:
            return body
        duel = cmp.meta["schedule"][body["duel"]]
        r = client.post(f"/api/comparisons/{cmp.run_id}/votes", headers=WRITE,
                        json={"duel": body["duel"], "choice": choose(duel), "seconds": 2.5, "session": SESSION})
        assert r.status_code == 200, r.text


def test_the_judge_is_not_told_about_rounds_while_judging(client, root, tmp_path):
    cmp = make_comparison(root, tmp_path)
    body = client.get(f"/api/comparisons/{cmp.run_id}/next").json()
    assert "round" not in body
    r = client.post(f"/api/comparisons/{cmp.run_id}/votes", headers=WRITE,
                    json={"duel": body["duel"], "choice": "same", "seconds": 1, "session": SESSION}).json()
    assert set(r) == {"vote_id", "done", "total", "finished"}
    [summary] = client.get("/api/comparisons").json()["comparisons"]
    assert summary["rounds"] is None


def test_judging_to_the_end_opens_results_and_my_votes(client, root, tmp_path):
    cmp = make_comparison(root, tmp_path)
    r = client.post(f"/api/comparisons/{cmp.run_id}/votes", headers=WRITE,
                    json={"duel": 3, "choice": "left", "seconds": 1, "session": SESSION})
    assert r.status_code == 400 and "next duel" in r.json()["detail"]
    client.post(f"/api/comparisons/{cmp.run_id}/votes", headers=WRITE, json={"duel": 0, "choice": "left", "seconds": 1, "session": SESSION})
    assert client.post(f"/api/comparisons/{cmp.run_id}/undo", headers=WRITE, json={"session": SESSION}).json() == {"retracted": 0}
    assert judge_everything(client, cmp)["finished"] is True
    res = client.get(f"/api/comparisons/{cmp.run_id}/results").json()
    assert res["ranking"][0]["entrant"] == "alphatool" and res["votes"] == 10
    votes = client.get(f"/api/comparisons/{cmp.run_id}/votes").json()["votes"]
    assert len(votes) == 11 and sum(v["withdrawn"] for v in votes) == 1 and votes[0]["type"]
    sha = cmp.meta["pages"][0]["sha256"]
    assert client.get(f"/api/outputs/{sha}/1").status_code == 200


def test_unlocking_early_needs_a_reason_and_opens_results(client, root, tmp_path, monkeypatch):
    log = tmp_path / "LAB_LOG.md"
    log.write_text("# log\n")
    monkeypatch.setattr(server.api_compare.blinding, "LAB_LOG", log)
    cmp = make_comparison(root, tmp_path)
    assert client.post(f"/api/comparisons/{cmp.run_id}/unlock", headers=WRITE, json={"reason": " "}).status_code == 400
    assert client.post(f"/api/comparisons/{cmp.run_id}/unlock", headers=WRITE, json={"reason": "renderer check"}).json()["locked"] is False
    assert client.get(f"/api/comparisons/{cmp.run_id}/results").status_code == 200
    assert "renderer check" in log.read_text()


def test_two_runs_of_the_same_method_can_be_diffed(client, root, tmp_path):
    deck = make_deck(tmp_path / "deck.pdf")
    a = make_extract_run(root, "alphatool", deck, purpose="explore")
    b = make_extract_run(root, "alphatool", deck, purpose="explore")
    c = make_extract_run(root, "betatool", deck, purpose="explore")
    body = client.get("/api/diff", params={"a": a.run_id, "b": b.run_id, "page": 2}).json()
    assert {op["op"] for op in body["ops"]} == {"equal"}
    assert client.get("/api/diff", params={"a": a.run_id, "b": c.run_id, "page": 2}).status_code == 400


def test_word_diff_marks_what_changed():
    ops = server.api_runs.word_diff("Lecturer Software 3\nVersion control", "Version control")
    assert {"op": "delete", "text": "Lecturer Software 3\n"} in ops and ops[-1] == {"op": "equal", "text": "Version control"}


def test_page_images_and_sources(client, root, tmp_path):
    run = make_extract_run(root, "current", make_deck(tmp_path / "deck.pdf"), purpose="explore")
    sha = run.meta["source"]["sha256"]
    r = client.get(f"/api/files/{sha}/pages/2.png")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    [src] = client.get("/api/sources").json()["sources"]
    assert (src["sha256"], src["pages"], src["locked"], src["runs"]) == (sha, [1, 2, 3, 4, 5, 6], [], 1)
    assert [o["tool"] for o in client.get(f"/api/outputs/{sha}/2").json()["outputs"]] == ["current"]


def test_upload_methods_and_a_job_to_the_end(root, tmp_path):
    with client_for(root, dist=tmp_path / "no-dist") as client:
        pdf = make_deck(tmp_path / "deck.pdf").read_bytes()
        stored = client.post("/api/files", headers=WRITE, files={"file": ("Lecture.pdf", pdf, "application/pdf")}).json()
        assert (stored["name"], stored["pages"], stored["benchmark_pages"]) == ("Lecture.pdf", 6, [])
        assert client.post("/api/files", headers=WRITE, files={"file": ("x.pdf", b"nope", "application/pdf")}).status_code == 400
        methods = {m["id"]: m for m in client.get("/api/methods").json()["methods"]}
        assert methods["current"]["ready"] is True and methods["current"]["group"] == "fast"
        r = client.post("/api/jobs", headers=WRITE, json={"sha256": stored["sha256"], "tools": ["current"], "purpose": "benchmark"})
        assert r.status_code == 400 and "benchmark page set" in r.json()["detail"]
        [job] = client.post("/api/jobs", headers=WRITE, json={"sha256": stored["sha256"], "tools": ["current"]}).json()["jobs"]
        end = time.monotonic() + 60
        while time.monotonic() < end and client.get("/api/jobs").json()["jobs"][0]["state"] in ("queued", "running"):
            time.sleep(0.1)
        done = client.get("/api/jobs").json()["jobs"][0]
        assert done["state"] == "finished", done
        assert any(r["run_id"] == done["run_id"] for r in client.get("/api/runs").json()["runs"])


def test_the_viewer_is_served_when_built(root, tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><title>Parser Bench</title>")
    assert "Parser Bench" in client_for(root, dist=dist).get("/").text
    assert "not built" in client_for(root, dist=tmp_path / "nothing").get("/").text


def test_a_record_without_a_source_does_not_break_the_source_or_output_lists(client, root, tmp_path):
    run = make_extract_run(root, "current", make_deck(tmp_path / "deck.pdf"), purpose="explore")
    odd = root / "runs" / "extract" / "2026-10-29_odd-1_0000"
    odd.mkdir(parents=True)
    (odd / "run.json").write_text(json.dumps({"run_id": odd.name, "kind": "extract", "tool": "current", "status": "finished",
                                              "started_at": "2026-10-29T00:00:00+00:00"}))
    sha = run.meta["source"]["sha256"]
    assert [s["sha256"] for s in client.get("/api/sources").json()["sources"]] == [sha]
    assert [o["run_id"] for o in client.get(f"/api/outputs/{sha}/2").json()["outputs"]] == [run.run_id]


# --- fix round 1 ------------------------------------------------------------------------


def _names(cmp, root):
    run_ids = [r for runs in cmp.meta["entrants"].values() for r in runs.values()]
    return ["alphatool", "betatool", "current", *run_ids, str(root), "/Users"]


def _hide_runs(cmp, root, *tools):
    import shutil
    for tool in tools:
        for run_id in cmp.meta["entrants"][tool].values():
            shutil.move(str(store.find_run(run_id, root)), str(root / f"gone-{run_id}"))


def test_a_missing_output_never_names_a_tool_a_run_or_a_path(client, root, tmp_path):
    cmp = make_comparison(root, tmp_path)
    names = _names(cmp, root)
    _hide_runs(cmp, root, "alphatool", "betatool")  # every duel involves at least one of them
    r = client.get(f"/api/comparisons/{cmp.run_id}/next")
    assert r.status_code == 404 and "missing" in r.json()["detail"]
    assert not [n for n in names if n in r.text]


def test_a_missing_output_on_the_last_vote_never_names_anything(client, root, tmp_path):
    cmp = make_comparison(root, tmp_path)
    names = _names(cmp, root)
    for duel in cmp.meta["schedule"][:-1]:
        cmp.vote(duel=duel["duel"], choice="same", seconds=1, session=SESSION)
    _hide_runs(cmp, root, "alphatool", "betatool", "current")
    last = cmp.meta["schedule"][-1]["duel"]
    r = client.post(f"/api/comparisons/{cmp.run_id}/votes", headers=WRITE,
                    json={"duel": last, "choice": "same", "seconds": 1, "session": SESSION})
    assert r.status_code == 404 and not [n for n in names if n in r.text]


def test_vote_responses_and_locked_bodies_hold_no_tool_or_run(client, root, tmp_path):
    cmp = make_comparison(root, tmp_path)
    names = _names(cmp, root)
    r = client.post(f"/api/comparisons/{cmp.run_id}/votes", headers=WRITE,
                    json={"duel": 0, "choice": "left", "seconds": 1, "session": SESSION})
    assert r.status_code == 200 and not [n for n in names if n in r.text]
    undo = client.post(f"/api/comparisons/{cmp.run_id}/undo", headers=WRITE, json={"session": SESSION})
    assert undo.status_code == 200 and not [n for n in names if n in undo.text]
    for path in ("results", "votes"):
        locked = client.get(f"/api/comparisons/{cmp.run_id}/{path}")
        assert locked.status_code == 423 and not [n for n in names if n in locked.text]
    unlock = client.post(f"/api/comparisons/{cmp.run_id}/unlock", headers=WRITE, json={"reason": ""})
    assert unlock.status_code == 400 and not [n for n in names if n in unlock.text]


def test_a_vote_time_must_be_a_number_not_a_boolean(client, root, tmp_path):
    cmp = make_comparison(root, tmp_path)
    for bad in (True, False, "2"):
        r = client.post(f"/api/comparisons/{cmp.run_id}/votes", headers=WRITE,
                        json={"duel": 0, "choice": "left", "seconds": bad, "session": SESSION})
        assert r.status_code == 422, bad
    assert cmp.progress()[0] == 0
    for ok in (3, 2.5):
        assert client.post(f"/api/comparisons/{cmp.run_id}/votes", headers=WRITE,
                           json={"duel": 0, "choice": "left", "seconds": ok, "session": SESSION}).status_code == 200
        client.post(f"/api/comparisons/{cmp.run_id}/undo", headers=WRITE, json={"session": SESSION})


def test_an_upload_without_the_header_is_refused_and_nothing_is_stored(client, root, tmp_path):
    pdf = make_deck(tmp_path / "deck.pdf").read_bytes()
    r = client.post("/api/files", files={"file": ("Lecture.pdf", pdf, "application/pdf")})
    assert r.status_code == 403
    assert files.list_files(root) == []


def test_a_diff_of_a_locked_page_is_refused(client, root, tmp_path):
    cmp = make_comparison(root, tmp_path)
    sha = cmp.meta["pages"][0]["sha256"]
    first = cmp.meta["entrants"]["alphatool"][sha]
    second = make_extract_run(root, "alphatool", tmp_path / "deck.pdf").run_id
    r = client.get("/api/diff", params={"a": first, "b": second, "page": 1})
    assert r.status_code == 423


def test_records_without_a_source_answer_cleanly_on_page_and_diff(client, root, tmp_path):
    ids = []
    for n in (1, 2):
        odd = root / "runs" / "extract" / f"2026-10-29_odd-{n}_0000"
        odd.mkdir(parents=True)
        (odd / "run.json").write_text(json.dumps({"run_id": odd.name, "kind": "extract", "tool": "current", "status": "finished",
                                                  "started_at": "2026-10-29T00:00:00+00:00"}))
        ids.append(odd.name)
    assert client.get(f"/api/runs/{ids[0]}/pages/1").status_code == 404
    assert client.get("/api/diff", params={"a": ids[0], "b": ids[1], "page": 1}).status_code == 400


def page_set_is(monkeypatch, pages):
    monkeypatch.setattr(blinding.pageset, "load_or_empty", lambda path=pageset.PAGESET: list(pages))


def test_a_method_that_joins_later_stays_hidden_on_judged_pages(client, root, tmp_path, monkeypatch):
    cmp = make_comparison(root, tmp_path)  # current, alphatool, betatool on the deck's six pages
    vote_all(cmp)
    cmp.finish()
    page_set_is(monkeypatch, bench_pages_of(cmp))
    sha = cmp.meta["pages"][0]["sha256"]
    late = make_extract_run(root, "gammatool", tmp_path / "deck.pdf")  # a benchmark run of a method not judged here
    again = make_extract_run(root, "gammatool", tmp_path / "deck.pdf")
    judged = cmp.meta["entrants"]["alphatool"][sha]
    assert client.get(f"/api/runs/{late.run_id}/pages/1").status_code == 423
    assert client.get(f"/api/runs/{judged}/pages/1").status_code == 200
    detail = client.get(f"/api/runs/{late.run_id}").json()
    assert detail["checks"] == [] and all(p["locked"] for p in detail["page_list"])
    assert client.get("/api/diff", params={"a": late.run_id, "b": again.run_id, "page": 1}).status_code == 423
    body = client.get(f"/api/outputs/{sha}/1").json()
    assert "gammatool" not in json.dumps(body) and body["hidden"] == 2
    assert {o["tool"] for o in body["outputs"]} == {"current", "alphatool", "betatool"}
    [src] = [s for s in client.get("/api/sources").json()["sources"] if s["sha256"] == sha]
    assert src["locked"] == []  # every page still has an output that may be named


def test_a_page_whose_every_output_is_hidden_is_locked_in_compare(client, root, tmp_path, monkeypatch):
    deck = make_deck(tmp_path / "deck.pdf")
    run = make_extract_run(root, "gammatool", deck)
    sha = run.meta["source"]["sha256"]
    page_set_is(monkeypatch, [pageset.BenchPage("d-p1", "swt", "deck.pdf", sha, 1, "layout", "chosen", "r")])
    assert client.get(f"/api/outputs/{sha}/1").status_code == 423
    assert client.get(f"/api/outputs/{sha}/2").status_code == 200
    [src] = client.get("/api/sources").json()["sources"]
    assert src["locked"] == [1]


def test_a_paid_method_shows_its_estimate_and_needs_a_cost_ok(root, tmp_path, monkeypatch):
    import dataclasses
    # the stronger method without a model id, as it was before the protocol step
    monkeypatch.setitem(tools.TOOLS, "ai_vision_strong", dataclasses.replace(tools.TOOLS["ai_vision_strong"], model=""))
    monkeypatch.setattr(paid, "KEY_FILE", tmp_path / "no-key")
    with client_for(root, dist=tmp_path / "no-dist") as client:
        pdf = make_deck(tmp_path / "deck.pdf").read_bytes()
        stored = client.post("/api/files", headers=WRITE, files={"file": ("Lecture.pdf", pdf, "application/pdf")}).json()
        methods = {m["id"]: m for m in client.get("/api/methods").json()["methods"]}
        vision = methods["ai_vision"]
        assert (vision["group"], vision["paid"], vision["model"], vision["key_missing"]) == ("paid", True, "gpt-4.1-mini", True)
        assert methods["current"]["key_missing"] is None and methods["current"]["paid"] is False
        assert methods["current"]["model"] is None and isinstance(vision["needs_install"], bool)
        est = client.get("/api/estimate", params={"sha256": stored["sha256"], "tools": "current,ai_vision"}).json()
        assert [(e["tool"], e["pages"], e["model"]) for e in est["estimates"]] == [("ai_vision", 6, "gpt-4.1-mini")]
        assert est["estimates"][0]["usd"] > 0 and est["estimates"][0]["max_usd"] >= est["estimates"][0]["usd"]
        assert (est["file"], est["purpose"]) == ("Lecture.pdf", "explore")
        r = client.post("/api/jobs", headers=WRITE, json={"sha256": stored["sha256"], "tools": ["current", "ai_vision"]})
        assert r.status_code == 400 and "cost" in r.json()["detail"]
        assert client.get("/api/jobs").json()["jobs"] == []  # nothing queued, not even current
        r = client.post("/api/jobs", headers=WRITE, json={"sha256": stored["sha256"], "tools": ["ai_vision"], "cost_ok": "yes"})
        assert r.status_code == 422  # only a JSON true is an OK
        for not_true in ("true", 1):
            r = client.post("/api/jobs", headers=WRITE, json={"sha256": stored["sha256"], "tools": ["ai_vision"], "cost_ok": not_true})
            assert r.status_code == 422
        assert client.get("/api/jobs").json()["jobs"] == []
        # a method without a model id cannot be estimated, so a batch naming it is refused whole
        r = client.post("/api/jobs", headers=WRITE, json={"sha256": stored["sha256"], "tools": ["current", "ai_vision_strong"], "cost_ok": True})
        assert r.status_code == 400 and client.get("/api/jobs").json()["jobs"] == []
        assert client.get("/api/estimate", params={"sha256": stored["sha256"], "tools": "nope"}).status_code == 400


def test_run_detail_hides_the_api_usage_of_pages_still_judged_blind(client, root, tmp_path):
    make_comparison(root, tmp_path)  # judging the deck's six pages
    usage = {"pages": {str(n): {"prompt_tokens": 100, "completion_tokens": 10 * n} for n in range(1, 7)}}
    cost = {"requests": 6, "prompt_tokens": 600, "completion_tokens": 210, "usd": 0.001}
    hidden = make_extract_run(root, "ai_vision", tmp_path / "deck.pdf",
                              finish_extra={"api_usage": usage, "cost": cost, "pages_sent": [1, 2, 3, 4, 5, 6]})
    detail = client.get(f"/api/runs/{hidden.run_id}").json()
    assert detail["api_pages"] == {} and detail["cost"]["usd"] == 0.001 and detail["pages_sent"] == [1, 2, 3, 4, 5, 6]
    other = make_deck(tmp_path / "other.pdf", n=7)  # another file: not judged, not in the page set
    shown = make_extract_run(root, "ai_vision", other, purpose="explore", finish_extra={"api_usage": usage, "cost": cost})
    assert set(client.get(f"/api/runs/{shown.run_id}").json()["api_pages"]) == {"1", "2", "3", "4", "5", "6"}
    rows = {r["run_id"]: r for r in client.get("/api/runs").json()["runs"]}
    assert rows[shown.run_id]["cost_usd"] == 0.001


def test_no_model_id_sits_next_to_a_locked_run(client, root, tmp_path):
    """While a comparison is judging a paid run's pages, its detail and its list row carry no model id."""
    make_comparison(root, tmp_path)
    model = "gpt-4.1-mini-2025-04-14"
    usage = {"pages": {"1": {"prompt_tokens": 100, "completion_tokens": 10, "model": model}}}
    cost = {"requests": 1, "usd": 0.001, "price": {"model": "gpt-4.1-mini", "input_per_m": 0.4}}
    run = make_extract_run(root, "ai_vision", tmp_path / "deck.pdf",
                           finish_extra={"api_usage": usage, "cost": cost, "settings": {"model": "gpt-4.1-mini", "zoom": 2}})
    detail = client.get(f"/api/runs/{run.run_id}").json()
    row = next(r for r in client.get("/api/runs").json()["runs"] if r["run_id"] == run.run_id)
    assert "gpt-4.1" not in json.dumps([detail, row])
    assert detail["cost"]["usd"] == 0.001
    # a run of a free method is unchanged
    free = make_extract_run(root, "current", tmp_path / "deck.pdf")
    assert client.get(f"/api/runs/{free.run_id}").json()["version"] == "1.0"


def test_an_open_paid_run_shows_its_pages_usage_and_model(client, root, tmp_path):
    other = make_deck(tmp_path / "other.pdf", n=7)
    usage = {"pages": {"1": {"prompt_tokens": 100, "completion_tokens": 10, "model": "gpt-4.1-mini-2025-04-14"}, "x": {}}}
    run = make_extract_run(root, "ai_vision", other, purpose="explore", finish_extra={"api_usage": usage})
    detail = client.get(f"/api/runs/{run.run_id}").json()
    assert detail["api_pages"]["1"]["model"] == "gpt-4.1-mini-2025-04-14" and "x" not in detail["api_pages"]
    free = make_extract_run(root, "current", other, purpose="explore")
    assert client.get(f"/api/runs/{free.run_id}").json()["api_pages"] is None
