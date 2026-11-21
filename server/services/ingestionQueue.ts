import path from 'path';
import { chromaStore, VectorUpsertItem } from './chroma.ts';
import { ollamaService } from './ollama.ts';
import { chunkExtractedPages, extractPdfPages } from './pdfExtractor.ts';
import { dataStore } from './store.ts';
import { DocumentStatus, IngestionJobRecord, PdfDocumentRecord } from '../types.ts';

export const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');

export function resolveUploadPath(storedFilename: string): string {
  const safeBase = path.basename(storedFilename);
  const resolved = path.resolve(UPLOADS_DIR, safeBase);
  if (!resolved.startsWith(UPLOADS_DIR + path.sep)) {
    throw new Error('Invalid file path');
  }
  return resolved;
}

class BackgroundIngestionQueue {
  private queue: Array<{ documentId: string; jobId: string }> = [];
  private processing = false;

  public enqueue(doc: PdfDocumentRecord): IngestionJobRecord {
    const now = new Date().toISOString();
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const job: IngestionJobRecord = {
      id: jobId,
      documentId: doc.id,
      filename: doc.filename,
      status: 'queued',
      progress: 0,
      stageLabel: 'Queued for background processing',
      detail: 'Waiting in ingestion queue',
      error: null,
      createdAt: now,
      updatedAt: now,
    };

    void (async () => {
      await dataStore.upsertJob(job);
      this.queue.push({ documentId: doc.id, jobId });
      void this.drain();
    })();

    return job;
  }

  private async setProgress(
    documentId: string,
    jobId: string,
    status: DocumentStatus,
    progress: number,
    stageLabel: string,
    detail: string,
    extraDocPatch?: Partial<PdfDocumentRecord>
  ) {
    const clamped = Math.max(0, Math.min(100, Math.round(progress)));
    await Promise.all([
      dataStore.updateDocument(documentId, {
        status,
        progress: clamped,
        stageLabel,
        error: null,
        ...extraDocPatch,
      }),
      dataStore.updateJob(jobId, {
        status,
        progress: clamped,
        stageLabel,
        detail,
        error: null,
      }),
    ]);
  }

  private async drain() {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift();
        if (!item) continue;
        await this.processOne(item.documentId, item.jobId);
      }
    } finally {
      this.processing = false;
    }
  }

  private async processOne(documentId: string, jobId: string) {
    const doc = await dataStore.getDocument(documentId);
    if (!doc) return;

    try {
      const filePath = resolveUploadPath(doc.storedFilename);

      // Stage 1: Extract PDF pages (5% -> 25%)
      await this.setProgress(
        documentId,
        jobId,
        'extracting',
        5,
        'Extracting PDF text',
        'Opening PDF document'
      );

      let lastReportedPct = 5;
      const { pages, pageCount } = await extractPdfPages(filePath, async (page, total) => {
        const pct = 5 + Math.round((page / Math.max(1, total)) * 20);
        if (pct - lastReportedPct >= 3 || page === total) {
          lastReportedPct = pct;
          await this.setProgress(
            documentId,
            jobId,
            'extracting',
            pct,
            'Extracting PDF text',
            `Page ${page} of ${total}`,
            { pageCount: total }
          );
        }
      });

      if (pages.length === 0) {
        throw new Error(
          'No extractable text found in this PDF. Scanned image-only PDFs require OCR before indexing.'
        );
      }

      // Stage 2: Chunk text (26% -> 35%)
      await this.setProgress(
        documentId,
        jobId,
        'chunking',
        28,
        'Splitting into semantic chunks',
        `Processing ${pages.length} text pages`,
        { pageCount }
      );

      const chunks = chunkExtractedPages(documentId, doc.filename, pages);
      if (chunks.length === 0) {
        throw new Error('Document produced zero valid text chunks.');
      }

      await dataStore.replaceDocumentChunks(documentId, chunks);
      await this.setProgress(
        documentId,
        jobId,
        'chunking',
        35,
        'Chunks prepared',
        `${chunks.length} chunks across ${pageCount} pages`,
        { pageCount, chunkCount: chunks.length }
      );

      // Stage 3: Generate vector embeddings via Ollama nomic-embed-text (35% -> 88%)
      const batchSize = 6;
      const vectorItems: VectorUpsertItem[] = [];

      for (let i = 0; i < chunks.length; i += batchSize) {
        // Check document wasn't deleted mid-processing
        const stillExists = await dataStore.getDocument(documentId);
        if (!stillExists) return;

        const batch = chunks.slice(i, i + batchSize);
        const doneCount = Math.min(i + batch.length, chunks.length);
        const pct = 35 + Math.round((i / chunks.length) * 53);

        await this.setProgress(
          documentId,
          jobId,
          'embedding',
          pct,
          'Generating vector embeddings',
          `Embedding chunks ${doneCount} of ${chunks.length} (${ollamaService.getEmbedModel()})`
        );

        const embeddings = await ollamaService.embedBatch(batch.map((c) => c.text));
        for (let j = 0; j < batch.length; j++) {
          vectorItems.push({
            chunk: batch[j],
            embedding: embeddings[j],
          });
        }
      }

      // Stage 4: Store vectors in ChromaDB (88% -> 98%)
      await this.setProgress(
        documentId,
        jobId,
        'storing',
        90,
        'Storing vectors in ChromaDB',
        `Indexing ${vectorItems.length} vectors`
      );

      await chromaStore.deleteByDocumentId(documentId);
      await chromaStore.upsertChunks(vectorItems);

      // Stage 5: Done (100%)
      await Promise.all([
        dataStore.updateDocument(documentId, {
          status: 'indexed',
          progress: 100,
          stageLabel: 'Indexed & ready',
          pageCount,
          chunkCount: chunks.length,
          error: null,
        }),
        dataStore.updateJob(jobId, {
          status: 'indexed',
          progress: 100,
          stageLabel: 'Completed',
          detail: `${chunks.length} chunks indexed across ${pageCount} pages`,
          error: null,
        }),
      ]);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unexpected background indexing error';
      await Promise.all([
        dataStore.updateDocument(documentId, {
          status: 'failed',
          stageLabel: 'Indexing failed',
          error: message,
        }),
        dataStore.updateJob(jobId, {
          status: 'failed',
          stageLabel: 'Failed',
          detail: message,
          error: message,
        }),
      ]);
    }
  }
}

export const ingestionQueue = new BackgroundIngestionQueue();
