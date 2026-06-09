# Learnstation Backend v3.0

FastAPI backend with intelligent PDF parsing (v3.0), LLM integration, and grounded tutor AI.

## Architecture

The backend implements a **seven-stage content processing pipeline** with resumable, memory-safe job processing:

```
PDF Upload → Validation → Registration → Page Indexing → Extract & Classify
    → Deck Outline → Per-slide AI → Local Embeddings → Deck Summary → Complete
```

**Key components:**
- `backend/services/parser/` — PDF parsing pipeline (v3.0)
- `backend/api/` — FastAPI routes (upload, tutor, analytics)
- `backend/workers/` — Arq job worker for async processing
- `backend/domain/` — Pydantic models for type safety
- `backend/infra/` — Database, storage, LLM clients

## Prerequisites

- **Python** ≥ 3.13
- **PostgreSQL** 15+ (with pgvector extension)
- **Redis** (for Arq job queue)
- **API Keys**: Gemini, Groq (optional), OpenAI (optional)

## Setup

### 1. Create Virtual Environment

```bash
python3.13 -m venv venv
source venv/bin/activate  # macOS/Linux
# or: .\venv\Scripts\activate  # Windows
```

### 2. Install Dependencies

```bash
pip install -r backend/requirements.txt
```

### 3. Configure Environment

Create `.env` from `.env.example`:
```bash
cp .env.example .env
```

Key variables:
```bash
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
GEMINI_API_KEY=your_gemini_api_key
GROQ_API_KEY=your_groq_key (optional)
REDIS_URL=redis://localhost:6379
LITELLM_BASE_URL=http://localhost:4000
PARSER_VERSION=3
```

### 4. Run Infrastructure

```bash
# In one terminal, start Redis + LiteLLM
docker compose up redis litellm -d
```

### 5. Run the Server

```bash
# Run migrations (if needed)
cd backend && python -m alembic upgrade head

# Start the API server
uvicorn backend.main:app --reload
```

The API will be available at `http://localhost:8000`.
Interactive API docs: `http://localhost:8000/docs`

### 6. Run the Worker (Optional)

In another terminal:
```bash
python -m arq backend.workers.arq_worker.WorkerSettings
```

This enables async PDF processing. Without it, uploads process synchronously (slower).

## Key Endpoints

| Method | Path | Description |
|--------|------|---|
| `POST` | `/api/upload-pdf` | Upload lecture PDF (starts async parse) |
| `GET` | `/api/parse-pdf-stream/{run_id}` | Stream parsing progress (SSE) |
| `POST` | `/api/tutor/{lecture_id}/ask` | Ask tutor about lecture content |
| `GET` | `/api/lectures/{lecture_id}/analytics` | Professor analytics |
| `GET` | `/api/skill-tree/{course_id}` | Student skill progression |

## Configuration

### Parser Version

Set `PARSER_VERSION=3` to use the new intelligent parser. v2 is still available as a fallback.

### LLM Routing

LiteLLM (`litellm/config.yaml`) routes requests through a fallback chain:
1. **Cerebras** (fastest free text model)
2. **Groq Llama 3.2** (vision model)
3. **Gemini Flash** (fallback for all)

Edit `litellm/config.yaml` to change routing.

### Memory Limits

The parser v3 is designed to process 200-slide decks in ~150 MB of constant memory.
To adjust concurrency:

```python
# backend/services/parser/orchestrator.py
extract_sem = asyncio.Semaphore(8)  # concurrent page extraction
vision_sem = asyncio.Semaphore(3)   # concurrent vision LLM calls
```

## Testing

```bash
# Unit tests
pytest backend/tests/unit -v

# Integration tests
pytest backend/tests/integration -v

# Contract tests (SSE events, API schemas)
pytest backend/tests/contract -v

# Database tests
pytest backend/tests/db -v

# Performance tests (nightly)
pytest backend/tests/perf -v
```

## Monitoring

### Worker Logs
```bash
docker compose logs -f worker
```

### Database Metrics
```sql
-- Check parsing pipeline status
SELECT run_id, status, page_count, started_at, finished_at 
FROM parse_runs 
ORDER BY started_at DESC 
LIMIT 10;

-- Check slide chunks (tutor context store)
SELECT lecture_id, COUNT(*) as chunks, 
       MAX(embedding::text) is not null as has_embeddings
FROM slide_chunks 
GROUP BY lecture_id;
```

### LLM Quota
```sql
-- Daily token usage
SELECT DATE(created_at) as day, SUM(tokens) as total
FROM pipeline_run_metrics
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY day
ORDER BY day DESC;
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Port 8000 already in use | `lsof -i :8000` and kill the process, or use `--port 8001` |
| Redis connection refused | Ensure `docker compose up redis -d` is running |
| LiteLLM 404 errors | Start with `docker compose up litellm -d` |
| Supabase auth errors | Verify `SUPABASE_SERVICE_ROLE_KEY` has service_role permissions |
| Memory issues during parse | Reduce `extract_sem` and `vision_sem` concurrency limits |

## Contributing

See [development guidelines](../project_docs/development_guidelines.md) for the full contribution workflow.
