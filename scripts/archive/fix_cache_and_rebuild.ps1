Write-Host "Removing corrupted virtual environment..." -ForegroundColor Yellow
Remove-Item -Recurse -Force .venv -ErrorAction SilentlyContinue

Write-Host "Creating fresh virtual environment using explicit Python 3.11..." -ForegroundColor Yellow
& "C:\Users\Osama\AppData\Local\Programs\Python\Python311\python.exe" -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip

Write-Host "Downloading and installing all packages cleanly from the internet..." -ForegroundColor Yellow
.\.venv\Scripts\pip.exe install --no-cache-dir -r backend/requirements-docker.txt
.\.venv\Scripts\pip.exe install --no-cache-dir "litellm[proxy]" python-dotenv

Write-Host "Done!" -ForegroundColor Green
