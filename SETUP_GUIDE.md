# Ascend Academy - Setup Guide

## Prerequisites

### 1. Node.js Version (⚠️ ACTION REQUIRED)
**Current:** v18.20.5  
**Required:** v20.0.0 or higher

**Upgrade Node.js:**
```bash
# Using Homebrew (macOS)
brew install node@20

# Or download from: https://nodejs.org/

# Verify installation
node --version  # Should be v20+
```

### 2. Python 3.10+
✅ Already configured: Python 3.13.1 with venv

### 3. Git
```bash
git --version
```

---

## Installation Steps

### Frontend Setup ✅ COMPLETE
```bash
cd /Users/abdullahabobaker/Desktop/ascend-academy

# Install dependencies
npm install

# Verify all packages installed
npm list --depth=0
```

**Status:** 506 packages installed

### Backend Setup ✅ COMPLETE
```bash
cd /Users/abdullahabobaker/Desktop/ascend-academy

# Python virtual environment already created at: .venv/
# Verify Python packages installed
.venv/bin/pip list
```

**Status:** 47 packages installed (FastAPI, Uvicorn, Supabase, SQLModel, etc.)

### Environment Variables Setup ✅ COMPLETE

**Frontend (.env):**
```
VITE_SUPABASE_PROJECT_ID="obwkbypcsczangyqehvb"
VITE_SUPABASE_PUBLISHABLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
VITE_SUPABASE_URL="https://obwkbypcsczangyqehvb.supabase.co"
```

**Backend (.env):** Create if needed in `backend/` folder with:
```
SUPABASE_URL=https://obwkbypcsczangyqehvb.supabase.co
SUPABASE_KEY=your_supabase_anon_key
DATABASE_URL=postgresql://user:password@host/database
```

---

## Database Setup

### Supabase Migrations
Database schema is defined in: `supabase/migrations/20260122202809_96f90a74-9fe4-4443-9d9b-5e3fa7db68d0.sql`

Tables created:
- `user_roles` - Store user roles (student/professor)
- `profiles` - User profile data and XP
- `lectures` - Course lectures
- `slides` - Lecture slides
- `quiz_questions` - Auto-generated quiz questions
- `learning_events` - Analytics tracking
- `student_progress` - Student progress tracking
- `achievements` - Achievement system
- And more...

**To apply migrations:**
1. Go to Supabase dashboard: https://app.supabase.com
2. Select your project
3. Go to SQL Editor → New Query
4. Copy & paste contents of migration file
5. Click "Run"

---

## Running the Project

### Option 1: Frontend Only (React Dev Server)
```bash
cd /Users/abdullahabobaker/Desktop/ascend-academy
npm run dev
```
- Frontend: http://localhost:8080
- Network: http://192.168.0.79:8080

### Option 2: Backend Only (FastAPI Server)
```bash
cd /Users/abdullahabobaker/Desktop/ascend-academy
.venv/bin/uvicorn backend.main:app --reload
```
- API: http://localhost:8000
- Interactive Docs: http://localhost:8000/docs

### Option 3: Full Stack (Frontend + Backend)

**Terminal 1 - Frontend:**
```bash
cd /Users/abdullahabobaker/Desktop/ascend-academy
npm run dev
```

**Terminal 2 - Backend:**
```bash
cd /Users/abdullahabobaker/Desktop/ascend-academy
.venv/bin/uvicorn backend.main:app --reload
```

---

## Troubleshooting

### Issue: `net::ERR_NAME_NOT_RESOLVED` when signing up
**Cause:** Cannot reach Supabase servers (network/internet issue)
**Solution:**
1. Check internet connection
2. Try accessing https://obwkbypcsczangyqehvb.supabase.co in browser
3. Check if firewall/VPN is blocking
4. If offline, use mock authentication (see below)

### Issue: Module not found errors
```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Issue: Python module not found
```bash
# Ensure using correct Python path
.venv/bin/pip install -r backend/requirements.txt
```

---

## Project Structure

```
ascend-academy/
├── src/                    # React frontend
│   ├── pages/             # Page components
│   ├── components/        # Reusable components
│   ├── lib/               # Utilities (auth, etc)
│   └── integrations/      # Supabase client
├── backend/               # FastAPI backend
│   ├── main.py           # Main app
│   └── requirements.txt   # Python dependencies
├── supabase/             # Database migrations
├── public/               # Static assets
├── package.json          # npm dependencies
└── .env                  # Environment variables
```

---

## Available Scripts

```bash
# Frontend
npm run dev          # Start dev server
npm run build        # Build for production
npm run preview      # Preview production build
npm run lint         # Run ESLint
npm test             # Run tests
npm test:watch       # Run tests in watch mode

# Backend
.venv/bin/uvicorn backend.main:app --reload
```

---

## Tech Stack

**Frontend:**
- React 18
- TypeScript
- Vite
- Tailwind CSS
- Shadcn/ui
- Supabase Auth
- Framer Motion (animations)
- Recharts (charts)
- React Router

**Backend:**
- Python 3.13
- FastAPI
- SQLModel
- Supabase
- Uvicorn

**Database:**
- PostgreSQL (via Supabase)

---

## Next Steps

1. ✅ Upgrade Node.js to v20+
2. ✅ Verify all dependencies are installed
3. Apply database migrations to Supabase
4. Start the development servers
5. Test authentication (once internet is available)

---

For issues or questions, check the respective README files:
- Frontend: See `src/` comments
- Backend: See `backend/README.md`
