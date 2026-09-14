export type SourceKind = "file" | "web" | "chat" | "text";

export interface ImportDocumentInput {
  kind: SourceKind;
  origin: string;
  title: string;
  content: string;
  originalPath?: string;
}

export interface SourceRecord {
  id: string;
  kind: SourceKind;
  origin: string;
  title: string;
  objectHash: string;
  importedAt: string;
  deletedAt: string | null;
}

export interface ImportDocumentResult {
  source: SourceRecord;
  sourceCreated: boolean;
  objectCreated: boolean;
}

export interface StoreStatus {
  sources: number;
  objects: number;
  chunks: number;
}

export interface SearchHit {
  sourceId: string;
  chunkId: string;
  title: string;
  origin: string;
  objectHash: string;
  excerpt: string;
  startLine: number;
  endLine: number;
  score: number;
}
