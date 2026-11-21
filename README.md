# Folio RAG — Personal AI Document Assistant (Self-Hosted)

A self-hosted Retrieval-Augmented Generation (RAG) workspace for uploading PDF documents, extracting and indexing their content in the background, and chatting with them locally using open-source AI models.

## Architecture & Stack

- **Frontend:** React + TypeScript + Tailwind CSS + shadcn/ui + TanStack Query
- **Backend:** Express + Node.js (`server.ts`) with asynchronous background ingestion queue
- **LLM (Chat):** `qwen3:4b` via Ollama
- **Embedding Model:** `nomic-embed-text` via Ollama
- **Vector Database:** ChromaDB (`chromadb/chroma:latest` via Docker)
- **Document & Chat Database:** MongoDB (`mongo:7` via Docker)

---

## Prerequisites

Install these three tools on your local machine before starting:

1. **Node.js 20+** — [https://nodejs.org](https://nodejs.org)
2. **Docker Desktop** (or Docker Engine + Compose) — [https://www.docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop)
3. **Ollama** — [https://ollama.com](https://ollama.com)

---

## Required AI Models (Ollama)

Pull both local models before uploading PDFs or starting a chat:

```bash
# 1. Chat / Reasoning LLM
ollama pull qwen3:4b

# 2. Vector Embedding Model
ollama pull nomic-embed-text
```

Verify they are installed:

```bash
ollama list
```

Make sure the Ollama service is running (`ollama serve` or open the Ollama desktop app). It listens on `http://127.0.0.1:11434`.

---

## Required Docker Images

The `docker-compose.yml` file pulls and runs two containers:

| Service | Docker Image | Port | Purpose |
|---|---|---|---|
| MongoDB | `mongo:7` | `27017` | Stores PDF metadata, background job progress, and chat threads |
| ChromaDB | `chromadb/chroma:latest` | `8000` | Stores `nomic-embed-text` vector embeddings and page metadata |

You can pre-pull them manually if desired:

```bash
docker pull mongo:7
docker pull chromadb/chroma:latest
```

---

## Quick Start (One Command)

### macOS / Linux

```bash
chmod +x start.sh
./start.sh
```

### Windows

```bat
start.bat
```

The startup script automatically:
1. Creates `.env` from `.env.example` if missing
2. Starts MongoDB and ChromaDB containers via `docker compose up -d`
3. Checks Ollama and pulls `qwen3:4b` and `nomic-embed-text` if needed
4. Installs npm dependencies (`npm install`)
5. Launches the app on **http://localhost:3000**

---

## Manual Setup (Step-by-Step)

```bash
# 1. Copy environment variables
cp .env.example .env

# 2. Start databases in Docker
docker compose up -d

# 3. Pull Ollama models
ollama pull qwen3:4b
ollama pull nomic-embed-text

# 4. Install dependencies & run
npm install
npm run dev
```

Open **http://localhost:3000** in your browser.

---

## Optional Cloud Models (Gemini, ChatGPT, DeepSeek, Claude)

By default, Folio RAG runs 100% locally with Ollama (`qwen3:4b` + `nomic-embed-text`). If you want faster cloud inference or larger context windows (up to 1M tokens), set any of these variables in your `.env` file and restart the server—those models will automatically unlock in the chat model dropdown with scaled context windows:

```env
GEMINI_API_KEY=your_google_gemini_key       # Enables Gemini 4 Flash & Flash Lite (1M ctx)
OPENAI_API_KEY=your_openai_chatgpt_key      # Enables GPT-4o, GPT-4o mini & o3-mini (128K-200K ctx)
DEEPSEEK_API_KEY=your_deepseek_key         # Enables DeepSeek V3 Chat & R1 Reasoner (64K ctx)
ANTHROPIC_API_KEY=your_anthropic_key       # Enables Claude Sonnet 4.5 & Haiku 4.5 (200K ctx)
```

---

## Stopping Services

```bash
# Stop Docker containers (preserves volumes/data)
docker compose down

# Stop and delete all stored MongoDB & ChromaDB volumes
docker compose down -v
```
