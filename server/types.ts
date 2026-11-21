export type DocumentStatus =
  | 'queued'
  | 'extracting'
  | 'chunking'
  | 'embedding'
  | 'storing'
  | 'indexed'
  | 'failed';

export type ModelProvider = 'ollama' | 'gemini' | 'openai' | 'deepseek' | 'anthropic';

export interface PdfDocument {
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

export interface DocumentChunk {
  id: string;
  documentId: string;
  filename: string;
  pageNumber: number;
  chunkIndex: number;
  text: string;
}

export interface IngestionJob {
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
  provider: ModelProvider;
  numCtx: number;
  historyMessagesIncluded: number;
  totalMessagesInChat: number;
  retrievedChunks: number;
  selectedDocumentsCount: number;
  estimatedPromptTokens: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  sources?: CitationSource[];
  attachedDocIds?: string[];
  contextUsage?: ContextUsageSummary;
  createdAt: string;
}

export interface ChatSummary {
  id: string;
  title: string;
  documentIds: string[];
  model?: string;
  numCtx?: number;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChatThread {
  id: string;
  title: string;
  documentIds: string[];
  model?: string;
  numCtx?: number;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface OllamaModelInfo {
  name: string;
  label?: string;
  provider: ModelProvider;
  available: boolean;
  sizeBytes: number;
  parameterSize?: string;
  family?: string;
  maxContextLength: number;
  defaultNumCtx: number;
}

export interface ProviderStatusMap {
  ollama: boolean;
  gemini: boolean;
  openai: boolean;
  deepseek: boolean;
  anthropic: boolean;
}

export type ProviderKeySource = 'dotenv' | 'environment' | 'unset';

export interface ProviderSourceMap {
  gemini: ProviderKeySource;
  openai: ProviderKeySource;
  deepseek: ProviderKeySource;
  anthropic: ProviderKeySource;
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
  providers: ProviderStatusMap;
  providerSources?: ProviderSourceMap;
}
