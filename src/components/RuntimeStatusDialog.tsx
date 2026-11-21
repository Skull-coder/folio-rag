import React from 'react';
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Local AI & Database Runtime</DialogTitle>
          <DialogDescription>
            Status of your localhost Docker containers and Ollama models.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-3">
          {isRemoteHost && !health?.ollama.connected && (
            <div className="rounded-lg border border-[var(--highlight-border)]/50 bg-[var(--accent)] p-3 text-xs text-[#111111] dark:bg-neutral-800 dark:text-neutral-100">
              <strong>Cloud preview detected ({window.location.hostname}):</strong>{' '}
              This preview runs on a remote server and cannot reach{' '}
              <code className="font-mono">127.0.0.1:11434</code> on your laptop.
              Download the project and run <code className="font-mono">./start.sh</code>{' '}
              locally, then open <code className="font-mono">http://localhost:3000</code>.
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
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted-foreground)]">
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

          {/* MongoDB */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">MongoDB (Documents & Chats)</span>
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
            onClick={() => void refetch()}
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
