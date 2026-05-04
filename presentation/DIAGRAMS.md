# Project Diagrams

This document contains Mermaid diagrams visualizing the architecture and workflows of Ascend Academy. These can be rendered in many Markdown editors or online at [Mermaid Live Editor](https://mermaid.live/).

## 1. High-Level System Architecture
Visualizes how the different parts of the system interact.

```mermaid
graph LR
    subgraph Client
        F[React Frontend]
    end
    
    subgraph Services
        B[FastAPI Backend]
        A[Supabase Auth]
    end
    
    subgraph Data
        D[(PostgreSQL DB)]
        S[File Storage]
    end

    F -- API Requests --> B
    F -- Authentication --> A
    B -- Queries --> D
    F -- Assets --> S
```

## 2. User Authentication Flow
The process of a user logging in and accessing protected data.

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant S as Supabase Auth
    participant B as Backend
    
    U->>F: Enter Credentials
    F->>S: Authenticate
    S-->>F: Return JWT Token
    F->>B: Request Data (with JWT)
    B->>B: Verify Token
    B-->>F: Return Authorized Data
    F->>U: Display Dashboard
```

## 3. Analytics Data Pipeline
How student interactions turn into professor insights.

```mermaid
flowchart TD
    A[Student Watches Lecture] --> B[Engagement Events Logged]
    B --> C{Engagement Data}
    C --> D[Slide View Duration]
    C --> E[Quiz Responses]
    D --> F[PostgreSQL DB]
    E --> F
    F --> G[FastAPI Analytics Service]
    G --> H[Professor Dashboard Charts]
```

## 4. Gamification XP Engine
How experience points are calculated and rewarded.

```mermaid
stateDiagram-v2
    [*] --> ActionPerformed
    ActionPerformed --> QuizCompleted
    ActionPerformed --> LectureFinished
    
    QuizCompleted --> CalculateXP: Based on score
    LectureFinished --> CalculateXP: Fixed reward
    
    CalculateXP --> UpdateProfile: Add XP to DB
    UpdateProfile --> LevelCheck: Check for Level Up
    
    LevelCheck --> AchievementUnlocked: If threshold met
    LevelCheck --> [*]: If no level up
    
    AchievementUnlocked --> NotifyUser
    NotifyUser --> [*]
```
