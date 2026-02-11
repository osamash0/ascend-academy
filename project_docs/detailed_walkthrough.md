# Project Codebase Walkthrough

This document takes you on a step-by-step tour of the **Learnstation** codebase (`ascend-academy`). It explains the logical flow of the application and the purpose of every key file and directory.

## 1. The Foundation (Project Root)

The project is a **monorepo** containing both the Frontend and Backend.

- **[README.md](file:///c:/Users/Osama/ascend-academy/README.md)**: The entry point for documentation.
- **[.gitignore](file:///c:/Users/Osama/ascend-academy/.gitignore)**: Tells git what to ignore (like `node_modules/` or `venv/` or `.env`).
- **[package.json](file:///c:/Users/Osama/ascend-academy/package.json)**: The blueprint for the Frontend. It lists all the libraries we use (React, Radix UI, TanStack Query) and the scripts to run the app (`npm run dev`).

## 2. The Backend Structure (`/backend`)

The backend is built with **FastAPI** (Python). It serves data to the frontend.

### Configuration & Setup
- **[requirements.txt](file:///c:/Users/Osama/ascend-academy/backend/requirements.txt)**: Lists the Python packages installed:
  - `fastapi`: The web framework.
  - `uvicorn`: The server that runs FastAPI.
  - `supabase`: To connect to the database.
  - `pydantic`: For data validation.
- **[.env](file:///c:/Users/Osama/ascend-academy/backend/.env)**: *Authentication Secrets*. Contains your `SUPABASE_URL` and `SUPABASE_KEY`. **Never push this file to git.**

### The Core
- **[backend/main.py](file:///c:/Users/Osama/ascend-academy/backend/main.py)**: The **Entry Point**.
  - It initializes the `FastAPI()` app.
  - It sets up **CORS** (Cross-Origin Resource Sharing) so your Frontend (localhost:5173) can talk to your Backend (localhost:8000).
  - It includes the routers (like `analytics_router`).
- **[backend/core/database.py](file:///c:/Users/Osama/ascend-academy/backend/core/database.py)**: The **Database Connector**.
  - It reads the `.env` file.
  - It creates a single `supabase` client instance used throughout the app.

### Business Logic
- **[backend/services/analytics_service.py](file:///c:/Users/Osama/ascend-academy/backend/services/analytics_service.py)**: The **Brain**.
  - This file contains the actual logic. For example, `get_lecture_overview(lecture_id)` requests data from Supabase and calculates averages.
  - It keeps logic _out_ of the API routes, making code cleaner.
- **[backend/services/seed_service.py](file:///c:/Users/Osama/ascend-academy/backend/services/seed_service.py)**: The **Data Generator**.
  - A utility script to populate the database with mock data.
  - Runs with `python backend/services/seed_service.py`.
  - Creates sample lectures, slides, and student engagement records linked to your user account.
- **[backend/api/analytics.py](file:///c:/Users/Osama/ascend-academy/backend/api/analytics.py)**: The **Gatekeeper**.
  - Defines URLs like `/lecture/{id}/overview`.
  - It receives the request, calls the `analytics_service`, and returns the JSON response.

## 3. The Frontend Structure (`/src`)

The frontend is built with **React**, **Vite**, and **TypeScript**.

### Configuration
- **[vite.config.ts](file:///c:/Users/Osama/ascend-academy/vite.config.ts)**: Configures the build server.
- **[tsconfig.json](file:///c:/Users/Osama/ascend-academy/tsconfig.json)**: Rules for TypeScript (ensuring type safety).
- **[tailwind.config.ts](file:///c:/Users/Osama/ascend-academy/tailwind.config.ts)**: Configures the styling system (colors, fonts, animations).

### Application Logic
- **[src/main.tsx](file:///c:/Users/Osama/ascend-academy/src/main.tsx)**: The **React Entry Point**. It finds the `<div id="root">` in `index.html` and renders the App.
- **[src/App.tsx](file:///c:/Users/Osama/ascend-academy/src/App.tsx)**: The **Router**.
  - Uses `react-router-dom` to define pages.
  - Wraps the app in Providers: `QueryClientProvider` (for data fetching), `TooltipProvider` (UI), `AuthProvider` (User sessions).
  - Defines **Protected Routes**: Checks if a user is logged in before showing the `StudentDashboard`.

### Essential Modules
- **[src/lib/auth.tsx](file:///c:/Users/Osama/ascend-academy/src/lib/auth.tsx)**:
  - Manages the user's login state using Supabase Auth.
  - Provides the `useAuth()` hook so any component can know "Who is logged in?".
- **[src/components/ui](file:///c:/Users/Osama/ascend-academy/src/components/ui)**:
  - Contains generic building blocks like `button.tsx`, `card.tsx`, `input.tsx`. These are from **shadcn/ui**.

### Pages (The Screens)
- **[src/pages/Auth.tsx](file:///c:/Users/Osama/ascend-academy/src/pages/Auth.tsx)**: The Login/Signup screen.
- **[src/pages/StudentDashboard.tsx](file:///c:/Users/Osama/ascend-academy/src/pages/StudentDashboard.tsx)**: The main hub for students.
- **[src/pages/ProfessorAnalytics.tsx](file:///c:/Users/Osama/ascend-academy/src/pages/ProfessorAnalytics.tsx)**: Fetches data from our Backend API to show charts.

## 4. How It All Connects

1. **User opens the app**: `main.tsx` renders `App.tsx`.
2. **User logs in**: `Auth.tsx` talks to Supabase Auth. `AuthProvider` updates state.
3. **User goes to Dashboard**: `App.tsx` sees the user is logged in and renders `StudentDashboard`.
4. **Dashboard loads data**: The component calls the Backend API (`http://localhost:8000/api/...`).
5. **Backend processes request**: `main.py` -> `api/analytics.py` -> `services/analytics_service.py` -> `database.py` -> Supabase.
6. **Data returns**: Supabase -> Backend -> Frontend -> User sees the analytics charts.
