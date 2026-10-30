"""LS-037 / LS-032: every Vite flag the app reads reaches the prod build.

`.dockerignore` drops `.env`, so a `VITE_*` value only gets into the bundle
when Dockerfile.frontend declares it as an ARG and docker-compose.prod.yml
passes it. Until 2026-10-26 the v4 and feature flags were never passed: the
server's `VITE_FEATURE_*=1` lines did nothing, and prod could not ship v4.

Feature switches are derived from their backend flag, one switch per feature,
so a screen never ships without the routes behind it.
"""
from __future__ import annotations

import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]

# Read by the app but deliberately not shipped, with the reason. Empty since
# the privacy policy names Sentry (2026-10-30): VITE_SENTRY_DSN ships too.
NOT_SHIPPED: set[str] = set()


def _used_in_src() -> set[str]:
    names: set[str] = set()
    for path in (ROOT / "src").rglob("*.ts*"):
        if "__tests__" in path.parts or path.name.endswith((".test.ts", ".test.tsx")):
            continue
        names |= set(re.findall(r"import\.meta\.env\.(VITE_[A-Z0-9_]+)", path.read_text()))
    return names


def _dockerfile_args() -> set[str]:
    text = (ROOT / "Dockerfile.frontend").read_text()
    return set(re.findall(r"^ARG (VITE_[A-Z0-9_]+)", text, re.M))


def _compose_args() -> dict[str, str]:
    compose = yaml.safe_load((ROOT / "docker-compose.prod.yml").read_text())
    return {k: str(v) for k, v in compose["services"]["frontend"]["build"]["args"].items()}


def test_every_flag_the_app_reads_is_built_in():
    missing = _used_in_src() - NOT_SHIPPED
    assert missing - _dockerfile_args() == set(), "add an ARG + ENV in Dockerfile.frontend"
    assert missing - set(_compose_args()) == set(), "pass it in docker-compose.prod.yml frontend.build.args"


def test_each_feature_switch_follows_its_backend_flag():
    args = _compose_args()
    features = {k: v for k, v in args.items() if k.startswith("VITE_FEATURE_")}
    assert features, "no feature switches passed to the build"
    for name, value in features.items():
        backend = name.removeprefix("VITE_")
        assert value == f"${{{backend}:-0}}", f"{name} should be ${{{backend}:-0}}, got {value}"


def test_the_backend_knows_every_switch():
    from backend.core.config import Settings

    aliases = {f.alias for f in Settings.model_fields.values() if f.alias}
    for name in _compose_args():
        if name.startswith("VITE_FEATURE_"):
            assert name.removeprefix("VITE_") in aliases, name


def test_v4_is_live_data_when_switched_on():
    assert _compose_args()["VITE_V4_DATA_MODE"] == "${VITE_V4_DATA_MODE:-live}"
