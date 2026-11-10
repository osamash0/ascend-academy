"""Score the 23 expectations for the real engine and for an engine that never
reports a finding or a theme (review pass (c), M8). Reach and figures stay as
the real engine sent them. Same rule as check() in backend/eval/persona_study.py
at a342dea9. Run: python3 mute_engine.py
"""
import json, pathlib

here = pathlib.Path(__file__).resolve().parent
rules = json.loads((here / "EXPECTATIONS.json").read_text())["pre_registered"]
HARD = set(range(8, 13))
SILENCE = {"figures_null", "reach_few", "quiet_about_B"}


def present(s, mute):
    p = set() if mute else set(s["kinds"])
    if s["themes"] and not mute:
        p.add("themes")
    if s["figures"]["landing"] is None and s["figures"]["cleared"] is None:
        p.add("figures_null")
    if s["reach"] == "few":
        p.add("reach_few")
    if mute or not any(HARD & set(f["pages"]) for f in s["findings"]):
        p.add("quiet_about_B")
    return p


for mute in (False, True):
    met = {"detection": [0, 0], "silence": [0, 0]}
    for path in sorted(here.glob("*.summary.json")):
        s = json.loads(path.read_text())
        p = present(s, mute)
        for kind, rule in rules.items():
            if s["arm"] in rule["must"]:
                group = "silence" if kind in SILENCE else "detection"
                ok = kind in p
            elif s["arm"] in rule["must_not"]:
                group, ok = "silence", kind not in p
            else:
                continue
            met[group][0] += ok
            met[group][1] += 1
    total = sum(v[0] for v in met.values()), sum(v[1] for v in met.values())
    print("mute engine" if mute else "real engine", met, "total %d of %d" % total)
