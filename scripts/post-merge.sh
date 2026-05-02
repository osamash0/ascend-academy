#!/bin/bash
# Post-merge setup for Learnstation.
# Runs automatically after a task is merged into main.
# Must be idempotent, non-interactive, and fail fast.
set -euo pipefail

echo "[post-merge] Installing frontend dependencies (npm)..."
# --legacy-peer-deps matches what the testing harness task documented:
# the project's existing peer-dep tree blocks a normal install.
# --no-audit / --no-fund keep the output quiet and the run fast.
npm install --legacy-peer-deps --no-audit --no-fund

echo "[post-merge] Installing backend dependencies (pip)..."
# --break-system-packages is required because Replit's NixOS Python is
# externally-managed (PEP 668); packages still go into the project-local
# .pythonlibs dir, not /nix/store.
# --upgrade lets new pinned versions in requirements.txt take effect;
# --quiet keeps logs short.
python -m pip install \
    --break-system-packages \
    --upgrade \
    --quiet \
    -r backend/requirements.txt

echo "[post-merge] Done."
