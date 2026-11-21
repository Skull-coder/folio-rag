export type DocumentStatus =
  | 'queued'
  | 'extracting'
  | 'chunking'
  | 'embedding'
  | 'storing'
  | 'indexed'
  | 'failed';

export interface PdfDocumentRecord {
  id: string;
  filename: string;
  storedFilename: string;
  fileSize: number;
  pageCount: number;
  chunkCount: number;
  status: DocumentStatus;
  progress: number;
  stageLabel: string;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentChunkRecord {
  id: string;
  documentId: string;
  filename: string;
  pageNumber: number;
  chunkIndex: number;
  text: string;
}

export interface IngestionJobRecord {
  id: string;
  documentId: string;
  filename: string;
  status: DocumentStatus;
  progress: number;
  stageLabel: string;
  detail: string;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CitationSource {
  documentId: string;
  filename: string;
  pageNumber: number;
  chunkIndex: number;
  excerpt: string;
  score: number;
}

export interface ContextUsageSummary {
  model: string;
  numCtx: number;
  historyMessagesIncluded: number;
  totalMessagesInChat: number;
  retrievedChunks: number;
  selectedDocumentsCount: number;
  estimatedPromptTokens: number;
}

export interface ChatMessageRecord {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  sources?: CitationSource[];
  attachedDocIds?: string[];
  contextUsage?: ContextUsageSummary;
  createdAt: string;
}

export interface ChatThreadRecord {
  id: string;
  title: string;
  documentIds: string[];
  model?: string;
  numCtx?: number;
  messages: ChatMessageRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface OllamaModelInfo {
  name: string;
  sizeBytes: number;
  parameterSize?: string;
  family?: string;
  maxContextLength: number;
  defaultNumCtx: number;
}

export interface RuntimeHealth {
  mongodb: {
    connected: boolean;
    mode: 'mongodb' | 'local-file';
    uri: string;
    error?: string;
  };
  chromadb: {
    connected: boolean;
    mode: 'chromadb' | 'local-file';
    url: string;
    collection: string;
    error?: string;
  };
  ollama: {
    connected: boolean;
    url: string;
    chatModel: string;
    embedModel: string;
    hasChatModel: boolean;
    hasEmbedModel: boolean;
    availableModels: string[];
    error?: string;
  };
}
