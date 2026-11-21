#!/usr/bin/env bash
set -euo pipefail

echo "=========================================="
echo "  Folio RAG — Localhost Startup Script"
echo "=========================================="

# 1. Create .env from .env.example if missing
if [ ! -f ".env" ] && [ -f ".env.example" ]; then
  cp .env.example .env
  echo "[1/5] Created .env from .env.example"
else
  echo "[1/5] Using existing .env configuration"
fi

# 2. Verify Docker is running and start MongoDB + ChromaDB
if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker is not installed. Please install Docker Desktop first."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Error: Docker daemon is not running. Please start Docker Desktop and retry."
  exit 1
fi

echo "[2/5] Starting MongoDB & ChromaDB Docker containers..."
if docker compose version >/dev/null 2>&1; then
  docker compose up -d
else
  docker-compose up -d
fi

# 3. Wait for ChromaDB & MongoDB to respond
echo "[3/5] Waiting for MongoDB (27017) and ChromaDB (8000)..."
for i in $(seq 1 30); do
  if (curl -sf http://127.0.0.1:8000/api/v2/heartbeat >/dev/null 2>&1 || curl -sf http://127.0.0.1:8000/api/v1/heartbeat >/dev/null 2>&1); then
    echo "      ChromaDB is ready."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "      Warning: ChromaDB did not respond within 30s; check 'docker logs foliorag-chroma'."
  fi
  sleep 1
done

# 4. Verify Ollama and required local models
echo "[4/5] Checking Ollama local models (qwen3:4b & nomic-embed-text)..."
if command -v ollama >/dev/null 2>&1; then
  if ! curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    echo "      Starting Ollama background service..."
    nohup ollama serve >/dev/null 2>&1 &
    sleep 2
  fi

  if curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    MODELS=$(curl -s http://127.0.0.1:11434/api/tags)
    if ! echo "$MODELS" | grep -q "nomic-embed-text"; then
      echo "      Pulling embedding model: nomic-embed-text..."
      ollama pull nomic-embed-text
    fi
    if ! echo "$MODELS" | grep -q "qwen3:4b"; then
      echo "      Pulling chat model: qwen3:4b..."
      ollama pull qwen3:4b
    fi
    echo "      Ollama models are ready."
  else
    echo "      Warning: Could not reach Ollama at http://127.0.0.1:11434. Start Ollama manually."
  fi
else
  echo "      Warning: Ollama CLI not found. Install from https://ollama.com and run:"
  echo "        ollama pull qwen3:4b"
  echo "        ollama pull nomic-embed-text"
fi

# 5. Install Node dependencies if needed and start app on localhost:3000
if [ ! -d "node_modules" ]; then
  echo "[5/5] Installing npm dependencies..."
  npm install
else
  echo "[5/5] Dependencies already installed."
fi

echo "Starting Folio RAG at http://localhost:3000 ..."
npm run dev
