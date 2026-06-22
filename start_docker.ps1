$ErrorActionPreference = "Stop"

Write-Host "Starting Learnstation using Optimized Docker..." -ForegroundColor Green
Write-Host "A .wslconfig file was created to limit Docker RAM to 4GB." -ForegroundColor Cyan
Write-Host "If this is your first time running this script, you may need to restart Docker Desktop for the RAM limits to apply." -ForegroundColor Yellow

Start-Sleep -Seconds 2

# Clean up dangling images to save space
Write-Host "Cleaning up old unused Docker images to save space..." -ForegroundColor Cyan
docker system prune -f

# Start the stack
Write-Host "Building and starting all containers..." -ForegroundColor Green
docker compose up --build -d
