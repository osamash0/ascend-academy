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

## 🤝 Contribution

Please read [Development Guidelines](project_docs/development_guidelines.md) before contributing.
