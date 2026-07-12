# Learnstation v3.0

**Learnstation** is an interactive learning platform designed for university students and professors. It facilitates lecture uploading, viewing, analytics, and gamified learning experiences.

## 🚀 v3.0 Features

### Parser v3.0 — Intelligent Content Processing
- **Narrative-aware extraction** — understands lecture structure and context
- **Generator-aware routing** — detects PDF source (LaTeX, PowerPoint, Keynote) for optimal processing
- **Memory-safe pipeline** — processes 100–200 slide decks in constant ~150 MB memory
- **Local embeddings** — FastEmbed for free, grounded vector search (no quota limits)
- **Resumable jobs** — crashed uploads pick up where they left off, deterministically
- **Visual-first handling** — diagrams, tables, and images processed as first-class content
- **Grounded Socratic tutor** — AI tutor restricted to lecture content only (zero hallucination)

### For Students
- **Intelligent Dashboard** — AI-generated summaries and personalized learning paths
- **Enhanced Lecture View** — Auto-generated structured notes with highlighted concepts
- **Skill Tree Navigation** — Progress tracking through course concepts
- **Interactive Quizzes** — Multi-level questions (recall, apply, analyze, evaluate)
- **Tutor Chat** — Ask questions about lecture content with grounded answers
- **Gamification** — Earn achievements and badges for learning milestones

### For Professors
- **Advanced Analytics Dashboard** — detailed insights into student performance and engagement
- **Lecture Management** — Upload PDFs with automatic high-fidelity content extraction
- **Slide Analytics** — See which slides students spend the most time on
- **Content Diagnostics** — Monitor parsing quality and processing metrics
- **Deck-Level Insights** — Course-wide concept mapping and student comprehension

## 🛠️ Tech Stack

### Frontend
- **React 18** (Vite), TypeScript, Tailwind CSS, Shadcn UI
- **3D Visualization** — Three.js for skill tree rendering
- **State Management** — TanStack React Query
- **Internationalization** — i18next (English, German)

### Backend
- **FastAPI** (Python 3.11+) with Pydantic v2
- **Content Processing** — PyMuPDF-based parsing pipeline (`PARSER_VERSION=5` default; Docling available for the v3/v4 pipelines via the full `backend/requirements.txt`, not included in the Docker image)
- **LLM Integration** — LiteLLM proxy with Gemini/Groq/Cerebras fallback
- **Job Queue** — Arq (Redis) for durable async processing
- **Vector Search** — pgvector for grounded RAG

### Infrastructure
- **Database**: Supabase (PostgreSQL 15+) with pgvector
- **Authentication**: Supabase Auth
- **File Storage**: Supabase Storage for slide images
- **Message Queue**: Redis (Arq workers)
- **LLM Gateway**: LiteLLM (local or remote)

## 🏁 Getting Started

### Prerequisites
- **Node.js** ≥ 20.19.0 & npm
- **Python** ≥ 3.11
- **Docker** & Docker Compose (recommended)
- **Supabase Account** (CLI or SaaS)
- **Redis** (included in docker-compose)

### Run with Docker (Recommended)å

The full stack (frontend, backend API, Redis, LiteLLM gateway, Arq worker) starts with one command:

```bash
# 1. Copy and configure environment
cp .env.example .env
# Edit .env with your Supabase + LLM API keys (see Required env vars below).
# REDIS_PASSWORD must be set — compose refuses to start without it.

# 2. Start the entire stack
docker compose up --build
```

The backend image is a multi-stage build on `python:3.11-slim` (deps compiled
into a venv in stage 1, copied onto a clean base in stage 2, runs as non-root
`appuser`). It installs the lean `backend/requirements-docker.txt` set — the
Docling/paddle-based parser extras are excluded, so keep `PARSER_VERSION` at
the default (`5`) or `2` inside containers. The `api` and `worker` services
share this image.

For the university-server deployment use the production stack, which pins
`linux/amd64`, adds healthchecks, restart policies, and memory limits:

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

All published ports bind to `127.0.0.1` in both stacks — nothing is exposed on
public interfaces.

Services will be available at:
| Service | URL |
|---------|-----|
| Frontend (nginx) | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| LiteLLM gateway | http://localhost:4000 |
| Redis | localhost:6379 |

### Manual Setup (Development)

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd learnstation
   ```

2. **Backend Setup**
   ```bash
   # Create virtual environment (Python 3.11+)
   python3 -m venv venv
   source venv/bin/activate  # macOS/Linux
   # or .\venv\Scripts\activate  # Windows
   
   # Install dependencies (full set incl. optional parser extras)
   pip install -r backend/requirements.txt
   # For running the test suite:
   pip install -r backend/requirements-dev.txt
   ```

3. **Frontend Setup**
   ```bash
   npm install
   ```

4. **Start infrastructure** (Redis + LiteLLM)
   ```bash
   docker compose up redis litellm -d
   ```

5. **Start the Backend**
   ```bash
   uvicorn backend.main:app --reload
   ```
   API will run at `http://localhost:8000`. Interactive docs: `http://localhost:8000/docs`

6. **Start the Arq Worker** (in a new terminal)
   ```bash
   python -m arq backend.workers.arq_worker.WorkerSettings
   ```

7. **Start the Frontend** (in another terminal)
   ```bash
   npm run dev
   ```
   Frontend will run at `http://localhost:5173`

## 📚 Documentation

### Getting Started
- **[v3.0 Release Notes](project_docs/v3.0_release_notes.md)** — What's new, how to deploy
- **[CHANGELOG](CHANGELOG.md)** — Full version history and migration guide
- **[Backend README](backend/README.md)** — Setup, configuration, troubleshooting

### Architecture & Deep Dives
- [Parser v3 Architecture](project_docs/parser_v3_architecture.md) — 674-line technical specification
- [Architecture Overview](project_docs/architecture_overview.md) — System design
- [Testing Guide](project_docs/testing.md) — Test patterns and coverage

### Reference
- [Detailed Walkthrough](project_docs/detailed_walkthrough.md) — User flows
- [Database Schema](project_docs/database_schema.md) — Table structure
- [Development Guidelines](project_docs/development_guidelines.md) — Contribution workflow
- [Reconstructed History](project_docs/reconstructed_history.md) — Project evolution

### Required Environment Variables

| Variable | Required | Where to get it / notes |
|----------|----------|---|
| `VITE_SUPABASE_URL` | ✓ | Supabase dashboard → Project Settings → API |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | ✓ | Supabase dashboard → anon/public key (baked into the frontend bundle at build time) |
| `SUPABASE_URL` | ✓ | Same as `VITE_SUPABASE_URL` |
| `SUPABASE_KEY` | ✓ | Same as anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | Supabase dashboard → service_role key. **Server-only secret — bypasses RLS. Never give it a `VITE_` prefix.** |
| `REDIS_PASSWORD` | ✓ (Docker) | Choose any strong value; compose fails fast if unset |
| `GEMINI_API_KEY` | ✓ | [Google AI Studio](https://aistudio.google.com/app/apikey) |
| `DATABASE_URL` | optional | Supabase → Database → connection string. Enables the asyncpg pool; without it the API logs a warning and uses PostgREST only |
| `GROQ_API_KEY` | optional | [console.groq.com](https://console.groq.com) (fallback LLM) |
| `OPENAI_API_KEY` | optional | [platform.openai.com](https://platform.openai.com) (used by LiteLLM) |
| `LLAMA_CLOUD_API_KEY` | optional | [cloud.llamaindex.ai](https://cloud.llamaindex.ai) (for enhanced parsing) |
| `LITELLM_MASTER_KEY` | optional | Any value; auth for the LiteLLM gateway |
| `PARSER_VERSION` | optional | PDF pipeline version, default `5`. Versions 3/4 need the full `requirements.txt` (Docling) and don't work in the Docker image |
| `ALLOWED_ORIGINS` / `CORS_ALLOWED_ORIGINS` | optional | Comma-separated CORS allowlist (dev / prod compose respectively); defaults to localhost dev ports |
| `NUDGE_RUN_SECRET` | optional | Shared secret for the `/nudges/run` scheduler endpoint; the endpoint fails closed (404) when unset |
| `SENTRY_DSN` / `VITE_SENTRY_DSN` | optional | Error reporting (backend / frontend) |

All others default to sensible development values — `.env.example` documents the full list.

### Useful Docker Commands

```bash
# Start only infrastructure, run backend locally
docker compose up redis litellm -d

# Tail worker logs
docker compose logs -f worker

# Rebuild after code changes
docker compose up --build <service-name>

# Stop everything and remove containers
docker compose down

# Build just the backend image
docker build -t learnstation-api .

# Shell into the running API container
docker compose exec api bash
```

Database schema changes are managed as Supabase SQL migrations in
`supabase/migrations/` (applied via the Supabase CLI or dashboard SQL editor) —
there is no Alembic.

## 🤝 Contribution

Please read [Development Guidelines](project_docs/development_guidelines.md) before contributing.
