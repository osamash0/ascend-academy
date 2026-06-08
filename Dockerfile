FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    libpoppler-cpp-dev \
    libgl1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash appuser

WORKDIR /app

# Install deps before copying source for better layer caching
COPY backend/requirements-docker.txt ./backend/requirements-docker.txt
RUN pip install --no-cache-dir -r backend/requirements-docker.txt

# Copy source code with proper ownership
COPY --chown=appuser:appuser backend/ ./backend/

# Ensure the appuser owns the working directory (helpful for scratch files)
RUN chown -R appuser:appuser /app

ENV PYTHONPATH=/app

USER appuser

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
