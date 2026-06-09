# Learnstation v3.0 — Now Orbiting

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
- **FastAPI** (Python 3.13+) with Pydantic v2
- **Content Processing** — Docling + PyMuPDF for intelligent PDF parsing
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
- **Python** ≥ 3.13
- **Docker** & Docker Compose (recommended)
- **Supabase Account** (CLI or SaaS)
- **Redis** (included in docker-compose)

### Quickstart with Docker (Recommended)

The full stack (frontend, backend API, Redis, LiteLLM gateway, Arq worker) starts with one command:

```bash
# 1. Copy and configure environment
cp .env.example .env
# Edit .env with your Supabase + LLM API keys (see Required env vars below)

# 2. Start the entire stack
docker compose up --build
```

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
   # Create virtual environment
   python3.13 -m venv venv
   source venv/bin/activate  # macOS/Linux
   # or .\venv\Scripts\activate  # Windows
   
   # Install dependencies
   pip install -r backend/requirements.txt
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

| Variable | Required | Where to get it |
|----------|----------|---|
| `VITE_SUPABASE_URL` | ✓ | Supabase dashboard → Project Settings → API |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | ✓ | Supabase dashboard → anon/public key |
| `SUPABASE_URL` | ✓ | Same as `VITE_SUPABASE_URL` |
| `SUPABASE_KEY` | ✓ | Same as anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | Supabase dashboard → service_role key |
| `GEMINI_API_KEY` | ✓ | [Google AI Studio](https://aistudio.google.com/app/apikey) |
| `GROQ_API_KEY` | optional | [console.groq.com](https://console.groq.com) (fallback LLM) |
| `OPENAI_API_KEY` | optional | [platform.openai.com](https://platform.openai.com) (used by LiteLLM) |
| `LLAMA_CLOUD_API_KEY` | optional | [cloud.llamaindex.ai](https://cloud.llamaindex.ai) (for enhanced parsing) |

All others default to sensible development values.

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

# View database migrations status
docker compose exec backend alembic current
```

## 🤝 Contribution

Please read [Development Guidelines](project_docs/development_guidelines.md) before contributing.
