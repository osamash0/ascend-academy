$ErrorActionPreference = "Stop"

Write-Host "🚀 Starting Learnstation Manually..." -ForegroundColor Green

# Start LiteLLM
Write-Host "Starting LiteLLM on port 4000..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "& { .\.venv\Scripts\litellm.exe --config litellm/config.yaml --port 4000 }"

Start-Sleep -Seconds 3

# Start Backend API
Write-Host "Starting Backend API on port 8000..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "& { .\.venv\Scripts\uvicorn.exe backend.main:app --reload --host 127.0.0.1 --port 8000 }"

Start-Sleep -Seconds 3

# Start Frontend
Write-Host "Starting Frontend Vite Server on port 8080..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "& { npm run dev -- --host 127.0.0.1 --port 8080 --strictPort }"

Write-Host "✅ All services have been launched in separate windows!" -ForegroundColor Green
Write-Host "⚠️ Please note: Redis requires a native Windows installation (e.g., Memurai) or WSL. Since WSL is currently unavailable, you may see Redis connection warnings in the backend window." -ForegroundColor Yellow
