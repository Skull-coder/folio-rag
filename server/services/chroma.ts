import fs from 'fs';
import path from 'path';
import { CitationSource, DocumentChunkRecord } from '../types.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const LOCAL_VECTORS_PATH = path.resolve(DATA_DIR, 'vectors.json');

interface LocalVectorItem {
  id: string;
  documentId: string;
  filename: string;
  pageNumber: number;
  chunkIndex: number;
  text: string;
  embedding: number[];
}

export interface VectorUpsertItem {
  chunk: DocumentChunkRecord;
  embedding: number[];
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

class ChromaVectorStore {
  private apiVersion: 'v2' | 'v1' | null = null;
  private collectionId: string | null = null;
  private lastError: string | undefined;

  public getChromaUrl(): string {
    return (process.env.CHROMA_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
  }

  public getCollectionName(): string {
    return process.env.CHROMA_COLLECTION || 'folio_pdf_chunks';
  }

  private getBaseApiPrefix(version: 'v2' | 'v1'): string {
    if (version === 'v2') {
      return `${this.getChromaUrl()}/api/v2/tenants/default_tenant/databases/default_database`;
    }
    return `${this.getChromaUrl()}/api/v1`;
  }

  private async fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 2500) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  public async detectApi(): Promise<'v2' | 'v1' | null> {
    const base = this.getChromaUrl();
    try {
      const v2 = await this.fetchWithTimeout(`${base}/api/v2/heartbeat`);
      if (v2.ok) {
        this.apiVersion = 'v2';
        this.lastError = undefined;
        return 'v2';
      }
    } catch {
      // try v1 next
    }

    try {
      const v1 = await this.fetchWithTimeout(`${base}/api/v1/heartbeat`);
      if (v1.ok) {
        this.apiVersion = 'v1';
        this.lastError = undefined;
        return 'v1';
      }
      this.lastError = `ChromaDB responded with status ${v1.status}`;
    } catch (err) {
      this.lastError =
        err instanceof Error ? err.message : 'Unable to connect to ChromaDB';
    }

    this.apiVersion = null;
    this.collectionId = null;
    return null;
  }

  public async getStatus() {
    const version = await this.detectApi();
    return {
      connected: version !== null,
      mode: version !== null ? ('chromadb' as const) : ('local-file' as const),
      url: this.getChromaUrl(),
      collection: this.getCollectionName(),
      error: version !== null ? undefined : this.lastError,
    };
  }

  private async ensureCollection(): Promise<{ version: 'v2' | 'v1'; collectionId: string } | null> {
    const version = this.apiVersion || (await this.detectApi());
    if (!version) return null;

    if (this.collectionId) {
      return { version, collectionId: this.collectionId };
    }

    const prefix = this.getBaseApiPrefix(version);
    const name = this.getCollectionName();

    try {
      const res = await this.fetchWithTimeout(
        `${prefix}/collections`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            get_or_create: true,
            metadata: { 'hnsw:space': 'cosine' },
          }),
        },
        5000
      );

      if (res.ok) {
        const data = (await res.json()) as { id: string };
        this.collectionId = data.id;
        return { version, collectionId: data.id };
      }

      // Fallback: list collections or GET by name
      const getRes = await this.fetchWithTimeout(
        `${prefix}/collections/${encodeURIComponent(name)}`,
        undefined,
        4000
      );
      if (getRes.ok) {
        const data = (await getRes.json()) as { id: string };
        this.collectionId = data.id;
        return { version, collectionId: data.id };
      }
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : 'Chroma collection error';
    }

    return null;
  }

  private readLocalVectors(): LocalVectorItem[] {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(LOCAL_VECTORS_PATH)) {
      return [];
    }
    try {
      const raw = fs.readFileSync(LOCAL_VECTORS_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeLocalVectors(items: LocalVectorItem[]) {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmp = `${LOCAL_VECTORS_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(items), 'utf-8');
    fs.renameSync(tmp, LOCAL_VECTORS_PATH);
  }

  public async upsertChunks(items: VectorUpsertItem[]): Promise<void> {
    if (items.length === 0) return;
    const col = await this.ensureCollection();

    if (col) {
      const prefix = this.getBaseApiPrefix(col.version);
      const batchSize = 40;
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const res = await this.fetchWithTimeout(
          `${prefix}/collections/${col.collectionId}/upsert`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ids: batch.map((b) => b.chunk.id),
              embeddings: batch.map((b) => b.embedding),
              documents: batch.map((b) => b.chunk.text),
              metadatas: batch.map((b) => ({
                documentId: b.chunk.documentId,
                filename: b.chunk.filename,
                pageNumber: b.chunk.pageNumber,
                chunkIndex: b.chunk.chunkIndex,
              })),
            }),
          },
          15000
        );
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`ChromaDB upsert failed (${res.status}): ${text}`);
        }
      }
      return;
    }

    // Local fallback when ChromaDB Docker container is not running
    const existing = this.readLocalVectors();
    const map = new Map<string, LocalVectorItem>();
    for (const item of existing) {
      map.set(item.id, item);
    }
    for (const item of items) {
      map.set(item.chunk.id, {
        id: item.chunk.id,
        documentId: item.chunk.documentId,
        filename: item.chunk.filename,
        pageNumber: item.chunk.pageNumber,
        chunkIndex: item.chunk.chunkIndex,
        text: item.chunk.text,
        embedding: item.embedding,
      });
    }
    this.writeLocalVectors(Array.from(map.values()));
  }

  public async deleteByDocumentId(documentId: string): Promise<void> {
    const col = await this.ensureCollection();
    if (col) {
      const prefix = this.getBaseApiPrefix(col.version);
      await this.fetchWithTimeout(
        `${prefix}/collections/${col.collectionId}/delete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            where: { documentId },
          }),
        },
        8000
      ).catch(() => {});
      return;
    }

    const existing = this.readLocalVectors();
    const filtered = existing.filter((v) => v.documentId !== documentId);
    this.writeLocalVectors(filtered);
  }

  public async querySimilar(
    queryEmbedding: number[],
    documentIds: string[],
    topK = 6
  ): Promise<CitationSource[]> {
    if (documentIds.length === 0) return [];

    const col = await this.ensureCollection();
    if (col) {
      const prefix = this.getBaseApiPrefix(col.version);
      const where =
        documentIds.length === 1
          ? { documentId: documentIds[0] }
          : { documentId: { $in: documentIds } };

      const res = await this.fetchWithTimeout(
        `${prefix}/collections/${col.collectionId}/query`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query_embeddings: [queryEmbedding],
            n_results: topK,
            where,
            include: ['documents', 'metadatas', 'distances'],
          }),
        },
        10000
      );

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`ChromaDB query failed (${res.status}): ${text}`);
      }

      const data = (await res.json()) as {
        documents?: (string | null)[][];
        metadatas?: (Record<string, unknown> | null)[][];
        distances?: (number | null)[][];
      };

      const docs = data.documents?.[0] || [];
      const metas = data.metadatas?.[0] || [];
      const dists = data.distances?.[0] || [];

      const results: CitationSource[] = [];
      for (let i = 0; i < docs.length; i++) {
        const text = docs[i];
        const meta = metas[i];
        if (!text || !meta) continue;
        const dist = typeof dists[i] === 'number' ? (dists[i] as number) : 0.5;
        const score = Math.max(0, Math.min(1, 1 - dist));
        results.push({
          documentId: String(meta.documentId || ''),
          filename: String(meta.filename || 'Document.pdf'),
          pageNumber: Number(meta.pageNumber || 1),
          chunkIndex: Number(meta.chunkIndex || 0),
          excerpt: text,
          score: Number(score.toFixed(3)),
        });
      }
      return results;
    }

    // Local fallback cosine similarity
    const docSet = new Set(documentIds);
    const candidates = this.readLocalVectors().filter((v) => docSet.has(v.documentId));
    return candidates
      .map((item) => ({
        item,
        score: cosineSimilarity(queryEmbedding, item.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ item, score }) => ({
        documentId: item.documentId,
        filename: item.filename,
        pageNumber: item.pageNumber,
        chunkIndex: item.chunkIndex,
        excerpt: item.text,
        score: Number(Math.max(0, score).toFixed(3)),
      }));
  }
}

export const chromaStore = new ChromaVectorStore();
