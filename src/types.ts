export type SourceKind = "file" | "web" | "chat" | "text";
export type SourcePurpose = "memory" | "reference";
export type Authorship = "user" | "other" | "mixed" | "unknown";
export type RecallMode = "moment" | "change" | "relationship" | "pattern" | "quote";

export interface ImportDocumentInput {
  kind: SourceKind;
  origin: string;
  title: string;
  content: string;
  originalPath?: string;
  purpose?: SourcePurpose;
  authorship?: Authorship;
  occurredAt?: string | null;
  occurredEnd?: string | null;
}

export interface SourceRecord {
  id: string;
  kind: SourceKind;
  origin: string;
  title: string;
  objectHash: string;
  importedAt: string;
  deletedAt: string | null;
  purpose: SourcePurpose;
  authorship: Authorship;
  occurredAt: string | null;
  occurredEnd: string | null;
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

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorResult {
  schemaVersion: number;
  checks: DoctorCheck[];
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
  headingPath: string[];
  coverage: number;
  exact: boolean;
  matchedQueries: string[];
  score: number;
  purpose: SourcePurpose;
  authorship: Authorship;
  occurredAt: string | null;
}

export interface RecallOptions {
  mode: RecallMode;
  limit?: number;
  includeReferences?: boolean;
}

export interface RecallResult {
  mode: RecallMode;
  hits: SearchHit[];
  distinctPeriods: string[];
  sufficient: boolean;
  reason: string;
}

export interface RememberEntryInput {
  title: string;
  content: string;
  occurredAt: string;
  context?: string;
}

export interface JourneyOverview {
  memories: number;
  references: number;
  datedMemories: number;
  earliestMemory: string | null;
  latestMemory: string | null;
  starterPrompts: string[];
}

export interface ReadSourceResult {
  source: SourceRecord;
  startLine: number;
  endLine: number;
  totalLines: number;
  content: string;
}

export interface ExportSnapshot {
  version: 2;
  exportedAt: string;
  sources: Array<SourceRecord & { content: string }>;
}
