# Architecture Overview

## System Context
**Learnstation** (Ascend Academy) is an interactive learning platform serving two primary user roles: **Students** and **Professors**.

## Tech Stack

| Component | Technology | Description |
|-----------|------------|-------------|
| **Frontend** | React 18 (TypeScript) | UI Library |
| **Build Tool** | Vite | Fast development server and bundler |
| **Styling** | Tailwind CSS + Shadcn/ui | Utility-first CSS and accessible component primitives |
| **State Mgmt**| React Query + Context | Server state and Auth state management |
| **Routing** | React Router DOM | Client-side routing with RBAC |
| **Backend** | FastAPI (Python) | High-performance async API |
| **Database** | Supabase (PostgreSQL) | Relational database and real-time features |
| **Auth** | Supabase Auth | Identity and access management |

## Environment Configuration
The application relies on the following environment variables (stored in `backend/.env`):
- `SUPABASE_URL`: API URL for the Supabase project.
- `SUPABASE_KEY`: Service role or anon key for API access.

## Directory Structure

### Frontend (`/src`)
- **`components/`**: Reusable UI components. `ui/` contains Shadcn primitives.
- **`pages/`**: View components corresponding to routes (e.g., `StudentDashboard`, `Auth`).
- **`lib/`**: Utilities, including `auth.tsx` for authentication context.
- **`hooks/`**: Custom React hooks.
- **`features/`**: Feature-specific logic (likely user or lecture specific).

### Backend (`/backend`)
- **`main.py`**: Application entry point. Configures CORS and includes routers.
- **`api/`**: Route handlers. `analytics.py` handles data visualization requests.
- **`services/`**: Business logic layer. Separates logic from API routes.
- **`core/`**: Core infrastructure, specifically `database.py` for Supabase connection.

## Key Workflows

### 1. Authentication
- Users sign in via the Frontend (`Auth` page).
- Supabase Auth handles the identity verification.
- Frontend `AuthProvider` maintains the session state.
- `ProtectedRoute` components in `App.tsx` prevent unauthorized access to dashboard routes.

### 2. Data Access
- **Frontend** makes HTTP requests to **Backend** (FastAPI).
- **Backend** verifies logic (if applicable) and queries **Supabase**.
- Response is returned as JSON.
- **Frontend** uses `React Query` to cache and manage the data state.

### 3. Analytics Flow
- Professor requests analytics for a lecture.
- Request hits `GET /api/analytics/lecture/{id}/...`.
- `analytics_service.py` aggregates data (likely from Supabase tables).
- Aggregated metrics are returned to populate charts in `ProfessorAnalytics`.

## Deployment Architecture (Local)
- **Frontend**: Runs on `http://localhost:5173` (Vite)
- **Backend**: Runs on `http://localhost:8000` (Uvicorn)
- **Database**: Remote Supabase instance.
