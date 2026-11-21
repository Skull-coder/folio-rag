import fs from 'fs';
import path from 'path';
import { Collection, Db, MongoClient } from 'mongodb';
import {
  ChatMessageRecord,
  ChatThreadRecord,
  DocumentChunkRecord,
  IngestionJobRecord,
  PdfDocumentRecord,
} from '../types.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const LOCAL_DB_PATH = path.resolve(DATA_DIR, 'foliorag-db.json');

interface LocalStoreData {
  documents: PdfDocumentRecord[];
  jobs: IngestionJobRecord[];
  chats: ChatThreadRecord[];
  chunks: DocumentChunkRecord[];
}

class DataStore {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private mongoConnected = false;
  private mongoError: string | undefined;
  private lastMongoCheck = 0;

  private ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private readLocal(): LocalStoreData {
    this.ensureDataDir();
    if (!fs.existsSync(LOCAL_DB_PATH)) {
      const initial: LocalStoreData = {
        documents: [],
        jobs: [],
        chats: [],
        chunks: [],
      };
      fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(initial, null, 2), 'utf-8');
      return initial;
    }
    try {
      const raw = fs.readFileSync(LOCAL_DB_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<LocalStoreData>;
      return {
        documents: Array.isArray(parsed.documents) ? parsed.documents : [],
        jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
        chats: Array.isArray(parsed.chats) ? parsed.chats : [],
        chunks: Array.isArray(parsed.chunks) ? parsed.chunks : [],
      };
    } catch {
      return { documents: [], jobs: [], chats: [], chunks: [] };
    }
  }

  private writeLocal(data: LocalStoreData) {
    this.ensureDataDir();
    const tmpPath = `${LOCAL_DB_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, LOCAL_DB_PATH);
  }

  public getMongoUri(): string {
    return process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/foliorag';
  }

  public async ensureConnection(force = false): Promise<boolean> {
    const now = Date.now();
    if (this.mongoConnected && this.db && !force) {
      return true;
    }
    if (!force && now - this.lastMongoCheck < 5000 && !this.mongoConnected) {
      return false;
    }
    this.lastMongoCheck = now;

    const uri = this.getMongoUri();
    try {
      if (this.client) {
        await this.client.close().catch(() => {});
      }
      const client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 2000,
        connectTimeoutMS: 2000,
      });
      await client.connect();
      await client.db().admin().ping();
      this.client = client;
      this.db = client.db();
      this.mongoConnected = true;
      this.mongoError = undefined;
      return true;
    } catch (err) {
      this.mongoConnected = false;
      this.db = null;
      this.mongoError = err instanceof Error ? err.message : 'MongoDB connection failed';
      return false;
    }
  }

  public async getStatus() {
    const connected = await this.ensureConnection(true);
    return {
      connected,
      mode: connected ? ('mongodb' as const) : ('local-file' as const),
      uri: this.getMongoUri(),
      error: connected ? undefined : this.mongoError,
    };
  }

  private col<T extends object>(name: string): Collection<T> {
    if (!this.db) {
      throw new Error('MongoDB is not initialized');
    }
    return this.db.collection<T>(name);
  }

  // --- Documents ---

  public async listDocuments(): Promise<PdfDocumentRecord[]> {
    if (await this.ensureConnection()) {
      const docs = await this.col<PdfDocumentRecord>('documents')
        .find({}, { projection: { _id: 0 } })
        .sort({ createdAt: -1 })
        .toArray();
      return docs;
    }
    const local = this.readLocal();
    return [...local.documents].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  public async getDocument(id: string): Promise<PdfDocumentRecord | null> {
    if (await this.ensureConnection()) {
      return (
        (await this.col<PdfDocumentRecord>('documents').findOne(
          { id },
          { projection: { _id: 0 } }
        )) || null
      );
    }
    const local = this.readLocal();
    return local.documents.find((d) => d.id === id) || null;
  }

  public async upsertDocument(doc: PdfDocumentRecord): Promise<void> {
    if (await this.ensureConnection()) {
      await this.col<PdfDocumentRecord>('documents').updateOne(
        { id: doc.id },
        { $set: doc },
        { upsert: true }
      );
      return;
    }
    const local = this.readLocal();
    const idx = local.documents.findIndex((d) => d.id === doc.id);
    if (idx >= 0) {
      local.documents[idx] = doc;
    } else {
      local.documents.unshift(doc);
    }
    this.writeLocal(local);
  }

  public async updateDocument(
    id: string,
    patch: Partial<PdfDocumentRecord>
  ): Promise<PdfDocumentRecord | null> {
    const updatedAt = new Date().toISOString();
    if (await this.ensureConnection()) {
      await this.col<PdfDocumentRecord>('documents').updateOne(
        { id },
        { $set: { ...patch, updatedAt } }
      );
      return this.getDocument(id);
    }
    const local = this.readLocal();
    const idx = local.documents.findIndex((d) => d.id === id);
    if (idx < 0) return null;
    local.documents[idx] = { ...local.documents[idx], ...patch, updatedAt };
    this.writeLocal(local);
    return local.documents[idx];
  }

  public async deleteDocument(id: string): Promise<void> {
    if (await this.ensureConnection()) {
      await this.col<PdfDocumentRecord>('documents').deleteOne({ id });
      await this.col<DocumentChunkRecord>('chunks').deleteMany({ documentId: id });
      await this.col<IngestionJobRecord>('jobs').deleteMany({ documentId: id });
      await this.col<ChatThreadRecord>('chats').updateMany(
        { documentIds: id },
        { $pull: { documentIds: id } }
      );
      return;
    }
    const local = this.readLocal();
    local.documents = local.documents.filter((d) => d.id !== id);
    local.chunks = local.chunks.filter((c) => c.documentId !== id);
    local.jobs = local.jobs.filter((j) => j.documentId !== id);
    local.chats = local.chats.map((chat) => ({
      ...chat,
      documentIds: chat.documentIds.filter((docId) => docId !== id),
    }));
    this.writeLocal(local);
  }

  // --- Chunks (preview & verification) ---

  public async replaceDocumentChunks(
    documentId: string,
    chunks: DocumentChunkRecord[]
  ): Promise<void> {
    if (await this.ensureConnection()) {
      const col = this.col<DocumentChunkRecord>('chunks');
      await col.deleteMany({ documentId });
      if (chunks.length > 0) {
        await col.insertMany(chunks);
      }
      return;
    }
    const local = this.readLocal();
    local.chunks = local.chunks.filter((c) => c.documentId !== documentId).concat(chunks);
    this.writeLocal(local);
  }

  public async getDocumentChunks(
    documentId: string,
    limit = 60
  ): Promise<DocumentChunkRecord[]> {
    if (await this.ensureConnection()) {
      return this.col<DocumentChunkRecord>('chunks')
        .find({ documentId }, { projection: { _id: 0 } })
        .sort({ chunkIndex: 1 })
        .limit(limit)
        .toArray();
    }
    const local = this.readLocal();
    return local.chunks
      .filter((c) => c.documentId === documentId)
      .sort((a, b) => a.chunkIndex - b.chunkIndex)
      .slice(0, limit);
  }

  // --- Background Jobs ---

  public async listJobs(limit = 30): Promise<IngestionJobRecord[]> {
    if (await this.ensureConnection()) {
      return this.col<IngestionJobRecord>('jobs')
        .find({}, { projection: { _id: 0 } })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
    }
    const local = this.readLocal();
    return [...local.jobs]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  public async upsertJob(job: IngestionJobRecord): Promise<void> {
    if (await this.ensureConnection()) {
      await this.col<IngestionJobRecord>('jobs').updateOne(
        { id: job.id },
        { $set: job },
        { upsert: true }
      );
      return;
    }
    const local = this.readLocal();
    const idx = local.jobs.findIndex((j) => j.id === job.id);
    if (idx >= 0) {
      local.jobs[idx] = job;
    } else {
      local.jobs.unshift(job);
    }
    this.writeLocal(local);
  }

  public async updateJob(
    id: string,
    patch: Partial<IngestionJobRecord>
  ): Promise<void> {
    const updatedAt = new Date().toISOString();
    if (await this.ensureConnection()) {
      await this.col<IngestionJobRecord>('jobs').updateOne(
        { id },
        { $set: { ...patch, updatedAt } }
      );
      return;
    }
    const local = this.readLocal();
    const idx = local.jobs.findIndex((j) => j.id === id);
    if (idx >= 0) {
      local.jobs[idx] = { ...local.jobs[idx], ...patch, updatedAt };
      this.writeLocal(local);
    }
  }

  // --- Chats ---

  public async listChats(): Promise<ChatThreadRecord[]> {
    if (await this.ensureConnection()) {
      return this.col<ChatThreadRecord>('chats')
        .find({}, { projection: { _id: 0 } })
        .sort({ updatedAt: -1 })
        .toArray();
    }
    const local = this.readLocal();
    return [...local.chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  public async getChat(id: string): Promise<ChatThreadRecord | null> {
    if (await this.ensureConnection()) {
      return (
        (await this.col<ChatThreadRecord>('chats').findOne(
          { id },
          { projection: { _id: 0 } }
        )) || null
      );
    }
    const local = this.readLocal();
    return local.chats.find((c) => c.id === id) || null;
  }

  public async createChat(chat: ChatThreadRecord): Promise<ChatThreadRecord> {
    if (await this.ensureConnection()) {
      await this.col<ChatThreadRecord>('chats').insertOne({ ...chat });
      return chat;
    }
    const local = this.readLocal();
    local.chats.unshift(chat);
    this.writeLocal(local);
    return chat;
  }

  public async updateChat(
    id: string,
    patch: Partial<ChatThreadRecord>
  ): Promise<ChatThreadRecord | null> {
    const updatedAt = new Date().toISOString();
    if (await this.ensureConnection()) {
      await this.col<ChatThreadRecord>('chats').updateOne(
        { id },
        { $set: { ...patch, updatedAt } }
      );
      return this.getChat(id);
    }
    const local = this.readLocal();
    const idx = local.chats.findIndex((c) => c.id === id);
    if (idx < 0) return null;
    local.chats[idx] = { ...local.chats[idx], ...patch, updatedAt };
    this.writeLocal(local);
    return local.chats[idx];
  }

  public async appendChatMessage(
    chatId: string,
    message: ChatMessageRecord,
    newTitle?: string
  ): Promise<ChatThreadRecord | null> {
    const updatedAt = new Date().toISOString();
    if (await this.ensureConnection()) {
      const updateOp: {
        $push: { messages: ChatMessageRecord };
        $set: { updatedAt: string; title?: string };
      } = {
        $push: { messages: message },
        $set: { updatedAt },
      };
      if (newTitle) {
        updateOp.$set.title = newTitle;
      }
      await this.col<ChatThreadRecord>('chats').updateOne({ id: chatId }, updateOp);
      return this.getChat(chatId);
    }
    const local = this.readLocal();
    const idx = local.chats.findIndex((c) => c.id === chatId);
    if (idx < 0) return null;
    local.chats[idx].messages.push(message);
    local.chats[idx].updatedAt = updatedAt;
    if (newTitle) {
      local.chats[idx].title = newTitle;
    }
    this.writeLocal(local);
    return local.chats[idx];
  }

  public async deleteChat(id: string): Promise<void> {
    if (await this.ensureConnection()) {
      await this.col<ChatThreadRecord>('chats').deleteOne({ id });
      return;
    }
    const local = this.readLocal();
    local.chats = local.chats.filter((c) => c.id !== id);
    this.writeLocal(local);
  }
}

export const dataStore = new DataStore();
