#!/bin/bash

# Terminate background processes on exit
cleanup() {
    echo ""
    echo "Shutting down servers..."
    kill $(jobs -p) 2>/dev/null
    exit
}

trap cleanup EXIT INT TERM

echo "🚀 Starting Learnstation in Unified Mode..."

# Kill any existing processes on ports 8000 and 8080
echo "----------------------------------------"
echo "🧹 Clearing ports 8000 and 8080..."
lsof -ti :8000 | xargs kill -9 2>/dev/null && echo "  ↳ Port 8000 cleared." || echo "  ↳ Port 8000 already free."
lsof -ti :8080 | xargs kill -9 2>/dev/null && echo "  ↳ Port 8080 cleared." || echo "  ↳ Port 8080 already free."
sleep 1

# 1. Start Backend (FastAPI)
echo "----------------------------------------"
echo "Initializing Backend (FastAPI)..."
source .venv/bin/activate
uvicorn backend.main:app --reload --port 8000 &
echo "✅ Backend scheduled to start on http://localhost:8000"

# 2. Start Frontend (Vite)
echo "----------------------------------------"
echo "Initializing Frontend (Vite)..."
npm run dev -- --port 8080 --strictPort &
echo "✅ Frontend scheduled to start on http://localhost:8080"

echo "----------------------------------------"
echo "Press Ctrl+C to stop both servers."
echo "----------------------------------------"

# Wait for background processes
wait
