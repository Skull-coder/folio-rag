import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  FileText,
  Loader2,
  MessageSquarePlus,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { PdfUploadDropzone } from '@/src/components/PdfUploadDropzone';
import { Button } from '@/src/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/src/components/ui/dialog';
import { Input } from '@/src/components/ui/input';
import { Progress } from '@/src/components/ui/progress';
import { ScrollArea } from '@/src/components/ui/scroll-area';
import {
  ACTIVE_STATUSES,
  useDeleteDocumentMutation,
  useDocumentDetailQuery,
  useDocumentsQuery,
  useJobsQuery,
  useRetryDocumentMutation,
} from '@/src/hooks/useRagQueries';
import { PdfDocument } from '@/src/lib/types';
import { cn, formatBytes, formatRelativeTime } from '@/src/lib/utils';

interface DocumentLibraryViewProps {
  onStartChatWithDoc: (docId: string) => void;
}

type LibraryFilter = 'all' | 'indexed' | 'processing' | 'failed';

export function DocumentLibraryView({
  onStartChatWithDoc,
}: DocumentLibraryViewProps) {
  const { data: documents = [], isLoading } = useDocumentsQuery();
  const { data: jobs = [] } = useJobsQuery();
  const retryMutation = useRetryDocumentMutation();
  const deleteMutation = useDeleteDocumentMutation();

  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [search, setSearch] = useState('');
  const [inspectDocId, setInspectDocId] = useState<string | null>(null);

  const { data: detailData, isLoading: detailLoading } =
    useDocumentDetailQuery(inspectDocId);

  const jobMap = useMemo(() => {
    const map = new Map<string, (typeof jobs)[number]>();
    for (const job of jobs) {
      if (!map.has(job.documentId)) {
        map.set(job.documentId, job);
      }
    }
    return map;
  }, [jobs]);

  const counts = useMemo(() => {
    let indexed = 0;
    let processing = 0;
    let failed = 0;
    for (const d of documents) {
      if (d.status === 'indexed') indexed++;
      else if (d.status === 'failed') failed++;
      else processing++;
    }
    return { all: documents.length, indexed, processing, failed };
  }, [documents]);

  const filteredDocs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return documents.filter((doc) => {
      if (filter === 'indexed' && doc.status !== 'indexed') return false;
      if (filter === 'failed' && doc.status !== 'failed') return false;
      if (filter === 'processing' && !ACTIVE_STATUSES.has(doc.status)) return false;
      if (q && !doc.filename.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [documents, filter, search]);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 md:px-10">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--foreground)]">
              Document Library
            </h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Manage uploaded PDFs, inspect extracted chunks, and monitor background embedding progress.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-[var(--muted-foreground)] tabular-nums">
            <span>{counts.all} total</span>
            <span aria-hidden="true">·</span>
            <span>{counts.indexed} indexed</span>
            {counts.processing > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-medium text-[var(--foreground)]">
                  {counts.processing} processing
                </span>
              </>
            )}
          </div>
        </div>

        {/* Upload Dropzone */}
        <PdfUploadDropzone />

        {/* Controls: Segmented Filter + Search */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--secondary)] p-1">
            {(
              [
                { key: 'all', label: 'All', count: counts.all },
                { key: 'indexed', label: 'Indexed', count: counts.indexed },
                { key: 'processing', label: 'Processing', count: counts.processing },
                { key: 'failed', label: 'Failed', count: counts.failed },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilter(tab.key)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums',
                  filter === tab.key
                    ? 'bg-[var(--background)] text-[var(--foreground)] shadow-xs border border-[var(--border)]'
                    : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                )}
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search PDFs..."
              className="pl-9"
            />
          </div>
        </div>

        {/* Document List */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--card)]"
              />
            ))}
          </div>
        ) : filteredDocs.length === 0 ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-6 py-14 text-center">
            <FileText className="mx-auto h-8 w-8 text-[var(--muted-foreground)]" />
            <h2 className="mt-3 font-display text-base font-semibold text-[var(--foreground)]">
              {documents.length === 0 ? 'No PDFs uploaded yet' : 'No matching PDFs'}
            </h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-[var(--muted-foreground)]">
              {documents.length === 0
                ? 'Upload a textbook, manual, research paper, or report above to extract its text and store vector embeddings in ChromaDB.'
                : 'Try adjusting your search query or status filter.'}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] divide-y divide-[var(--border)]">
            {filteredDocs.map((doc: PdfDocument) => {
              const isActive = ACTIVE_STATUSES.has(doc.status);
              const isFailed = doc.status === 'failed';
              const job = jobMap.get(doc.id);

              return (
                <div
                  key={doc.id}
                  className="flex flex-col gap-4 p-4 transition-colors hover:bg-[var(--secondary)]/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5">
                      <FileText className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
                      <span className="truncate text-sm font-semibold text-[var(--foreground)]">
                        {doc.filename}
                      </span>
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[var(--muted-foreground)] tabular-nums">
                      <span>{formatBytes(doc.fileSize)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{doc.pageCount > 0 ? `${doc.pageCount} pages` : 'Pending pages'}</span>
                      <span aria-hidden="true">·</span>
                      <span>{doc.chunkCount > 0 ? `${doc.chunkCount} chunks` : 'Pending chunks'}</span>
                      <span aria-hidden="true">·</span>
                      <span>Uploaded {formatRelativeTime(doc.createdAt)}</span>
                    </div>

                    {/* Status & Background Progress */}
                    {isActive && (
                      <div className="mt-3 max-w-lg space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1.5 font-medium text-[var(--foreground)]">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span>
                              {doc.stageLabel}
                              {job?.detail ? ` — ${job.detail}` : ''}
                            </span>
                          </span>
                          <span className="font-mono font-medium tabular-nums text-[var(--foreground)]">
                            {doc.progress}%
                          </span>
                        </div>
                        <Progress value={doc.progress} />
                      </div>
                    )}

                    {doc.status === 'indexed' && (
                      <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Indexed in ChromaDB · Ready for RAG queries</span>
                      </div>
                    )}

                    {isFailed && (
                      <div className="mt-2 flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{doc.error || 'Background indexing failed'}</span>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {doc.status === 'indexed' && (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setInspectDocId(doc.id)}
                        >
                          <BookOpen className="h-3.5 w-3.5" />
                          <span>Inspect</span>
                        </Button>
                        <Button
                          type="button"
                          variant="accent"
                          size="sm"
                          onClick={() => onStartChatWithDoc(doc.id)}
                        >
                          <MessageSquarePlus className="h-3.5 w-3.5" />
                          <span>Chat</span>
                        </Button>
                      </>
                    )}

                    {isFailed && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={retryMutation.isPending}
                        onClick={() => retryMutation.mutate(doc.id)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        <span>Retry</span>
                      </Button>
                    )}

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      title="Delete PDF"
                      disabled={deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate(doc.id)}
                      className="text-[var(--muted-foreground)] hover:text-red-600 dark:hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Document Chunks Inspector Modal */}
      <Dialog
        open={Boolean(inspectDocId)}
        onOpenChange={(open) => !open && setInspectDocId(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-8">
              {detailData?.document.filename || 'Document Chunks'}
            </DialogTitle>
            <DialogDescription className="tabular-nums">
              {detailData
                ? `${detailData.document.pageCount} pages · ${detailData.document.chunkCount} total chunks (showing up to 80)`
                : 'Loading extracted document chunks...'}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="mt-4 h-[26rem] rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
            {detailLoading ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
              </div>
            ) : !detailData || detailData.chunks.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">
                No extracted text chunks available.
              </p>
            ) : (
              <div className="space-y-3">
                {detailData.chunks.map((chunk) => (
                  <div
                    key={chunk.id}
                    className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3"
                  >
                    <div className="mb-1.5 flex items-center justify-between text-xs text-[var(--muted-foreground)] font-mono tabular-nums">
                      <span>Chunk #{chunk.chunkIndex + 1}</span>
                      <span>Page {chunk.pageNumber}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--foreground)]">
                      {chunk.text}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
