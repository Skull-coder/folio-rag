import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const ALLOWED_RUNTIME_KEYS = new Set([
  'MONGODB_URI',
  'CHROMA_URL',
  'CHROMA_COLLECTION',
  'OLLAMA_BASE_URL',
  'OLLAMA_CHAT_MODEL',
  'OLLAMA_EMBED_MODEL',
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'ANTHROPIC_API_KEY',
]);

export type KeySource = 'dotenv' | 'environment' | 'unset';

const dotenvLoadedValues = new Map<string, string>();
const currentDotenvKeys = new Set<string>();

/**
 * Re-reads .env from project root if it exists so users editing .env locally
 * while the dev server is running do not need to restart Node.
 * - Non-empty values in .env take effect immediately.
 * - Clearing a previously .env-loaded key in .env deletes it from process.env.
 * - Host-injected environment variables (e.g. AI Studio Secrets) are preserved
 *   when .env does not exist or leaves the key unset.
 */
export function reloadLocalEnv(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  currentDotenvKeys.clear();
  if (!fs.existsSync(envPath)) return;

  try {
    const raw = fs.readFileSync(envPath, 'utf-8');
    const parsed = dotenv.parse(raw);

    for (const [key, val] of Object.entries(parsed)) {
      if (!ALLOWED_RUNTIME_KEYS.has(key)) continue;
      const trimmed = val.trim();
      if (trimmed.length > 0) {
        process.env[key] = trimmed;
        dotenvLoadedValues.set(key, trimmed);
        currentDotenvKeys.add(key);
      } else if (
        dotenvLoadedValues.has(key) &&
        process.env[key] === dotenvLoadedValues.get(key)
      ) {
        delete process.env[key];
        dotenvLoadedValues.delete(key);
      }
    }
  } catch {
    // Ignore transient file read errors while user is saving .env
  }
}

export function getEnvKeySource(key: string): KeySource {
  const val = process.env[key]?.trim();
  if (!val || val.startsWith('MY_') || val === 'YOUR_API_KEY') {
    return 'unset';
  }
  if (currentDotenvKeys.has(key)) {
    return 'dotenv';
  }
  return 'environment';
}

reloadLocalEnv();
