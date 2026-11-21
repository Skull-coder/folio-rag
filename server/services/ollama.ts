import http from 'http';
import https from 'https';
import { OllamaModelInfo } from '../types.ts';

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const EMBED_MODEL_PATTERNS = [
  'embed',
  'nomic',
  'mxbai',
  'bge-',
  'all-minilm',
  'snowflake-arctic',
];

function inferFallbackContextLength(modelName: string): number {
  const lower = modelName.toLowerCase();
  if (
    lower.includes('qwen3') ||
    lower.includes('qwen2.5') ||
    lower.includes('mistral') ||
    lower.includes('deepseek')
  ) {
    return 32768;
  }
  if (
    lower.includes('llama3.1') ||
    lower.includes('llama3.2') ||
    lower.includes('llama3.3') ||
    lower.includes('gemma3') ||
    lower.includes('gemini')
  ) {
    return 131072;
  }
  if (lower.includes('gemma2') || lower.includes('phi3') || lower.includes('phi4')) {
    return 16384;
  }
  return 8192;
}

function formatNodeError(err: unknown): string {
  if (!(err instanceof Error)) return 'Unknown network error';
  const nodeErr = err as Error & {
    code?: string;
    cause?: { code?: string; message?: string };
  };
  const code = nodeErr.code || nodeErr.cause?.code;
  const msg = nodeErr.cause?.message || nodeErr.message;
  return code ? `${code}: ${msg}` : msg;
}

/**
 * Direct Node http/https JSON request — avoids undici proxy hijacking on 127.0.0.1
 * and surfaces exact socket error codes (e.g. ECONNREFUSED).
 */
function nodeHttpJson<T>(
  fullUrl: string,
  options: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number } = {}
): Promise<{ status: number; data: T; rawText: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(fullUrl);
    const transport = parsed.protocol === 'https:' ? https : http;
    const payload =
      options.body !== undefined ? JSON.stringify(options.body) : undefined;

    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: options.method || 'GET',
        headers: payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
            }
          : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const rawText = Buffer.concat(chunks).toString('utf-8');
          let data = {} as T;
          try {
            data = rawText ? (JSON.parse(rawText) as T) : ({} as T);
          } catch {
            // non-JSON response
          }
          resolve({ status: res.statusCode || 0, data, rawText });
        });
      }
    );

    if (options.timeoutMs) {
      req.setTimeout(options.timeoutMs, () => {
        req.destroy(new Error(`Request timed out after ${options.timeoutMs}ms`));
      });
    }

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

class OllamaService {
  private modelMetaCache = new Map<
    string,
    { maxContextLength: number; parameterSize?: string; family?: string; cachedAt: number }
  >();
  private resolvedBaseUrl: string | null = null;

  public getConfiguredBaseUrl(): string {
    return (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  }

  public getBaseUrl(): string {
    return this.resolvedBaseUrl || this.getConfiguredBaseUrl();
  }

  public getChatModel(): string {
    return process.env.OLLAMA_CHAT_MODEL || 'qwen3:4b';
  }

  public getEmbedModel(): string {
    return process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
  }

  private async resolveReachableUrl(): Promise<string> {
    const primary = this.getConfiguredBaseUrl();
    const candidates = [primary];
    if (primary.includes('127.0.0.1')) {
      candidates.push(primary.replace('127.0.0.1', 'localhost'));
    } else if (primary.includes('localhost')) {
      candidates.push(primary.replace('localhost', '127.0.0.1'));
    }

    for (const candidate of candidates) {
      try {
        const res = await nodeHttpJson(`${candidate}/api/tags`, {
          method: 'GET',
          timeoutMs: 3000,
        });
        if (res.status >= 200 && res.status < 300) {
          this.resolvedBaseUrl = candidate;
          return candidate;
        }
      } catch {
        // try next candidate
      }
    }

    return primary;
  }

  private modelMatches(installedName: string, targetName: string): boolean {
    const a = installedName.toLowerCase();
    const b = targetName.toLowerCase();
    return a === b || a === `${b}:latest` || a.startsWith(`${b}:`);
  }

  private isEmbeddingOnlyModel(modelName: string): boolean {
    const lower = modelName.toLowerCase();
    return EMBED_MODEL_PATTERNS.some((pat) => lower.includes(pat));
  }

  private async resolveInstalledModelTag(
    baseUrl: string,
    targetModel: string
  ): Promise<string> {
    try {
      const res = await nodeHttpJson<{ models?: Array<{ name: string }> }>(
        `${baseUrl}/api/tags`,
        { method: 'GET', timeoutMs: 3000 }
      );
      if (res.status >= 200 && res.status < 300 && Array.isArray(res.data.models)) {
        const match = res.data.models.find((m) =>
          this.modelMatches(m.name, targetModel)
        );
        if (match) return match.name;
      }
    } catch {
      // fall back to configured name
    }
    return targetModel;
  }

  public async getModelSpecs(modelName: string): Promise<{
    maxContextLength: number;
    parameterSize?: string;
    family?: string;
  }> {
    const cached = this.modelMetaCache.get(modelName);
    if (cached && Date.now() - cached.cachedAt < 5 * 60_000) {
      return {
        maxContextLength: cached.maxContextLength,
        parameterSize: cached.parameterSize,
        family: cached.family,
      };
    }

    const fallbackCtx = inferFallbackContextLength(modelName);
    try {
      const baseUrl = await this.resolveReachableUrl();
      const res = await nodeHttpJson<{
        details?: { parameter_size?: string; family?: string };
        model_info?: Record<string, unknown>;
        parameters?: string;
      }>(`${baseUrl}/api/show`, {
        method: 'POST',
        body: { model: modelName },
        timeoutMs: 4000,
      });

      if (res.status < 200 || res.status >= 300) {
        return { maxContextLength: fallbackCtx };
      }

      const data = res.data;
      let detectedCtx = fallbackCtx;

      if (data.model_info && typeof data.model_info === 'object') {
        for (const [key, val] of Object.entries(data.model_info)) {
          if (key.endsWith('.context_length') && typeof val === 'number' && val > 0) {
            detectedCtx = val;
            break;
          }
        }
      }

      if (typeof data.parameters === 'string') {
        const match = data.parameters.match(/num_ctx\s+(\d+)/i);
        if (match) {
          const parsed = Number(match[1]);
          if (Number.isFinite(parsed) && parsed >= 2048) {
            detectedCtx = Math.min(detectedCtx, parsed);
          }
        }
      }

      const entry = {
        maxContextLength: detectedCtx,
        parameterSize: data.details?.parameter_size,
        family: data.details?.family,
        cachedAt: Date.now(),
      };
      this.modelMetaCache.set(modelName, entry);
      return {
        maxContextLength: entry.maxContextLength,
        parameterSize: entry.parameterSize,
        family: entry.family,
      };
    } catch {
      return { maxContextLength: fallbackCtx };
    }
  }

  public async listChatModels(): Promise<{
    connected: boolean;
    defaultModel: string;
    models: OllamaModelInfo[];
  }> {
    const defaultModel = this.getChatModel();
    try {
      const baseUrl = await this.resolveReachableUrl();
      const res = await nodeHttpJson<{
        models?: Array<{
          name: string;
          size?: number;
          details?: { parameter_size?: string; family?: string };
        }>;
      }>(`${baseUrl}/api/tags`, { method: 'GET', timeoutMs: 4000 });

      if (res.status < 200 || res.status >= 300) {
        throw new Error(`HTTP ${res.status}`);
      }

      const rawModels = (res.data.models || []).filter(
        (m) => !this.isEmbeddingOnlyModel(m.name)
      );

      const detailed = await Promise.all(
        rawModels.map(async (m) => {
          const specs = await this.getModelSpecs(m.name);
          const maxCtx = specs.maxContextLength;
          return {
            name: m.name,
            sizeBytes: m.size || 0,
            parameterSize: specs.parameterSize || m.details?.parameter_size,
            family: specs.family || m.details?.family,
            maxContextLength: maxCtx,
            defaultNumCtx: Math.max(4096, Math.min(maxCtx, 32768)),
          } satisfies OllamaModelInfo;
        })
      );

      if (detailed.length === 0) {
        const fallbackMax = inferFallbackContextLength(defaultModel);
        detailed.push({
          name: defaultModel,
          sizeBytes: 0,
          parameterSize: '4B',
          family: 'qwen3',
          maxContextLength: fallbackMax,
          defaultNumCtx: Math.min(fallbackMax, 32768),
        });
      }

      return {
        connected: true,
        defaultModel:
          detailed.find((m) => this.modelMatches(m.name, defaultModel))?.name ||
          detailed[0].name,
        models: detailed,
      };
    } catch {
      const fallbackMax = inferFallbackContextLength(defaultModel);
      return {
        connected: false,
        defaultModel,
        models: [
          {
            name: defaultModel,
            sizeBytes: 0,
            parameterSize: '4B',
            family: 'qwen3',
            maxContextLength: fallbackMax,
            defaultNumCtx: Math.min(fallbackMax, 32768),
          },
        ],
      };
    }
  }

  public async getStatus() {
    const chatModel = this.getChatModel();
    const embedModel = this.getEmbedModel();
    const url = await this.resolveReachableUrl();

    try {
      const res = await nodeHttpJson<{ models?: Array<{ name: string }> }>(
        `${url}/api/tags`,
        { method: 'GET', timeoutMs: 3500 }
      );
      if (res.status < 200 || res.status >= 300) {
        return {
          connected: false,
          url,
          chatModel,
          embedModel,
          hasChatModel: false,
          hasEmbedModel: false,
          availableModels: [],
          error: `Ollama returned HTTP ${res.status}`,
        };
      }
      const availableModels = (res.data.models || []).map((m) => m.name);
      const hasChatModel = availableModels.some((m) =>
        this.modelMatches(m, chatModel)
      );
      const hasEmbedModel = availableModels.some((m) =>
        this.modelMatches(m, embedModel)
      );

      return {
        connected: true,
        url,
        chatModel,
        embedModel,
        hasChatModel,
        hasEmbedModel,
        availableModels,
      };
    } catch (err) {
      return {
        connected: false,
        url,
        chatModel,
        embedModel,
        hasChatModel: false,
        hasEmbedModel: false,
        availableModels: [],
        error: formatNodeError(err),
      };
    }
  }

  public async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const url = await this.resolveReachableUrl();
    const configuredModel = this.getEmbedModel();
    const model = await this.resolveInstalledModelTag(url, configuredModel);

    let embedRes: {
      status: number;
      data: { embeddings?: number[][]; error?: string };
      rawText: string;
    };
    try {
      embedRes = await nodeHttpJson<{ embeddings?: number[][]; error?: string }>(
        `${url}/api/embed`,
        {
          method: 'POST',
          body: { model, input: texts },
          timeoutMs: 120_000,
        }
      );
    } catch (err) {
      throw new Error(
        `Cannot reach Ollama at ${url} (${formatNodeError(err)}). Ensure Ollama is running locally and run the app on http://localhost:3000.`
      );
    }

    if (
      embedRes.status >= 200 &&
      embedRes.status < 300 &&
      Array.isArray(embedRes.data.embeddings) &&
      embedRes.data.embeddings.length === texts.length
    ) {
      return embedRes.data.embeddings;
    }

    if (embedRes.status === 404) {
      const vectors: number[][] = [];
      for (const prompt of texts) {
        const legacyRes = await nodeHttpJson<{ embedding?: number[]; error?: string }>(
          `${url}/api/embeddings`,
          {
            method: 'POST',
            body: { model, prompt },
            timeoutMs: 60_000,
          }
        );
        if (legacyRes.status < 200 || legacyRes.status >= 300) {
          throw new Error(
            `Ollama embedding error (${legacyRes.status}): ${
              legacyRes.data.error || legacyRes.rawText || `Run "ollama pull ${model}"`
            }`
          );
        }
        if (!Array.isArray(legacyRes.data.embedding)) {
          throw new Error('Ollama returned an invalid embedding vector.');
        }
        vectors.push(legacyRes.data.embedding);
      }
      return vectors;
    }

    throw new Error(
      `Ollama embedding failed (${embedRes.status}): ${
        embedRes.data.error ||
        embedRes.rawText ||
        `Ensure "${configuredModel}" is installed via "ollama pull ${configuredModel}".`
      }`
    );
  }

  public async streamChat(
    messages: OllamaChatMessage[],
    handlers: {
      onToken: (text: string) => void;
      onThinking?: (text: string) => void;
    },
    options?: {
      model?: string;
      numCtx?: number;
      signal?: AbortSignal;
    }
  ): Promise<void> {
    const url = await this.resolveReachableUrl();
    const requestedModel = options?.model || this.getChatModel();
    const model = await this.resolveInstalledModelTag(url, requestedModel);
    const numCtx = Math.max(2048, options?.numCtx || 16384);

    await new Promise<void>((resolve, reject) => {
      const parsed = new URL(`${url}/api/chat`);
      const transport = parsed.protocol === 'https:' ? https : http;
      const payload = JSON.stringify({
        model,
        messages,
        stream: true,
        options: {
          temperature: 0.2,
          num_ctx: numCtx,
        },
      });

      const req = transport.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path: parsed.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          const status = res.statusCode || 0;
          if (status < 200 || status >= 300) {
            const errChunks: Buffer[] = [];
            res.on('data', (c: Buffer) => errChunks.push(c));
            res.on('end', () => {
              const errText = Buffer.concat(errChunks).toString('utf-8');
              reject(
                new Error(
                  `Ollama chat failed (${status}): ${
                    errText || `Ensure "${model}" is installed via "ollama pull ${model}".`
                  }`
                )
              );
            });
            return;
          }

          let buffer = '';
          let insideThinkTag = false;

          const emitContentWithThinkParsing = (rawChunk: string) => {
            let remaining = rawChunk;
            while (remaining.length > 0) {
              if (!insideThinkTag) {
                const openIdx = remaining.indexOf('<think>');
                if (openIdx === -1) {
                  handlers.onToken(remaining);
                  break;
                }
                if (openIdx > 0) {
                  handlers.onToken(remaining.slice(0, openIdx));
                }
                insideThinkTag = true;
                remaining = remaining.slice(openIdx + '<think>'.length);
              } else {
                const closeIdx = remaining.indexOf('</think>');
                if (closeIdx === -1) {
                  handlers.onThinking?.(remaining);
                  break;
                }
                if (closeIdx > 0) {
                  handlers.onThinking?.(remaining.slice(0, closeIdx));
                }
                insideThinkTag = false;
                remaining = remaining.slice(closeIdx + '</think>'.length);
              }
            }
          };

          res.on('data', (chunk: Buffer) => {
            buffer += chunk.toString('utf-8');
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              try {
                const json = JSON.parse(trimmed) as {
                  message?: { content?: string; thinking?: string };
                  error?: string;
                };
                if (json.error) {
                  reject(new Error(json.error));
                  req.destroy();
                  return;
                }
                if (json.message?.thinking) {
                  handlers.onThinking?.(json.message.thinking);
                }
                if (json.message?.content) {
                  emitContentWithThinkParsing(json.message.content);
                }
              } catch {
                // ignore partial NDJSON lines
              }
            }
          });

          res.on('end', () => resolve());
          res.on('error', (err) => reject(err));
        }
      );

      if (options?.signal) {
        if (options.signal.aborted) {
          req.destroy();
          resolve();
          return;
        }
        const onAbort = () => {
          req.destroy();
          resolve();
        };
        options.signal.addEventListener('abort', onAbort, { once: true });
      }

      req.on('error', (err) => {
        reject(
          new Error(
            `Cannot reach Ollama at ${url} (${formatNodeError(err)}). Start Ollama locally and run the app on http://localhost:3000.`
          )
        );
      });

      req.write(payload);
      req.end();
    });
  }
}

export const ollamaService = new OllamaService();
