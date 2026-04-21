#!/bin/bash

# Terminate background processes on exit
cleanup() {
    echo ""
    echo "Shutting down servers..."
    kill $(jobs -p)
    exit
}

trap cleanup EXIT

echo "🚀 Starting Learnstation in Unified Mode..."

# 1. Start Backend (FastAPI)
echo "----------------------------------------"
echo "Initializing Backend (FastAPI)..."
source .venv/bin/activate
uvicorn backend.main:app --reload --port 8000 &
echo "✅ Backend scheduled to start on http://localhost:8000"

# 2. Start Frontend (Vite)
echo "----------------------------------------"
echo "Initializing Frontend (Vite)..."
npm run dev -- --port 8080 &
echo "✅ Frontend scheduled to start on http://localhost:8080"

echo "----------------------------------------"
echo "Press Ctrl+C to stop both servers."
echo "----------------------------------------"

# Wait for background processes
wait
