import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowUp,
  CheckCircle2,
  FileText,
  Loader2,
  Search,
} from 'lucide-react';
import { ModelContextSelector } from '@/src/components/ModelContextSelector';
import { PdfUploadDropzone } from '@/src/components/PdfUploadDropzone';
import { Button } from '@/src/components/ui/button';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Input } from '@/src/components/ui/input';
import { Progress } from '@/src/components/ui/progress';
import { ScrollArea } from '@/src/components/ui/scroll-area';
import {
  ACTIVE_STATUSES,
  useDocumentsQuery,
  useModelsQuery,
} from '@/src/hooks/useRagQueries';
import { PdfDocument } from '@/src/lib/types';
import { cn, formatBytes } from '@/src/lib/utils';

interface NewChatScreenProps {
  onStartChat: (params: {
    documentIds: string[];
    initialPrompt?: string;
    model?: string;
    numCtx?: number;
  }) => void;
  isCreating: boolean;
  onOpenRuntime?: () => void;
}

const STARTER_PROMPTS = [
  'Summarize the main arguments and key takeaways with page references.',
  'Explain the most technical concepts in plain, clear language.',
  'Compare key findings and differences across the selected documents.',
];

export function NewChatScreen({
  onStartChat,
  isCreating,
  onOpenRuntime,
}: NewChatScreenProps) {
  const { data: documents = [], isLoading } = useDocumentsQuery();
  const { data: modelsData } = useModelsQuery();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [prompt, setPrompt] = useState('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [selectedNumCtx, setSelectedNumCtx] = useState<number | undefined>(
    undefined
  );

  const activeModel =
    selectedModel || modelsData?.defaultModel || 'qwen3:4b';

  const indexedDocs = useMemo(
    () => documents.filter((d) => d.status === 'indexed'),
    [documents]
  );

  const filteredDocs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter((d) => d.filename.toLowerCase().includes(q));
  }, [documents, search]);

  const toggleDoc = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleUploaded = (newDocs: PdfDocument[]) => {
    const newIds = newDocs.map((d) => d.id);
    setSelectedIds((prev) => Array.from(new Set([...prev, ...newIds])));
  };

  const selectedReadyCount = useMemo(() => {
    const readySet = new Set(indexedDocs.map((d) => d.id));
    return selectedIds.filter((id) => readySet.has(id)).length;
  }, [indexedDocs, selectedIds]);

  const selectedProcessingCount = useMemo(() => {
    const activeSet = new Set(
      documents.filter((d) => ACTIVE_STATUSES.has(d.status)).map((d) => d.id)
    );
    return selectedIds.filter((id) => activeSet.has(id)).length;
  }, [documents, selectedIds]);

  const canSend =
    selectedReadyCount > 0 && prompt.trim().length > 0 && !isCreating;

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (selectedIds.length === 0) return;
    const trimmed = prompt.trim();
    if (!trimmed && selectedReadyCount === 0) return;
    onStartChat({
      documentIds: selectedIds,
      initialPrompt: trimmed || undefined,
      model: activeModel,
      numCtx: selectedNumCtx,
    });
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-4 py-8 sm:px-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          {/* Editorial Heading */}
          <div className="space-y-2 pt-2">
            <h1 className="font-display text-3xl font-semibold tracking-tight text-[var(--foreground)] text-balance sm:text-4xl">
              Which PDFs should we read together?
            </h1>
            <p className="text-sm text-[var(--muted-foreground)] sm:text-base">
              Select one or more documents below before starting, or upload a new PDF right here if you don&apos;t see the one you need.
            </p>
          </div>

          {/* Inline Add New PDF */}
          <PdfUploadDropzone onUploaded={handleUploaded} />

          {/* Document Selection Panel */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-[var(--border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-[var(--foreground)]">
                  Your Uploaded PDFs
                </span>
                <span className="text-xs text-[var(--muted-foreground)] tabular-nums">
                  {selectedIds.length} selected
                </span>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative flex-1 sm:w-52">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Find a PDF..."
                    className="h-8 pl-8 text-xs"
                  />
                </div>
                {indexedDocs.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setSelectedIds(
                        selectedIds.length === indexedDocs.length
                          ? []
                          : indexedDocs.map((d) => d.id)
                      )
                    }
                  >
                    {selectedIds.length === indexedDocs.length
                      ? 'Clear'
                      : 'Select all'}
                  </Button>
                )}
              </div>
            </div>

            {isLoading ? (
              <div className="space-y-2 p-4">
                {[1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-12 animate-pulse rounded-lg bg-[var(--secondary)]"
                  />
                ))}
              </div>
            ) : filteredDocs.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <FileText className="mx-auto h-7 w-7 text-[var(--muted-foreground)]" />
                <p className="mt-2.5 text-sm font-medium text-[var(--foreground)]">
                  {documents.length === 0
                    ? 'No PDFs in your library yet'
                    : 'No PDFs match your search'}
                </p>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  Use the upload box above to add a PDF and start chatting as soon as embedding completes.
                </p>
              </div>
            ) : (
              <ScrollArea className="max-h-72">
                <div className="divide-y divide-[var(--border)]">
                  {filteredDocs.map((doc) => {
                    const isChecked = selectedIds.includes(doc.id);
                    const isActive = ACTIVE_STATUSES.has(doc.status);
                    const isFailed = doc.status === 'failed';

                    return (
                      <label
                        key={doc.id}
                        className={cn(
                          'flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-[var(--secondary)]/60',
                          isChecked &&
                            'bg-[var(--accent)]/65 dark:bg-neutral-800/75'
                        )}
                      >
                        <Checkbox
                          checked={isChecked}
                          disabled={isFailed}
                          onCheckedChange={() => toggleDoc(doc.id)}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <FileText className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
                              <span className="truncate text-sm font-medium text-[var(--foreground)]">
                                {doc.filename}
                              </span>
                            </div>

                            <span className="shrink-0 font-mono text-xs tabular-nums text-[var(--muted-foreground)]">
                              {isActive
                                ? `${doc.progress}%`
                                : isFailed
                                ? 'Failed'
                                : `${doc.pageCount} pages`}
                            </span>
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-[var(--muted-foreground)] tabular-nums">
                            <span>{formatBytes(doc.fileSize)}</span>
                            <span aria-hidden="true">·</span>
                            {isActive ? (
                              <span className="flex items-center gap-1.5 text-[var(--foreground)]">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                <span>{doc.stageLabel}</span>
                              </span>
                            ) : isFailed ? (
                              <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                                <AlertCircle className="h-3 w-3" />
                                <span>{doc.error || 'Indexing error'}</span>
                              </span>
                            ) : (
                              <span className="flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3 text-emerald-700 dark:text-emerald-400" />
                                <span>{doc.chunkCount} chunks ready</span>
                              </span>
                            )}
                          </div>

                          {isActive && (
                            <Progress value={doc.progress} className="mt-2 h-1.5" />
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Starter Prompts */}
          {selectedReadyCount > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-[var(--muted-foreground)]">
                Suggested prompts for selected documents
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                {STARTER_PROMPTS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => setPrompt(suggestion)}
                    className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 text-left text-xs leading-relaxed text-[var(--foreground)] transition-colors hover:bg-[var(--accent)] dark:hover:bg-neutral-800 cursor-pointer"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Composer */}
      <div className="border-t border-[var(--border)] bg-[var(--background)] px-4 py-4 sm:px-8">
        <form
          onSubmit={handleSubmit}
          className="mx-auto max-w-3xl rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 focus-within:ring-2 focus-within:ring-[var(--ring)]"
        >
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (canSend) handleSubmit();
              }
            }}
            rows={2}
            placeholder={
              selectedReadyCount > 0
                ? 'Ask a question about your selected PDFs...'
                : selectedProcessingCount > 0
                ? 'Selected PDF is indexing in the background — you can type your question while it finishes...'
                : 'Select at least one PDF above to ask a question...'
            }
            className="w-full resize-none bg-transparent px-1 py-1 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none"
          />

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <ModelContextSelector
                model={activeModel}
                numCtx={selectedNumCtx}
                onChange={({ model, numCtx }) => {
                  setSelectedModel(model);
                  setSelectedNumCtx(numCtx);
                }}
                onOpenRuntime={onOpenRuntime}
              />
              <span className="text-xs text-[var(--muted-foreground)] tabular-nums">
                {selectedIds.length === 0 ? (
                  'No PDFs selected'
                ) : selectedProcessingCount > 0 && selectedReadyCount === 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-[var(--foreground)]">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Indexing {selectedProcessingCount} PDF...</span>
                  </span>
                ) : (
                  `${selectedReadyCount} ${selectedReadyCount === 1 ? 'PDF' : 'PDFs'} ready`
                )}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {selectedIds.length > 0 && prompt.trim().length === 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isCreating}
                  onClick={() =>
                    onStartChat({
                      documentIds: selectedIds,
                      model: activeModel,
                      numCtx: selectedNumCtx,
                    })
                  }
                >
                  Open chat workspace
                </Button>
              )}
              <Button
                type="submit"
                variant="default"
                size="icon-sm"
                disabled={!canSend}
                title="Send message"
              >
                {isCreating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
