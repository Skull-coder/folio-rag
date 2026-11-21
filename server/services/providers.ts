import { GoogleGenAI, GenerateContentResponse } from '@google/genai';
import {
  ModelProvider,
  OllamaModelInfo,
  ProviderSourceMap,
  ProviderStatusMap,
} from '../types.ts';
import { getEnvKeySource } from './envLoader.ts';
import { OllamaChatMessage, ollamaService } from './ollama.ts';

interface CloudModelSpec {
  name: string;
  label: string;
  provider: Exclude<ModelProvider, 'ollama'>;
  maxContextLength: number;
  defaultNumCtx: number;
  family: string;
}

const CLOUD_MODELS: CloudModelSpec[] = [
  {
    name: 'gemini-4-hydrogen',
    label: 'Gemini 4 Flash',
    provider: 'gemini',
    family: 'Google Gemini',
    maxContextLength: 1048576,
    defaultNumCtx: 131072,
  },
  {
    name: 'gemini-3.1-flash-lite',
    label: 'Gemini Flash Lite',
    provider: 'gemini',
    family: 'Google Gemini',
    maxContextLength: 1048576,
    defaultNumCtx: 65536,
  },
  {
    name: 'gpt-4o',
    label: 'ChatGPT · GPT-4o',
    provider: 'openai',
    family: 'OpenAI ChatGPT',
    maxContextLength: 128000,
    defaultNumCtx: 65536,
  },
  {
    name: 'gpt-4o-mini',
    label: 'ChatGPT · GPT-4o mini',
    provider: 'openai',
    family: 'OpenAI ChatGPT',
    maxContextLength: 128000,
    defaultNumCtx: 65536,
  },
  {
    name: 'o3-mini',
    label: 'OpenAI o3-mini',
    provider: 'openai',
    family: 'OpenAI ChatGPT',
    maxContextLength: 200000,
    defaultNumCtx: 65536,
  },
  {
    name: 'deepseek-chat',
    label: 'DeepSeek V3 Chat',
    provider: 'deepseek',
    family: 'DeepSeek',
    maxContextLength: 65536,
    defaultNumCtx: 32768,
  },
  {
    name: 'deepseek-reasoner',
    label: 'DeepSeek R1 Reasoner',
    provider: 'deepseek',
    family: 'DeepSeek',
    maxContextLength: 65536,
    defaultNumCtx: 32768,
  },
  {
    name: 'claude-sonnet-4-5',
    label: 'Claude Sonnet 4.5',
    provider: 'anthropic',
    family: 'Anthropic Claude',
    maxContextLength: 200000,
    defaultNumCtx: 65536,
  },
  {
    name: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    provider: 'anthropic',
    family: 'Anthropic Claude',
    maxContextLength: 200000,
    defaultNumCtx: 65536,
  },
];

function hasConfiguredKey(envValue: string | undefined): boolean {
  if (!envValue) return false;
  const trimmed = envValue.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('MY_') || trimmed === 'YOUR_API_KEY') return false;
  return true;
}

export function getCloudProviderStatus(): {
  gemini: boolean;
  openai: boolean;
  deepseek: boolean;
  anthropic: boolean;
} {
  return {
    gemini: hasConfiguredKey(process.env.GEMINI_API_KEY),
    openai: hasConfiguredKey(process.env.OPENAI_API_KEY),
    deepseek: hasConfiguredKey(process.env.DEEPSEEK_API_KEY),
    anthropic: hasConfiguredKey(process.env.ANTHROPIC_API_KEY),
  };
}

export function getCloudProviderSources(): ProviderSourceMap {
  return {
    gemini: getEnvKeySource('GEMINI_API_KEY'),
    openai: getEnvKeySource('OPENAI_API_KEY'),
    deepseek: getEnvKeySource('DEEPSEEK_API_KEY'),
    anthropic: getEnvKeySource('ANTHROPIC_API_KEY'),
  };
}

export async function getAllProviderStatus(): Promise<ProviderStatusMap> {
  const ollama = await ollamaService.getStatus();
  const cloud = getCloudProviderStatus();
  return {
    ollama: ollama.connected,
    ...cloud,
  };
}

export async function getUnifiedModelCatalog(): Promise<{
  connected: boolean;
  defaultModel: string;
  providers: ProviderStatusMap;
  models: OllamaModelInfo[];
}> {
  const ollamaCatalog = await ollamaService.listChatModels();
  const cloud = getCloudProviderStatus();

  const cloudEntries: OllamaModelInfo[] = CLOUD_MODELS.map((spec) => ({
    name: spec.name,
    label: spec.label,
    provider: spec.provider,
    available: cloud[spec.provider],
    sizeBytes: 0,
    family: spec.family,
    maxContextLength: spec.maxContextLength,
    defaultNumCtx: spec.defaultNumCtx,
  }));

  const providers: ProviderStatusMap = {
    ollama: ollamaCatalog.connected,
    ...cloud,
  };

  let defaultModel = ollamaCatalog.defaultModel;
  if (!ollamaCatalog.connected && cloud.gemini) {
    defaultModel = 'gemini-4-hydrogen';
  } else if (!ollamaCatalog.connected && cloud.openai) {
    defaultModel = 'gpt-4o';
  } else if (!ollamaCatalog.connected && cloud.deepseek) {
    defaultModel = 'deepseek-chat';
  } else if (!ollamaCatalog.connected && cloud.anthropic) {
    defaultModel = 'claude-sonnet-4-5';
  }

  return {
    connected:
      ollamaCatalog.connected ||
      cloud.gemini ||
      cloud.openai ||
      cloud.deepseek ||
      cloud.anthropic,
    defaultModel,
    providers,
    models: [...ollamaCatalog.models, ...cloudEntries],
  };
}

export async function resolveModelRuntime(modelName: string): Promise<{
  provider: ModelProvider;
  maxContextLength: number;
  defaultNumCtx: number;
}> {
  const cloudSpec = CLOUD_MODELS.find((m) => m.name === modelName);
  if (cloudSpec) {
    return {
      provider: cloudSpec.provider,
      maxContextLength: cloudSpec.maxContextLength,
      defaultNumCtx: cloudSpec.defaultNumCtx,
    };
  }
  const specs = await ollamaService.getModelSpecs(modelName);
  return {
    provider: 'ollama',
    maxContextLength: specs.maxContextLength,
    defaultNumCtx: Math.max(4096, Math.min(specs.maxContextLength, 32768)),
  };
}

async function streamGeminiChat(
  model: string,
  systemPrompt: string,
  historyMessages: OllamaChatMessage[],
  currentPrompt: string,
  handlers: { onToken: (text: string) => void; onThinking?: (text: string) => void },
  signal?: AbortSignal
) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!hasConfiguredKey(apiKey)) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Add GEMINI_API_KEY to your .env file (or Settings > Secrets) and retry.'
    );
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const contents = [
    ...historyMessages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    {
      role: 'user',
      parts: [{ text: currentPrompt }],
    },
  ];

  const stream = await ai.models.generateContentStream({
    model,
    contents,
    config: {
      systemInstruction: systemPrompt,
    },
  });

  for await (const chunk of stream) {
    if (signal?.aborted) break;
    const c = chunk as GenerateContentResponse;
    if (c.text) {
      handlers.onToken(c.text);
    }
  }
}

async function streamOpenAIChat(
  model: string,
  messages: OllamaChatMessage[],
  handlers: { onToken: (text: string) => void; onThinking?: (text: string) => void },
  signal?: AbortSignal
) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!hasConfiguredKey(apiKey)) {
    throw new Error(
      'OPENAI_API_KEY is not configured on the server. Add OPENAI_API_KEY to your .env file (or Settings > Secrets) and retry.'
    );
  }

  const isReasoning = model.startsWith('o1') || model.startsWith('o3');
  const formattedMessages = messages.map((m) => ({
    role: m.role === 'system' && isReasoning ? 'developer' : m.role,
    content: m.content,
  }));

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: formattedMessages,
      stream: true,
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenAI API error (${res.status}): ${errText || 'Request failed'}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const parsed = JSON.parse(payload) as {
          choices?: Array<{
            delta?: { content?: string };
          }>;
        };
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) {
          handlers.onToken(content);
        }
      } catch {
        // ignore partial SSE JSON
      }
    }
  }
}

async function streamDeepSeekChat(
  model: string,
  messages: OllamaChatMessage[],
  handlers: { onToken: (text: string) => void; onThinking?: (text: string) => void },
  signal?: AbortSignal
) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!hasConfiguredKey(apiKey)) {
    throw new Error(
      'DEEPSEEK_API_KEY is not configured on the server. Add DEEPSEEK_API_KEY to your .env file (or Settings > Secrets) and retry.'
    );
  }

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '');
    throw new Error(`DeepSeek API error (${res.status}): ${errText || 'Request failed'}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const parsed = JSON.parse(payload) as {
          choices?: Array<{
            delta?: { content?: string; reasoning_content?: string };
          }>;
        };
        const delta = parsed.choices?.[0]?.delta;
        if (delta?.reasoning_content) {
          handlers.onThinking?.(delta.reasoning_content);
        }
        if (delta?.content) {
          handlers.onToken(delta.content);
        }
      } catch {
        // ignore partial SSE JSON
      }
    }
  }
}

async function streamAnthropicChat(
  model: string,
  systemPrompt: string,
  historyMessages: OllamaChatMessage[],
  currentPrompt: string,
  handlers: { onToken: (text: string) => void; onThinking?: (text: string) => void },
  signal?: AbortSignal
) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!hasConfiguredKey(apiKey)) {
    throw new Error(
      'ANTHROPIC_API_KEY is not configured on the server. Add ANTHROPIC_API_KEY to your .env file (or Settings > Secrets) and retry.'
    );
  }

  const anthropicMessages = [
    ...historyMessages.map((m) => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: m.content,
    })),
    { role: 'user' as const, content: currentPrompt },
  ];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: anthropicMessages,
      stream: true,
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Anthropic API error (${res.status}): ${errText || 'Request failed'}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      try {
        const parsed = JSON.parse(payload) as {
          type?: string;
          delta?: { type?: string; text?: string; thinking?: string };
          error?: { message?: string };
        };
        if (parsed.type === 'error' && parsed.error?.message) {
          throw new Error(parsed.error.message);
        }
        if (parsed.type === 'content_block_delta' && parsed.delta) {
          if (parsed.delta.type === 'thinking_delta' && parsed.delta.thinking) {
            handlers.onThinking?.(parsed.delta.thinking);
          } else if (parsed.delta.type === 'text_delta' && parsed.delta.text) {
            handlers.onToken(parsed.delta.text);
          }
        }
      } catch (err) {
        if (err instanceof SyntaxError) continue;
        throw err;
      }
    }
  }
}

export async function streamUnifiedModelChat(params: {
  provider: ModelProvider;
  model: string;
  numCtx: number;
  systemPrompt: string;
  historyMessages: OllamaChatMessage[];
  allMessages: OllamaChatMessage[];
  currentPrompt: string;
  handlers: {
    onToken: (text: string) => void;
    onThinking?: (text: string) => void;
  };
  signal?: AbortSignal;
}): Promise<void> {
  const {
    provider,
    model,
    numCtx,
    systemPrompt,
    historyMessages,
    allMessages,
    currentPrompt,
    handlers,
    signal,
  } = params;

  if (provider === 'gemini') {
    return streamGeminiChat(
      model,
      systemPrompt,
      historyMessages,
      currentPrompt,
      handlers,
      signal
    );
  }
  if (provider === 'openai') {
    return streamOpenAIChat(model, allMessages, handlers, signal);
  }
  if (provider === 'deepseek') {
    return streamDeepSeekChat(model, allMessages, handlers, signal);
  }
  if (provider === 'anthropic') {
    return streamAnthropicChat(
      model,
      systemPrompt,
      historyMessages,
      currentPrompt,
      handlers,
      signal
    );
  }

  return ollamaService.streamChat(allMessages, handlers, {
    model,
    numCtx,
    signal,
  });
}
