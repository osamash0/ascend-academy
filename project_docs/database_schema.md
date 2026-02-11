# Database Schema

## Overview
The Learnstation database is hosted on **Supabase** (PostgreSQL). It manages users, content (lectures, slides), and analytics data (events, progress).

## Entity Relationship Diagram (Mermaid)

```mermaid
erDiagram
    profiles ||--o{ lectures : "created by"
    lectures ||--o{ slides : "contains"
    slides ||--o{ quiz_questions : "has"
    
    profiles ||--o{ student_progress : "tracks"
    lectures ||--o{ student_progress : "monitored in"
    
    profiles ||--o{ learning_events : "generates"
    slides ||--o{ learning_events : "target of"
    
    profiles {
        uuid id PK
        uuid user_id FK "auth.users"
        string full_name
        string avatar_url
        int total_xp
    }

    lectures {
        uuid id PK
        string title
        text description
        uuid professor_id FK "profiles.user_id"
        int total_slides
        timestamp created_at
    }

    slides {
        uuid id PK
        uuid lecture_id FK
        int slide_number
        string title
        text content_text
    }

    quiz_questions {
        uuid id PK
        uuid slide_id FK
        text question_text
        jsonb options
        int correct_answer
    }

    student_progress {
        uuid id PK
        uuid user_id FK
        uuid lecture_id FK
        int[] completed_slides
        int last_slide_viewed
        int xp_earned
    }

    learning_events {
        uuid id PK
        uuid user_id FK
        string event_type
        jsonb event_data
        timestamp created_at
    }
```

## Table Dictionary

### 1. `profiles`
Stores public user information. Linked to Supabase Auth `auth.users`.
- **id**: Primary Key
- **user_id**: Foreign Key to `auth.users`
- **role**: 'student' or 'professor' (Managed via `user_roles` table in implementation)

### 2. `lectures`
Courses or lessons created by professors.
- **professor_id**: The user who uploaded the lecture.

### 3. `slides`
Individual pages within a lecture.
- **lecture_id**: Parent lecture.
- **content_text**: The markdown or text content of the slide.

### 4. `student_progress`
Tracks the aggregate state of a student in a lecture.
- **completed_slides**: Array of slide numbers finished.
- **xp_earned**: Gamification points.

### 5. `learning_events`
Immutable log of actions for analytics.
- **event_type**: `slide_viewed`, `quiz_completed`, etc.
- **event_data**: JSON blob containing details (e.g., duration, score).
