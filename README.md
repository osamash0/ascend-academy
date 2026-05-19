# Ascend Academy - Learnstation

**Learnstation** is an interactive learning platform designed for university students and professors. It facilitates lecture uploading, viewing, analytics, and gamified learning experiences.

## 🚀 Features

### For Students
- **Dashboard**: View upcoming lectures and progress.
- **Lecture View**: Watch lectures with integrated slides and quizzes.
- **Gamification**: Earn achievements and badges for learning milestones.
- **Interactive Quizzes**: Test your knowledge after each lecture.

### For Professors
- **Analytics Dashboard**: detailed insights into student performance and engagement.
- **Lecture Management**: Upload and organize course content.
- **Slide Analytics**: See which slides students spend the most time on.

## 🛠️ Tech Stack

- **Frontend**: React (Vite), TypeScript, Tailwind CSS, Shadcn UI
- **Backend**: Python (FastAPI), Pydantic
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth

## 🏁 Getting Started

### Prerequisites
- Node.js & npm
- Python 3.8+
- Supabase Account

### Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd learnstation
   ```

2. **Backend Setup**
   ```bash
   # Create virtual environment
   python -m venv venv
   
   # Activate virtual environment
   # Windows:
   .\venv\Scripts\activate
   # Mac/Linux:
   source venv/bin/activate
   
   # Install dependencies
   pip install -r backend/requirements.txt
   
   # Setup Environment Variables
   # Create a backend/.env file with:
   SUPABASE_URL=your_supabase_url
   SUPABASE_KEY=your_supabase_key
   ```

3. **Frontend Setup**
   ```bash
   # Install dependencies
   npm install
   ```

### Running the Application

1. **Start the Backend**
   ```bash
   uvicorn backend.main:app --reload
   ```
   Server will run at `http://localhost:8000`.

2. **Start the Frontend**
   ```bash
   npm run dev
   ```
   App will run at `http://localhost:8080` (or the port shown in terminal).

## 📚 Documentation

For more detailed information, check the `project_docs/` folder:
- [Walkthrough](project_docs/detailed_walkthrough.md)
- [Architecture Overview](project_docs/architecture_overview.md)
- [Reconstructed History](project_docs/reconstructed_history.md)

## 🐳 Running with Docker

The full stack (frontend, backend API, Redis, LiteLLM gateway, and background worker) can be started with a single command.

### 1. Create your `.env` file

```bash
cp .env.example .env
```

Open `.env` and fill in the required values (see the table below).

### 2. Start everything

```bash
docker compose up --build
```

| Service | URL |
|---------|-----|
| Frontend (nginx) | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| LiteLLM gateway | http://localhost:4000 |
| Redis | localhost:6379 |

The frontend proxies all `/api/*` requests to the backend, so the React app communicates with FastAPI transparently through nginx.

### Required env vars before first run

| Variable | Where to get it |
|---|---|
| `VITE_SUPABASE_URL` | Supabase dashboard → Project Settings → API |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase dashboard → anon/public key |
| `SUPABASE_URL` | Same as above |
| `SUPABASE_KEY` | Same anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → service_role key |
| `GROQ_API_KEY` | [console.groq.com](https://console.groq.com) |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/app/apikey) |
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) (used by LiteLLM) |
| `LLAMA_CLOUD_API_KEY` | [cloud.llamaindex.ai](https://cloud.llamaindex.ai) (parser v3/v4 only) |

All other variables have sensible defaults and are optional for local development.

### Useful commands

```bash
# Start only infrastructure (Redis + LiteLLM), run backend locally
docker compose up redis litellm -d

# Tail worker logs
docker compose logs -f worker

# Rebuild a single service after code changes
docker compose up --build frontend

# Stop everything and remove containers
docker compose down
```

## 🤝 Contribution

Please read [Development Guidelines](project_docs/development_guidelines.md) before contributing.
