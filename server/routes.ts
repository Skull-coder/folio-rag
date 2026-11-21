import express, { Request, Response } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { chromaStore } from './services/chroma.ts';
import {
  buildContextualizedRetrievalQuery,
  buildContextWindow,
  computeTopKForContext,
} from './services/contextBuilder.ts';
import { reloadLocalEnv } from './services/envLoader.ts';
import {
  ingestionQueue,
  resolveUploadPath,
  UPLOADS_DIR,
} from './services/ingestionQueue.ts';
import { ollamaService } from './services/ollama.ts';
import {
  getAllProviderStatus,
  getCloudProviderSources,
  getUnifiedModelCatalog,
  resolveModelRuntime,
  streamUnifiedModelChat,
} from './services/providers.ts';
import { dataStore } from './services/store.ts';
import { ChatMessageRecord, ChatThreadRecord, PdfDocumentRecord } from './types.ts';

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function isValidId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{4,64}$/.test(value);
}

function sanitizeModelName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return /^[a-zA-Z0-9._:/-]{1,100}$/.test(trimmed) ? trimmed : undefined;
}

function sanitizeNumCtx(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  if (rounded < 2048 || rounded > 1048576) return undefined;
  return rounded;
}

function sanitizeDocIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const unique = new Set<string>();
  for (const item of raw) {
    if (isValidId(item)) {
      unique.add(item);
    }
  }
  return Array.from(unique);
}

function sanitizeDisplayFilename(originalName: string): string {
  const base = path.basename(originalName).replace(/[\r\n\0]/g, '').trim();
  return base || 'document.pdf';
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const safeStem = path
      .basename(file.originalname, path.extname(file.originalname))
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .slice(0, 48);
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    cb(null, `${safeStem || 'pdf'}_${unique}.pdf`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB max per PDF
    files: 5,
  },
  fileFilter: (_req, file, cb) => {
    const isPdfExt = path.extname(file.originalname).toLowerCase() === '.pdf';
    const isPdfMime =
      file.mimetype === 'application/pdf' ||
      file.mimetype === 'application/x-pdf' ||
      file.mimetype === 'application/octet-stream';
    if (!isPdfExt || !isPdfMime) {
      cb(new Error('Only valid PDF files (.pdf) are allowed.'));
      return;
    }
    cb(null, true);
  },
});

export function createApiRouter() {
  const router = express.Router();

  // Health & Runtime Connectivity
  router.get('/health', async (_req: Request, res: Response) => {
    try {
      reloadLocalEnv();
      const [mongodb, chromadb, ollama, providers] = await Promise.all([
        dataStore.getStatus(),
        chromaStore.getStatus(),
        ollamaService.getStatus(),
        getAllProviderStatus(),
      ]);
      const providerSources = getCloudProviderSources();
      res.json({ mongodb, chromadb, ollama, providers, providerSources });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Health check failed',
      });
    }
  });

  // Installed Ollama + Cloud Provider Models & Context Lengths
  router.get('/models', async (_req: Request, res: Response) => {
    try {
      reloadLocalEnv();
      const catalog = await getUnifiedModelCatalog();
      res.json(catalog);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to list AI models',
      });
    }
  });

  // List Documents
  router.get('/documents', async (_req: Request, res: Response) => {
    try {
      const documents = await dataStore.listDocuments();
      res.json({ documents });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to list documents',
      });
    }
  });

  // Get Single Document + Chunks Preview
  router.get('/documents/:id', async (req: Request, res: Response) => {
    const id = req.params.id;
    if (!isValidId(id)) {
      res.status(400).json({ error: 'Invalid document ID' });
      return;
    }
    try {
      const document = await dataStore.getDocument(id);
      if (!document) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }
      const chunks = await dataStore.getDocumentChunks(id, 80);
      res.json({ document, chunks });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to load document',
      });
    }
  });

  // Upload PDF(s) & Enqueue Background Processing
  router.post('/documents/upload', (req: Request, res: Response) => {
    upload.array('files', 5)(req, res, async (uploadErr: unknown) => {
      if (uploadErr) {
        const msg =
          uploadErr instanceof Error ? uploadErr.message : 'File upload failed';
        res.status(400).json({ error: msg });
        return;
      }

      const files = (req.files as Express.Multer.File[]) || [];
      if (files.length === 0) {
        res.status(400).json({ error: 'Please select at least one PDF file.' });
        return;
      }

      try {
        const createdDocs: PdfDocumentRecord[] = [];
        const jobs = [];

        for (const file of files) {
          const now = new Date().toISOString();
          const docId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const doc: PdfDocumentRecord = {
            id: docId,
            filename: sanitizeDisplayFilename(file.originalname),
            storedFilename: path.basename(file.filename),
            fileSize: file.size,
            pageCount: 0,
            chunkCount: 0,
            status: 'queued',
            progress: 0,
            stageLabel: 'Queued for background processing',
            error: null,
            createdAt: now,
            updatedAt: now,
          };

          await dataStore.upsertDocument(doc);
          const job = ingestionQueue.enqueue(doc);
          createdDocs.push(doc);
          jobs.push(job);
        }

        res.status(202).json({ documents: createdDocs, jobs });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Failed to enqueue PDF',
        });
      }
    });
  });

  // Retry failed document indexing
  router.post('/documents/:id/retry', async (req: Request, res: Response) => {
    const id = req.params.id;
    if (!isValidId(id)) {
      res.status(400).json({ error: 'Invalid document ID' });
      return;
    }
    try {
      const doc = await dataStore.getDocument(id);
      if (!doc) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }
      const filePath = resolveUploadPath(doc.storedFilename);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'Original PDF file no longer exists on disk.' });
        return;
      }
      const updated = await dataStore.updateDocument(id, {
        status: 'queued',
        progress: 0,
        stageLabel: 'Queued for retry',
        error: null,
      });
      const job = ingestionQueue.enqueue(updated || doc);
      res.status(202).json({ document: updated, job });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Retry failed',
      });
    }
  });

  // Delete Document + Vectors + File
  router.delete('/documents/:id', async (req: Request, res: Response) => {
    const id = req.params.id;
    if (!isValidId(id)) {
      res.status(400).json({ error: 'Invalid document ID' });
      return;
    }
    try {
      const doc = await dataStore.getDocument(id);
      if (!doc) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }

      await chromaStore.deleteByDocumentId(id);
      await dataStore.deleteDocument(id);

      try {
        const filePath = resolveUploadPath(doc.storedFilename);
        if (fs.existsSync(filePath)) {
          await fs.promises.unlink(filePath);
        }
      } catch {
        // Ignore missing disk file cleanup errors
      }

      res.json({ deleted: true, id });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to delete document',
      });
    }
  });

  // Background Processing Jobs Queue
  router.get('/jobs', async (_req: Request, res: Response) => {
    try {
      const jobs = await dataStore.listJobs(30);
      res.json({ jobs });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to load jobs',
      });
    }
  });

  // List Chats
  router.get('/chats', async (_req: Request, res: Response) => {
    try {
      const chats = await dataStore.listChats();
      const summaries = chats.map((c) => ({
        id: c.id,
        title: c.title,
        documentIds: c.documentIds,
        model: c.model,
        numCtx: c.numCtx,
        messageCount: c.messages.length,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }));
      res.json({ chats: summaries });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to load chats',
      });
    }
  });

  // Create Chat with Initial Selected PDFs & Model Config
  router.post('/chats', async (req: Request, res: Response) => {
    try {
      const documentIds = sanitizeDocIds(req.body?.documentIds);
      const rawTitle =
        typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 80) : '';
      const model = sanitizeModelName(req.body?.model) || ollamaService.getChatModel();
      const numCtx = sanitizeNumCtx(req.body?.numCtx);
      const now = new Date().toISOString();
      const chat: ChatThreadRecord = {
        id: `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title: rawTitle || 'New Chat',
        documentIds,
        model,
        numCtx,
        messages: [],
        createdAt: now,
        updatedAt: now,
      };
      await dataStore.createChat(chat);
      res.status(201).json({ chat });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to create chat',
      });
    }
  });

  // Get Chat Thread
  router.get('/chats/:id', async (req: Request, res: Response) => {
    const id = req.params.id;
    if (!isValidId(id)) {
      res.status(400).json({ error: 'Invalid chat ID' });
      return;
    }
    try {
      const chat = await dataStore.getChat(id);
      if (!chat) {
        res.status(404).json({ error: 'Chat not found' });
        return;
      }
      res.json({ chat });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to load chat',
      });
    }
  });

  // Update Chat Title / Model / Context Window
  router.patch('/chats/:id', async (req: Request, res: Response) => {
    const id = req.params.id;
    if (!isValidId(id)) {
      res.status(400).json({ error: 'Invalid chat ID' });
      return;
    }
    const patch: Partial<ChatThreadRecord> = {};
    if (typeof req.body?.title === 'string') {
      const title = req.body.title.trim().slice(0, 80);
      if (!title) {
        res.status(400).json({ error: 'Title cannot be empty' });
        return;
      }
      patch.title = title;
    }
    const model = sanitizeModelName(req.body?.model);
    if (model) {
      patch.model = model;
    }
    if (req.body?.numCtx === null) {
      patch.numCtx = undefined;
    } else {
      const numCtx = sanitizeNumCtx(req.body?.numCtx);
      if (numCtx) {
        patch.numCtx = numCtx;
      }
    }
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: 'No valid fields provided to update' });
      return;
    }
    try {
      const updated = await dataStore.updateChat(id, patch);
      if (!updated) {
        res.status(404).json({ error: 'Chat not found' });
        return;
      }
      res.json({ chat: updated });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to update chat',
      });
    }
  });

  // Update Attached PDFs Mid-Chat
  router.patch('/chats/:id/documents', async (req: Request, res: Response) => {
    const id = req.params.id;
    if (!isValidId(id)) {
      res.status(400).json({ error: 'Invalid chat ID' });
      return;
    }
    const documentIds = sanitizeDocIds(req.body?.documentIds);
    try {
      const updated = await dataStore.updateChat(id, { documentIds });
      if (!updated) {
        res.status(404).json({ error: 'Chat not found' });
        return;
      }
      res.json({ chat: updated });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to update chat documents',
      });
    }
  });

  // Delete Chat
  router.delete('/chats/:id', async (req: Request, res: Response) => {
    const id = req.params.id;
    if (!isValidId(id)) {
      res.status(400).json({ error: 'Invalid chat ID' });
      return;
    }
    try {
      await dataStore.deleteChat(id);
      res.json({ deleted: true, id });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to delete chat',
      });
    }
  });

  // Send Message & Stream RAG Answer via SSE
  router.post('/chats/:id/messages', async (req: Request, res: Response) => {
    reloadLocalEnv();
    const chatId = req.params.id;
    if (!isValidId(chatId)) {
      res.status(400).json({ error: 'Invalid chat ID' });
      return;
    }

    const rawContent =
      typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!rawContent || rawContent.length > 8000) {
      res.status(400).json({ error: 'Message content must be 1–8000 characters.' });
      return;
    }

    const chat = await dataStore.getChat(chatId);
    if (!chat) {
      res.status(404).json({ error: 'Chat not found' });
      return;
    }

    const requestedDocIds = sanitizeDocIds(req.body?.documentIds);
    const activeDocIds =
      requestedDocIds.length > 0 ? requestedDocIds : chat.documentIds;

    if (activeDocIds.length === 0) {
      res.status(400).json({
        error: 'Select at least one PDF document before asking a question.',
      });
      return;
    }

    const requestedModel = sanitizeModelName(req.body?.model);
    const requestedNumCtx = sanitizeNumCtx(req.body?.numCtx);
    const activeModel =
      requestedModel || chat.model || ollamaService.getChatModel();

    // Sync documentIds / model / numCtx onto chat thread if updated
    const chatSyncPatch: Partial<ChatThreadRecord> = {};
    if (
      requestedDocIds.length > 0 &&
      JSON.stringify(requestedDocIds) !== JSON.stringify(chat.documentIds)
    ) {
      chatSyncPatch.documentIds = activeDocIds;
    }
    if (requestedModel && requestedModel !== chat.model) {
      chatSyncPatch.model = requestedModel;
    }
    if (requestedNumCtx && requestedNumCtx !== chat.numCtx) {
      chatSyncPatch.numCtx = requestedNumCtx;
    }
    if (Object.keys(chatSyncPatch).length > 0) {
      await dataStore.updateChat(chatId, chatSyncPatch);
    }

    // Check which selected docs are indexed
    const allDocs = await dataStore.listDocuments();
    const docMap = new Map(allDocs.map((d) => [d.id, d]));
    const selectedDocs = activeDocIds
      .map((id) => docMap.get(id))
      .filter((d): d is PdfDocumentRecord => Boolean(d));
    const indexedDocIds = selectedDocs
      .filter((d) => d.status === 'indexed')
      .map((d) => d.id);

    if (indexedDocIds.length === 0) {
      const stillProcessing = activeDocIds.some((id) => {
        const st = docMap.get(id)?.status;
        return st && st !== 'failed' && st !== 'indexed';
      });
      res.status(409).json({
        error: stillProcessing
          ? 'Selected PDF(s) are still finishing background embedding. Please wait a moment until indexing reaches 100%.'
          : 'No indexed PDFs are attached. Please attach or retry indexing a PDF.',
      });
      return;
    }

    // Capture prior messages BEFORE appending the new user message
    const priorMessages = [...chat.messages];

    // Save user message immediately
    const userMessage: ChatMessageRecord = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      role: 'user',
      content: rawContent,
      attachedDocIds: indexedDocIds,
      createdAt: new Date().toISOString(),
    };

    const nextTitle =
      chat.messages.length === 0 && chat.title === 'New Chat'
        ? rawContent.replace(/\s+/g, ' ').slice(0, 52)
        : undefined;

    await dataStore.appendChatMessage(chatId, userMessage, nextTitle);

    // Setup SSE Stream
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const abortController = new AbortController();
    req.on('close', () => {
      abortController.abort();
    });

    try {
      // 1. Resolve selected model's provider and actual context window
      const runtime = await resolveModelRuntime(activeModel);
      const desiredCtx = requestedNumCtx || chat.numCtx || runtime.defaultNumCtx;
      const effectiveNumCtx = Math.max(
        4096,
        Math.min(desiredCtx, runtime.maxContextLength)
      );

      // 2. Contextualize retrieval query with recent conversation turns so follow-ups hit the right PDF sections
      const retrievalQuery = buildContextualizedRetrievalQuery(
        priorMessages,
        rawContent
      );
      const [queryEmbedding] = await ollamaService.embedBatch([retrievalQuery]);

      // 3. Semantic retrieval from ChromaDB scaled to the model's context window
      const topK = computeTopKForContext(effectiveNumCtx, indexedDocIds.length);
      const retrievedSources = await chromaStore.querySimilar(
        queryEmbedding,
        indexedDocIds,
        topK
      );

      // 4. Budget conversation history + selected PDF inventory + retrieved chunks to fit numCtx
      const {
        messages,
        systemPrompt,
        historyMessages,
        usedSources,
        contextUsage,
      } = buildContextWindow({
        model: activeModel,
        provider: runtime.provider,
        numCtx: effectiveNumCtx,
        selectedDocs,
        priorMessages,
        retrievedSources,
        currentPrompt: rawContent,
      });

      sendEvent('context', { contextUsage });
      sendEvent('sources', { sources: usedSources });

      let fullContent = '';
      let fullThinking = '';

      await streamUnifiedModelChat({
        provider: runtime.provider,
        model: activeModel,
        numCtx: effectiveNumCtx,
        systemPrompt,
        historyMessages,
        allMessages: messages,
        currentPrompt: rawContent,
        handlers: {
          onThinking: (chunk) => {
            fullThinking += chunk;
            sendEvent('thinking', { text: chunk });
          },
          onToken: (chunk) => {
            fullContent += chunk;
            sendEvent('token', { text: chunk });
          },
        },
        signal: abortController.signal,
      });

      const assistantMessage: ChatMessageRecord = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        role: 'assistant',
        content: fullContent.trim() || 'No response generated.',
        thinking: fullThinking.trim() || undefined,
        sources: usedSources,
        attachedDocIds: indexedDocIds,
        contextUsage,
        createdAt: new Date().toISOString(),
      };

      const updatedChat = await dataStore.appendChatMessage(chatId, assistantMessage);
      sendEvent('done', {
        message: assistantMessage,
        chatTitle: updatedChat?.title || nextTitle || chat.title,
      });
      res.end();
    } catch (err) {
      if (abortController.signal.aborted) {
        res.end();
        return;
      }
      const message =
        err instanceof Error ? err.message : 'Failed to generate AI response';
      sendEvent('error', { error: message });
      res.end();
    }
  });

  return router;
}
