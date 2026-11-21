import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, RefreshCw, Terminal } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/src/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/src/components/ui/dialog';
import { useHealthQuery } from '@/src/hooks/useRagQueries';

interface RuntimeStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RuntimeStatusDialog({
  open,
  onOpenChange,
}: RuntimeStatusDialogProps) {
  const queryClient = useQueryClient();
  const { data: health, isFetching, refetch } = useHealthQuery();
  const [copiedCmd, setCopiedCmd] = React.useState<string | null>(null);

  const copyCommand = async (cmd: string) => {
    await navigator.clipboard.writeText(cmd);
    setCopiedCmd(cmd);
    toast.success('Copied command');
    setTimeout(() => setCopiedCmd(null), 1500);
  };

  const isRemoteHost =
    typeof window !== 'undefined' &&
    !['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);

  const commands = [
    'docker compose up -d',
    'ollama pull qwen3:4b',
    'ollama pull nomic-embed-text',
  ];

  const cloudProviders = [
    {
      name: 'Google Gemini (Flash)',
      envKey: 'GEMINI_API_KEY',
      configured: Boolean(health?.providers?.gemini),
      source: health?.providerSources?.gemini,
      models: 'gemini-4-hydrogen · gemini-3.1-flash-lite (1M ctx)',
    },
    {
      name: 'OpenAI (ChatGPT)',
      envKey: 'OPENAI_API_KEY',
      configured: Boolean(health?.providers?.openai),
      source: health?.providerSources?.openai,
      models: 'gpt-4o · gpt-4o-mini · o3-mini (128K–200K ctx)',
    },
    {
      name: 'DeepSeek',
      envKey: 'DEEPSEEK_API_KEY',
      configured: Boolean(health?.providers?.deepseek),
      source: health?.providerSources?.deepseek,
      models: 'deepseek-chat · deepseek-reasoner (64K ctx)',
    },
    {
      name: 'Anthropic Claude',
      envKey: 'ANTHROPIC_API_KEY',
      configured: Boolean(health?.providers?.anthropic),
      source: health?.providerSources?.anthropic,
      models: 'claude-sonnet-4-5 · claude-haiku-4-5 (200K ctx)',
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>AI Providers &amp; Local Runtime</DialogTitle>
          <DialogDescription>
            Status of local Ollama, Docker databases, and server-side cloud AI keys configured in .env or Secrets.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-3">
          {isRemoteHost && !health?.ollama.connected && (
            <div className="rounded-lg border border-[var(--highlight-border)]/50 bg-[var(--accent)] p-3 text-xs text-[#111111] dark:bg-neutral-800 dark:text-neutral-100">
              <strong>Cloud preview detected ({window.location.hostname}):</strong>{' '}
              This preview runs on a remote server and cannot reach{' '}
              <code className="font-mono">127.0.0.1:11434</code> on your laptop.
              Run <code className="font-mono">./start.sh</code> locally on{' '}
              <code className="font-mono">http://localhost:3000</code> for local Ollama,
              or configure a cloud key in Secrets to use Gemini, DeepSeek, or Claude here.
            </div>
          )}

          {/* Ollama */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">Ollama Local AI</span>
              <span
                className={
                  health?.ollama.connected
                    ? 'text-xs font-medium text-emerald-700 dark:text-emerald-400'
                    : 'text-xs font-medium text-amber-700 dark:text-amber-400'
                }
              >
                {health?.ollama.connected ? 'Connected' : 'Offline'}
              </span>
            </div>
            <p className="mt-1 font-mono text-xs text-[var(--muted-foreground)]">
              {health?.ollama.url || 'http://127.0.0.1:11434'}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted-foreground)]">
              <span>
                Chat:{' '}
                <strong className="font-mono text-[var(--foreground)]">
                  {health?.ollama.chatModel || 'qwen3:4b'}
                </strong>{' '}
                ({health?.ollama.hasChatModel ? 'Installed' : 'Not found'})
              </span>
              <span>
                Embeddings:{' '}
                <strong className="font-mono text-[var(--foreground)]">
                  {health?.ollama.embedModel || 'nomic-embed-text'}
                </strong>{' '}
                ({health?.ollama.hasEmbedModel ? 'Installed' : 'Not found'})
              </span>
            </div>
            {!health?.ollama.connected && health?.ollama.error && (
              <p className="mt-2 font-mono text-[11px] text-amber-700 dark:text-amber-400">
                {health.ollama.error}
              </p>
            )}
          </div>

          {/* Cloud Providers (.env / Secrets) */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3.5 space-y-2.5">
            <div>
              <div className="text-sm font-semibold">
                Cloud Providers (via Server Environment)
              </div>
              <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                Add keys to <code className="font-mono">.env</code> in the project root locally (or Settings &gt; Secrets on cloud preview), then click Re-check connections.
              </p>
            </div>
            <div className="divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-[var(--background)]">
              {cloudProviders.map((p) => (
                <div
                  key={p.envKey}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-[var(--foreground)]">
                      {p.name}
                    </div>
                    <div className="truncate font-mono text-[11px] text-[var(--muted-foreground)]">
                      {p.envKey} · {p.models}
                    </div>
                  </div>
                  <span
                    className={
                      p.configured
                        ? 'shrink-0 font-medium text-emerald-700 dark:text-emerald-400'
                        : 'shrink-0 text-[var(--muted-foreground)]'
                    }
                  >
                    {p.configured
                      ? p.source === 'dotenv'
                        ? 'Configured (.env)'
                        : 'Configured (Host Env)'
                      : 'Not set'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* MongoDB */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">MongoDB (Documents &amp; Chats)</span>
              <span
                className={
                  health?.mongodb.connected
                    ? 'text-xs font-medium text-emerald-700 dark:text-emerald-400'
                    : 'text-xs font-medium text-amber-700 dark:text-amber-400'
                }
              >
                {health?.mongodb.connected ? 'Docker Connected' : 'Local File Fallback'}
              </span>
            </div>
            <p className="mt-1 font-mono text-xs text-[var(--muted-foreground)] truncate">
              {health?.mongodb.uri || 'mongodb://127.0.0.1:27017/foliorag'}
            </p>
          </div>

          {/* ChromaDB */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">ChromaDB (Vector Store)</span>
              <span
                className={
                  health?.chromadb.connected
                    ? 'text-xs font-medium text-emerald-700 dark:text-emerald-400'
                    : 'text-xs font-medium text-amber-700 dark:text-amber-400'
                }
              >
                {health?.chromadb.connected ? 'Docker Connected' : 'Local File Fallback'}
              </span>
            </div>
            <p className="mt-1 font-mono text-xs text-[var(--muted-foreground)]">
              {health?.chromadb.url || 'http://127.0.0.1:8000'} · Collection:{' '}
              {health?.chromadb.collection || 'folio_pdf_chunks'}
            </p>
          </div>

          {/* Setup Commands */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--foreground)] mb-2">
              <Terminal className="h-3.5 w-3.5" />
              <span>Localhost Setup Commands</span>
            </div>
            <div className="space-y-1.5">
              {commands.map((cmd) => (
                <div
                  key={cmd}
                  className="flex items-center justify-between rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5"
                >
                  <code className="font-mono text-xs text-[var(--foreground)]">
                    {cmd}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copyCommand(cmd)}
                    className="rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)] cursor-pointer"
                    title="Copy command"
                  >
                    {copiedCmd === cmd ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void refetch();
              void queryClient.invalidateQueries({ queryKey: ['models'] });
            }}
            disabled={isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            <span>Re-check connections</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
