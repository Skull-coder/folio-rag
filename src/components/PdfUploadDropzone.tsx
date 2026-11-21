import React, { useRef, useState } from 'react';
import { FileUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/src/components/ui/button';
import { useUploadPdfsMutation } from '@/src/hooks/useRagQueries';
import { PdfDocument } from '@/src/lib/types';
import { cn } from '@/src/lib/utils';

interface PdfUploadDropzoneProps {
  compact?: boolean;
  onUploaded?: (docs: PdfDocument[]) => void;
  className?: string;
}

export function PdfUploadDropzone({
  compact = false,
  onUploaded,
  className,
}: PdfUploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const uploadMutation = useUploadPdfsMutation();

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const validPdfs = Array.from(fileList).filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    );

    if (validPdfs.length === 0) {
      toast.error('Please choose valid PDF (.pdf) files.');
      return;
    }

    const res = await uploadMutation.mutateAsync(validPdfs);
    onUploaded?.(res.documents);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  if (compact) {
    return (
      <div className={cn('inline-flex items-center', className)}>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
        />
        <Button
          type="button"
          variant="accent"
          size="sm"
          disabled={uploadMutation.isPending}
          onClick={() => inputRef.current?.click()}
        >
          {uploadMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileUp className="h-3.5 w-3.5" />
          )}
          <span>{uploadMutation.isPending ? 'Uploading...' : 'Add new PDF'}</span>
        </Button>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        void handleFiles(e.dataTransfer.files);
      }}
      className={cn(
        'relative rounded-xl border border-dashed p-5 transition-colors',
        isDragging
          ? 'border-[#EAB308] bg-[var(--accent)] dark:border-white dark:bg-neutral-900'
          : 'border-[var(--border)] bg-[var(--card)] hover:border-[var(--muted-foreground)]',
        className
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-[#111111] dark:bg-neutral-800 dark:text-white border border-[var(--border)]">
            {uploadMutation.isPending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <FileUp className="h-5 w-5" />
            )}
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--foreground)]">
              Upload PDF documents
            </p>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Drag & drop or browse files. Text extraction, chunking, and nomic-embed-text indexing run in the background.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="accent"
          size="sm"
          disabled={uploadMutation.isPending}
          onClick={() => inputRef.current?.click()}
        >
          {uploadMutation.isPending ? 'Uploading...' : 'Select PDF files'}
        </Button>
      </div>
    </div>
  );
}
