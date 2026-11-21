@echo off
setlocal enabledelayedexpansion

echo ==========================================
echo   Folio RAG - Localhost Startup Script
echo ==========================================

if not exist ".env" (
  if exist ".env.example" (
    copy ".env.example" ".env" >nul
    echo [1/5] Created .env from .env.example
  )
) else (
  echo [1/5] Using existing .env configuration
)

docker info >nul 2>&1
if errorlevel 1 (
  echo Error: Docker is not running. Please start Docker Desktop first.
  exit /b 1
)

echo [2/5] Starting MongoDB and ChromaDB Docker containers...
docker compose up -d

echo [3/5] Waiting for ChromaDB on port 8000...
timeout /t 4 /nobreak >nul

echo [4/5] Checking Ollama local models...
where ollama >nul 2>&1
if not errorlevel 1 (
  ollama list | findstr /i "nomic-embed-text" >nul || (
    echo Pulling nomic-embed-text...
    ollama pull nomic-embed-text
  )
  ollama list | findstr /i "qwen3:4b" >nul || (
    echo Pulling qwen3:4b...
    ollama pull qwen3:4b
  )
) else (
  echo Warning: Ollama not found. Install from https://ollama.com and pull qwen3:4b + nomic-embed-text.
)

if not exist "node_modules" (
  echo [5/5] Installing npm dependencies...
  call npm install
)

echo Starting Folio RAG at http://localhost:3000 ...
call npm run dev
