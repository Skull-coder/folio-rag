import React, { useMemo, useState } from 'react';
import { FileText, Loader2, Search } from 'lucide-react';
import { PdfUploadDropzone } from '@/src/components/PdfUploadDropzone';
import { Button } from '@/src/components/ui/button';
import { Checkbox } from '@/src/components/ui/checkbox';
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
import { ACTIVE_STATUSES, useDocumentsQuery } from '@/src/hooks/useRagQueries';
import { PdfDocument } from '@/src/lib/types';
import { cn, formatBytes } from '@/src/lib/utils';

interface ManageChatPdfsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDocIds: string[];
  onSaveSelection: (docIds: string[]) => void;
}

export function ManageChatPdfsDialog({
  open,
  onOpenChange,
  selectedDocIds,
  onSaveSelection,
}: ManageChatPdfsDialogProps) {
  const { data: documents = [] } = useDocumentsQuery();
  const [search, setSearch] = useState('');
  const [draftIds, setDraftIds] = useState<string[]>(selectedDocIds);

  React.useEffect(() => {
    if (open) {
      setDraftIds(selectedDocIds);
    }
  }, [open, selectedDocIds]);

  const filteredDocs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter((d) => d.filename.toLowerCase().includes(q));
  }, [documents, search]);

  const toggleDoc = (docId: string) => {
    setDraftIds((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    );
  };

  const handleUploaded = (newDocs: PdfDocument[]) => {
    const newIds = newDocs.map((d) => d.id);
    setDraftIds((prev) => Array.from(new Set([...prev, ...newIds])));
    // Persist immediately into chat scope so background progress is visible in the chat strip
    onSaveSelection(Array.from(new Set([...draftIds, ...newIds])));
  };

  const handleApply = () => {
    onSaveSelection(draftIds);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manage Conversation PDFs</DialogTitle>
          <DialogDescription>
            Attach additional PDFs from your library or upload new documents mid-chat.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          <PdfUploadDropzone onUploaded={handleUploaded} />

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter uploaded PDFs..."
              className="pl-9"
            />
          </div>

          <ScrollArea className="h-64 rounded-lg border border-[var(--border)] bg-[var(--card)]">
            {filteredDocs.length === 0 ? (
              <div className="flex h-56 flex-col items-center justify-center px-4 text-center">
                <p className="text-sm font-medium text-[var(--foreground)]">
                  No PDFs match your filter
                </p>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  Upload a PDF above to extract and index it right away.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {filteredDocs.map((doc) => {
                  const isChecked = draftIds.includes(doc.id);
                  const isActive = ACTIVE_STATUSES.has(doc.status);
                  const isFailed = doc.status === 'failed';

                  return (
                    <label
                      key={doc.id}
                      className={cn(
                        'flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-[var(--secondary)]/60',
                        isChecked && 'bg-[var(--accent)]/60 dark:bg-neutral-800/70'
                      )}
                    >
                      <Checkbox
                        checked={isChecked}
                        disabled={isFailed}
                        onCheckedChange={() => toggleDoc(doc.id)}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
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
                              : `${doc.pageCount}p`}
                          </span>
                        </div>

                        <div className="mt-1 flex items-center gap-2 text-xs text-[var(--muted-foreground)] tabular-nums">
                          <span>{formatBytes(doc.fileSize)}</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {isActive
                              ? doc.stageLabel
                              : isFailed
                              ? doc.error || 'Indexing failed'
                              : `${doc.chunkCount} chunks indexed`}
                          </span>
                        </div>

                        {isActive && (
                          <div className="mt-2 flex items-center gap-2">
                            <Progress value={doc.progress} className="h-1.5 flex-1" />
                            <Loader2 className="h-3 w-3 animate-spin text-[var(--muted-foreground)]" />
                          </div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <span className="text-xs text-[var(--muted-foreground)] tabular-nums">
            {draftIds.length} {draftIds.length === 1 ? 'document' : 'documents'} selected
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="button" variant="default" size="sm" onClick={handleApply}>
              Update chat scope
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
