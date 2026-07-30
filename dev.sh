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
lsof -ti :3000 | xargs kill -9 2>/dev/null && echo "  ↳ Port 3000 cleared." || echo "  ↳ Port 3000 already free."
sleep 1

# 1. Start Backend (FastAPI)
echo "----------------------------------------"
echo "Initializing Backend (FastAPI)..."
source .venv/bin/activate
# SECURITY: --host 127.0.0.1 keeps both dev servers on loopback only, so they
# are never reachable from the host's public IP / 0.0.0.0. Reach them from
# another machine via the university network or VPN (e.g. an SSH tunnel) — do
# not bind to 0.0.0.0 without prior IT-security approval.
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000 &
echo "✅ Backend scheduled to start on http://localhost:8000"

# 2. Start Frontend (Vite)
echo "----------------------------------------"
echo "Initializing Frontend (Vite)..."
npm run dev -- --host 127.0.0.1 --port 3000 --strictPort &
echo "✅ Frontend scheduled to start on http://localhost:3000"

echo "----------------------------------------"
echo "Press Ctrl+C to stop both servers."
echo "----------------------------------------"

# Wait for background processes
wait
