# Project Dictionary & Directory Guide

This document provides a comprehensive overview of the **Ascend Academy** codebase, explaining where specific features and logic are located.

## 🏗️ Project Overview
The project is split into two main parts:
- **Frontend**: React + TypeScript + Vite (located in `/src`)
- **Backend**: Python + FastAPI (located in `/backend`)
- **Database**: Supabase (PostgreSQL)

---

## 💻 Frontend Structure (`/src`)

### 📄 Pages (`/src/pages`)
These are the main views of the application.

| File | Purpose |
| :--- | :--- |
| `LectureUpload.tsx` | Where **Professors** upload new course materials (PDF/PPT). |
| `LectureEdit.tsx` | Allows professors to modify existing lecture details and quizzes. |
| `ProfessorDashboard.tsx` | Main overview for professors showing their uploaded courses. |
| `ProfessorAnalytics.tsx` | Detailed insights into student performance and engagement. |
| `StudentDashboard.tsx` | Main hub for students to access their courses and track progress. |
| `LectureView.tsx` | The primary learning interface where students view slides and chat with the AI Tutor. |
| `Leaderboard.tsx` | Displays student rankings based on XP and achievements. |
| `Achievements.tsx` | Shows earned badges and gamification progress. |
| `Auth.tsx` | Login and Registration handling. |
| `Landing.tsx` | The public-facing home page. |

### 🧩 Key Components (`/src/components`)
Reusable UI elements and specific feature blocks.

| Component | Purpose |
| :--- | :--- |
| `LectureChat.tsx` | The **AI Tutor** interface for Socratic learning. |
| `SlideViewer.tsx` | Handles the rendering and navigation of lecture slides. |
| `QuizCard.tsx` | The interactive quiz interface for students. |
| `MindMap.tsx` | Visualizes the connection between course topics. |
| `OptimalScheduleCard.tsx` | Recommends the best time to study based on student patterns. |
| `AppSidebar.tsx` | Main navigation menu used across the app. |
| `XPProgress.tsx` | Visual representation of a student's experience points. |

---

## ⚙️ Backend Structure (`/backend`)

### 🔌 API Endpoints (`/backend/api`)
Python routes that handle requests from the frontend.

| File | Purpose |
| :--- | :--- |
| `upload.py` | Handles file uploads and triggers the parsing pipeline. |
| `ai_content.py` | Manages AI Tutor interactions and dynamic quiz generation. |
| `analytics.py` | Fetches data for professor and student dashboards. |
| `mind_map.py` | Generates and serves data for the course mind map. |

### 🧠 Core Services (`/backend/services`)
The logic layer that performs heavy lifting.

| Service | Purpose |
| :--- | :--- |
| `ai_service.py` | Contains the RAG (Retrieval-Augmented Generation) and LLM logic. |
| `file_parse_service.py` | Extracts text and images from uploaded PDF/PPT files. |
| `analytics_service.py` | Aggregates database events into meaningful metrics. |
| `content_filter.py` | Ensures AI responses stay grounded in the course material. |

---

## 🛠️ Utils & Hooks (`/src`)

### 🎣 React Hooks (`/src/hooks`)
Custom hooks for shared logic.

| Hook | Purpose |
| :--- | :--- |
| `use-ai-model.ts` | Manages state and interactions with the backend AI services. |
| `use-toast.ts` | Provides feedback notifications (success/error) to the user. |

### 📚 Core Libraries (`/src/lib`)
Configuration and utility functions.

| File | Purpose |
| :--- | :--- |
| `auth.tsx` | Supabase authentication wrappers and session management. |
| `theme.tsx` | UI theme configuration (Dark/Light mode). |
| `pseudonymize.ts` | Utility to handle student data privacy. |

---

## 🗄️ Database (`/supabase`)
- **`migrations/`**: Contains SQL files that define the database schema (Tables, RLS policies, Functions).
- **`seed.sql`**: Initial data for development.

---

## 📂 Other Directories
- `public/`: Static assets (images, fonts).
- `project_docs/`: Implementation plans and technical documentation.
- `scratch/`: Temporary scripts and testing utilities.
