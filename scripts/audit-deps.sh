#!/usr/bin/env bash
#
# Run the SCA check's Python half locally.
#
# The CI job "Dependency vulnerability scan (SCA)" audits two requirement sets.
# Getting a change to it right took four CI cycles, two of them burned on
# structural mistakes — auditing the wrong file, then passing both files to one
# pip-audit run when they cannot resolve together. Both would have surfaced
# instantly from any local run. That is what this is for.
#
#   ./scripts/audit-deps.sh          fast: direct pins, seconds
#   ./scripts/audit-deps.sh --full   what CI runs: full tree, many minutes
#
# Fast mode will not find everything CI finds — see "What fast mode misses".
#
# ── Why the setup is fussy ────────────────────────────────────────────────
#
# pip-audit builds an isolated venv to resolve into, which needs a working
# `ensurepip`. Three things on a normal Mac do not provide one:
#
#   * this repo's `.venv` has no `pip` module at all
#   * uv's standalone CPython SIGABRTs inside `ensurepip`
#   * `uv tool run pip-audit` mangles argv — `-r` never binds its value
#
# Homebrew's python3 works. The venv is cached under .cache/ and reused.
#
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

CI_FILE=".github/workflows/ci.yml"
VENV="${AUDIT_VENV:-$REPO_ROOT/.cache/pip-audit-venv}"
MODE="fast"
[[ "${1:-}" == "--full" ]] && MODE="full"

# ── The suppression list comes from CI, never from here ───────────────────
#
# Parsed out of the workflow rather than copied. A second copy of this list is
# a second thing to forget: it would drift, and a stale local ignore would
# either hide a finding CI reports or invent one it does not. CI is the source
# of truth; this reads it.
# A `while read` loop, not `mapfile`: macOS ships bash 3.2, where `mapfile`
# does not exist. The shebang says bash and this file must actually run under
# the one people have, not the one Homebrew might have installed.
IGNORE_ARGS=()
IGNORE_IDS=""
IGNORE_COUNT=0
while IFS= read -r id; do
  [ -n "$id" ] || continue
  IGNORE_ARGS+=(--ignore-vuln "$id")
  IGNORE_IDS="$IGNORE_IDS $id"
  IGNORE_COUNT=$((IGNORE_COUNT + 1))
done <<EOF
$(grep -oE '\-\-ignore-vuln [A-Z]+-[0-9]{4}-[0-9]+' "$CI_FILE" | awk '{print $2}' | sort -u)
EOF

if [ "$IGNORE_COUNT" -eq 0 ]; then
  echo "error: parsed no --ignore-vuln IDs from $CI_FILE" >&2
  echo "       Refusing to run: with no suppressions this would report" >&2
  echo "       findings CI deliberately ignores, and look like a regression." >&2
  exit 2
fi

# ── The interpreter ───────────────────────────────────────────────────────
PYTHON=""
for cand in /opt/homebrew/bin/python3.13 /opt/homebrew/bin/python3.12 \
            /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3; do
  [[ -x "$cand" ]] || continue
  if "$cand" -c 'import ensurepip' >/dev/null 2>&1; then PYTHON="$cand"; break; fi
done

if [[ -z "$PYTHON" ]]; then
  echo "error: found no python3 with a working ensurepip." >&2
  echo "       pip-audit needs one to build its resolution venv." >&2
  echo "       Try: brew install python@3.13" >&2
  exit 2
fi

if [[ ! -x "$VENV/bin/pip-audit" ]]; then
  echo "· creating $VENV using $PYTHON ($("$PYTHON" --version 2>&1))"
  "$PYTHON" -m venv "$VENV" || exit 2
  "$VENV/bin/pip" install --quiet --upgrade pip pip-audit || exit 2
fi

echo "· pip-audit $("$VENV/bin/pip-audit" --version 2>&1 | awk '{print $2}') · mode: $MODE"
echo "· ignoring $IGNORE_COUNT advisory ID(s) from $CI_FILE:$IGNORE_IDS"
echo

# ── The audits ────────────────────────────────────────────────────────────
#
# Separately, and both always run.
#
# Separately because the two files are alternative environments, not additive
# ones: requirements.txt pins asyncpg==0.31.0 where requirements-docker.txt
# allows >=0.29,<0.31. Resolved together that is a ResolutionImpossible, and
# the job fails for a reason with nothing to do with security. That mistake
# cost a CI cycle.
#
# Both always run because letting the first failure stop the script is the bug
# this whole exercise uncovered: pip-audit failing on main meant `npm audit`
# never executed once, for seven-plus runs, hiding a high-severity advisory.
status=0

audit() {
  local file="$1" label="$2"
  echo "── $label"
  echo "   $file"
  if [[ "$MODE" == "fast" ]]; then
    # --no-deps: direct requirements only, no transitive resolution, so it
    # needs no network round-trip per package. Requires exact pins, which is
    # why the ranged docker file is skipped in this mode.
    if grep -qE '^[A-Za-z0-9_.-]+[><]' "$file"; then
      echo "   skipped in fast mode — this file declares ranges, and --no-deps"
      echo "   needs exact pins. Use --full to audit it."
      echo
      return 0
    fi
    "$VENV/bin/pip-audit" -r "$file" --no-deps --disable-pip "${IGNORE_ARGS[@]}" 2>&1 \
      | grep -vE 'WARNING:pip_audit._cli:(--no-deps is supported|Consider using)' || status=1
  else
    "$VENV/bin/pip-audit" -r "$file" "${IGNORE_ARGS[@]}" || status=1
  fi
  echo
}

audit backend/requirements.txt        "local dev / venv"
audit backend/requirements-docker.txt "what the production image installs"

# ── What fast mode misses ─────────────────────────────────────────────────
if [[ "$MODE" == "fast" ]]; then
  cat <<'EOF'
Fast mode audits direct pins only. It did NOT check:

  · transitive dependencies — the nltk advisory that CI suppresses arrives
    through llama-cloud-services → llama-index-core, and nothing here names it
  · requirements-docker.txt at all — it declares ranges, which --no-deps
    cannot audit. That is the file the image is built from, and the file that
    was carrying a Pillow with 25 advisories

Fast mode catches structural errors — a conflicting pin, an unresolvable file,
a typo in a path — which is what it is for. It is not a substitute for CI.
Run --full before claiming a dependency change is clean.
EOF
fi

exit $status
