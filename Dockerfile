FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    libpoppler-cpp-dev \
    libgl1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps before copying source for better layer caching
COPY backend/requirements-docker.txt ./backend/requirements-docker.txt
RUN pip install --no-cache-dir -r backend/requirements-docker.txt

COPY backend/ ./backend/

ENV PYTHONPATH=/app

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
