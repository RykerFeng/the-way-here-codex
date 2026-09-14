import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MemoryError } from "./errors.js";
import { chunkText, indexTokens, queryTokens } from "./text.js";
import type { ImportDocumentInput, ImportDocumentResult, SearchHit, SourceKind, SourceRecord, StoreStatus } from "./types.js";

interface SourceRow {
  id: string;
  kind: SourceKind;
  origin: string;
  title: string;
  object_hash: string;
  imported_at: string;
  deleted_at: string | null;
}

interface SearchRow {
  chunk_id: string;
  object_hash: string;
  start_line: number;
  end_line: number;
  content: string;
  source_id: string;
  origin: string;
  title: string;
  rank: number;
}

export class MemoryStore {
  private constructor(private readonly database: DatabaseSync) {}

  static async open(spacePath: string): Promise<MemoryStore> {
    const resolved = path.resolve(spacePath);
    await mkdir(resolved, { recursive: true });
    const database = new DatabaseSync(path.join(resolved, "memory.sqlite"));
    database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");
    database.exec(`
      CREATE TABLE IF NOT EXISTS objects (
        hash TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        origin TEXT NOT NULL,
        original_path TEXT,
        title TEXT NOT NULL,
        object_hash TEXT NOT NULL REFERENCES objects(hash),
        imported_at TEXT NOT NULL,
        deleted_at TEXT,
        UNIQUE(kind, origin, object_hash)
      );
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        object_hash TEXT NOT NULL REFERENCES objects(hash),
        ordinal INTEGER NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        content TEXT NOT NULL,
        UNIQUE(object_hash, ordinal)
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        chunk_id UNINDEXED,
        body_tokens
      );
    `);
    return new MemoryStore(database);
  }

  importDocument(input: ImportDocumentInput): ImportDocumentResult {
    const content = input.content.replace(/\r\n?/g, "\n").trim();
    if (!content) throw new MemoryError("EMPTY_CONTENT", "资料没有可保存的文字。", false, "提供包含正文的文件或网页。");
    const objectHash = createHash("sha256").update(content).digest("hex");
    const importedAt = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existingObject = this.database.prepare("SELECT hash FROM objects WHERE hash = ?").get(objectHash);
      const objectCreated = !existingObject;
      if (objectCreated) {
        this.database.prepare("INSERT INTO objects(hash, content, created_at) VALUES (?, ?, ?)").run(objectHash, content, importedAt);
        for (const chunk of chunkText(content)) {
          const chunkId = randomUUID();
          this.database.prepare("INSERT INTO chunks(id, object_hash, ordinal, start_line, end_line, content) VALUES (?, ?, ?, ?, ?, ?)")
            .run(chunkId, objectHash, chunk.ordinal, chunk.startLine, chunk.endLine, chunk.content);
          this.database.prepare("INSERT INTO chunks_fts(chunk_id, body_tokens) VALUES (?, ?)")
            .run(chunkId, indexTokens(chunk.content).join(" "));
        }
      }

      const existing = this.database.prepare(
        "SELECT id, kind, origin, title, object_hash, imported_at, deleted_at FROM sources WHERE kind = ? AND origin = ? AND object_hash = ?",
      ).get(input.kind, input.origin, objectHash) as SourceRow | undefined;
      if (existing) {
        if (existing.deleted_at) this.database.prepare("UPDATE sources SET deleted_at = NULL WHERE id = ?").run(existing.id);
        this.database.exec("COMMIT");
        return { source: this.mapSource({ ...existing, deleted_at: null }), sourceCreated: false, objectCreated };
      }

      const id = randomUUID();
      this.database.prepare(
        "INSERT INTO sources(id, kind, origin, original_path, title, object_hash, imported_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)",
      ).run(id, input.kind, input.origin, input.originalPath ?? null, input.title, objectHash, importedAt);
      this.database.exec("COMMIT");
      return {
        source: { id, kind: input.kind, origin: input.origin, title: input.title, objectHash, importedAt, deletedAt: null },
        sourceCreated: true,
        objectCreated,
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  removeSource(sourceId: string): void {
    const result = this.database.prepare("UPDATE sources SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL").run(new Date().toISOString(), sourceId);
    if (result.changes === 0) throw new MemoryError("SOURCE_NOT_FOUND", "资料不存在或已经移除。", false, "先运行 status 或 search 检查资料 ID。");
  }

  search(query: string, limit = 8): SearchHit[] {
    const normalized = query.normalize("NFKC").trim();
    if (!normalized) return [];
    const tokens = queryTokens(normalized);
    const rows = new Map<string, SearchRow>();
    if (tokens.length > 0 && !(tokens.length === 1 && [...tokens[0]!].length === 1)) {
      const match = tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(" OR ");
      const matched = this.database.prepare(`
        SELECT c.id AS chunk_id, c.object_hash, c.start_line, c.end_line, c.content,
               s.id AS source_id, s.origin, s.title, bm25(chunks_fts) AS rank
        FROM chunks_fts
        JOIN chunks c ON c.id = chunks_fts.chunk_id
        JOIN sources s ON s.object_hash = c.object_hash AND s.deleted_at IS NULL
        WHERE chunks_fts MATCH ?
        LIMIT 200
      `).all(match) as unknown as SearchRow[];
      for (const row of matched) rows.set(`${row.source_id}:${row.chunk_id}`, row);
    }

    const titleOrSingle = this.database.prepare(`
      SELECT c.id AS chunk_id, c.object_hash, c.start_line, c.end_line, c.content,
             s.id AS source_id, s.origin, s.title, 0 AS rank
      FROM sources s
      JOIN chunks c ON c.object_hash = s.object_hash AND c.ordinal = 0
      WHERE s.deleted_at IS NULL AND (instr(lower(s.title), lower(?)) > 0 OR instr(c.content, ?) > 0)
      LIMIT 200
    `).all(normalized, normalized) as unknown as SearchRow[];
    for (const row of titleOrSingle) rows.set(`${row.source_id}:${row.chunk_id}`, row);

    const queryIndexTokens = new Set(tokens);
    return [...rows.values()]
      .map((row) => {
        const titleMatches = indexTokens(row.title).filter((token) => queryIndexTokens.has(token)).length;
        const score = titleMatches * 10 + Math.max(0, -row.rank) + (row.content.includes(normalized) ? 2 : 0);
        return {
          sourceId: row.source_id,
          chunkId: row.chunk_id,
          title: row.title,
          origin: row.origin,
          objectHash: row.object_hash,
          excerpt: this.excerpt(row.content, normalized),
          startLine: row.start_line,
          endLine: row.end_line,
          score,
        };
      })
      .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, "zh-CN"))
      .slice(0, Math.max(1, Math.min(limit, 30)));
  }

  status(): StoreStatus {
    const sources = this.count("SELECT count(*) AS count FROM sources WHERE deleted_at IS NULL");
    const objects = this.count("SELECT count(DISTINCT object_hash) AS count FROM sources WHERE deleted_at IS NULL");
    const chunks = this.count("SELECT count(*) AS count FROM chunks WHERE object_hash IN (SELECT object_hash FROM sources WHERE deleted_at IS NULL)");
    return { sources, objects, chunks };
  }

  close(): void {
    this.database.close();
  }

  private count(sql: string): number {
    return Number((this.database.prepare(sql).get() as { count: number }).count);
  }

  private mapSource(row: SourceRow): SourceRecord {
    return {
      id: row.id,
      kind: row.kind,
      origin: row.origin,
      title: row.title,
      objectHash: row.object_hash,
      importedAt: row.imported_at,
      deletedAt: row.deleted_at,
    };
  }

  private excerpt(content: string, query: string): string {
    const index = content.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
    if (index < 0) return content.slice(0, 260);
    const start = Math.max(0, index - 90);
    const end = Math.min(content.length, index + query.length + 170);
    return `${start > 0 ? "…" : ""}${content.slice(start, end)}${end < content.length ? "…" : ""}`;
  }
}
