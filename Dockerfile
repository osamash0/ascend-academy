# syntax=docker/dockerfile:1
# Backend API / worker image — multi-stage build.
#
# Stage 1 installs the Python dependency tree into an isolated venv;
# stage 2 copies only that venv onto a clean python:3.11-slim base.
# Alpine/distroless were evaluated and rejected deliberately: musl breaks
# manylinux wheels (PyMuPDF, Pillow, asyncpg, tiktoken would compile from
# source or bloat), and distroless cannot ship curl, which the compose
# healthchecks require.

########## Stage 1: dependency builder ##########
FROM python:3.11-slim AS builder

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# --mount=type=cache keeps downloaded wheels on the host between builds so
# unchanged packages are never re-downloaded.
COPY backend/requirements-docker.txt /tmp/requirements-docker.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r /tmp/requirements-docker.txt

########## Stage 2: runtime ##########
FROM python:3.11-slim

# curl is required by the docker-compose healthchecks.
# (poppler-utils / libpoppler-cpp-dev / libgl1 were removed 2026-07-11:
# grep-verified no code path in the Docker requirement set uses them —
# they were leftovers from the retired PaddleOCR/Docling-in-image era.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -s /bin/bash appuser

COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH=/app

WORKDIR /app
COPY --chown=appuser:appuser backend/ ./backend/

USER appuser

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
