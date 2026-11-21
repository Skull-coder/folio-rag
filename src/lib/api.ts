import {
  ChatMessage,
  ChatSummary,
  ChatThread,
  CitationSource,
  ContextUsageSummary,
  DocumentChunk,
  IngestionJob,
  OllamaModelInfo,
  PdfDocument,
  ProviderStatusMap,
  RuntimeHealth,
} from './types';

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  getHealth: () => apiJson<RuntimeHealth>('/api/health'),

  listModels: () =>
    apiJson<{
      connected: boolean;
      defaultModel: string;
      providers: ProviderStatusMap;
      models: OllamaModelInfo[];
    }>('/api/models'),

  listDocuments: () =>
    apiJson<{ documents: PdfDocument[] }>('/api/documents').then((d) => d.documents),

  getDocumentDetail: (id: string) =>
    apiJson<{ document: PdfDocument; chunks: DocumentChunk[] }>(
      `/api/documents/${encodeURIComponent(id)}`
    ),

  uploadPdfs: async (
    files: File[]
  ): Promise<{ documents: PdfDocument[]; jobs: IngestionJob[] }> => {
    const form = new FormData();
    for (const file of files) {
      form.append('files', file);
    }
    const res = await fetch('/api/documents/upload', {
      method: 'POST',
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Upload failed (${res.status})`);
    }
    return data as { documents: PdfDocument[]; jobs: IngestionJob[] };
  },

  retryDocument: (id: string) =>
    apiJson<{ document: PdfDocument; job: IngestionJob }>(
      `/api/documents/${encodeURIComponent(id)}/retry`,
      { method: 'POST' }
    ),

  deleteDocument: (id: string) =>
    apiJson<{ deleted: boolean; id: string }>(
      `/api/documents/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    ),

  listJobs: () =>
    apiJson<{ jobs: IngestionJob[] }>('/api/jobs').then((d) => d.jobs),

  listChats: () =>
    apiJson<{ chats: ChatSummary[] }>('/api/chats').then((d) => d.chats),

  getChat: (id: string) =>
    apiJson<{ chat: ChatThread }>(`/api/chats/${encodeURIComponent(id)}`).then(
      (d) => d.chat
    ),

  createChat: (params: {
    documentIds: string[];
    title?: string;
    model?: string;
    numCtx?: number;
  }) =>
    apiJson<{ chat: ChatThread }>('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }).then((d) => d.chat),

  updateChatSettings: (
    id: string,
    patch: { title?: string; model?: string; numCtx?: number | null }
  ) =>
    apiJson<{ chat: ChatThread }>(`/api/chats/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then((d) => d.chat),

  updateChatDocuments: (id: string, documentIds: string[]) =>
    apiJson<{ chat: ChatThread }>(
      `/api/chats/${encodeURIComponent(id)}/documents`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentIds }),
      }
    ).then((d) => d.chat),

  deleteChat: (id: string) =>
    apiJson<{ deleted: boolean; id: string }>(
      `/api/chats/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    ),

  streamChatMessage: async (
    chatId: string,
    payload: {
      content: string;
      documentIds: string[];
      model?: string;
      numCtx?: number;
    },
    callbacks: {
      onContext?: (contextUsage: ContextUsageSummary) => void;
      onSources: (sources: CitationSource[]) => void;
      onThinking: (chunk: string) => void;
      onToken: (chunk: string) => void;
      onDone: (data: { message: ChatMessage; chatTitle: string }) => void;
      onError: (error: string) => void;
    },
    signal?: AbortSignal
  ) => {
    const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });

    if (!res.ok || !res.body) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Request failed (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = 'message';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, '');
        if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          const rawJson = line.slice(5).trim();
          if (!rawJson) continue;
          try {
            const parsed = JSON.parse(rawJson);
            if (currentEvent === 'context') {
              if (parsed.contextUsage) callbacks.onContext?.(parsed.contextUsage);
            } else if (currentEvent === 'sources') {
              callbacks.onSources(parsed.sources || []);
            } else if (currentEvent === 'thinking') {
              callbacks.onThinking(parsed.text || '');
            } else if (currentEvent === 'token') {
              callbacks.onToken(parsed.text || '');
            } else if (currentEvent === 'done') {
              callbacks.onDone(parsed);
            } else if (currentEvent === 'error') {
              callbacks.onError(parsed.error || 'Unknown streaming error');
            }
          } catch {
            // ignore incomplete SSE JSON fragments
          }
        } else if (line === '') {
          currentEvent = 'message';
        }
      }
    }
  },
};
