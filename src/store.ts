import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MemoryError } from "./errors.js";
import type { ImportDocumentInput, ImportDocumentResult, SourceKind, SourceRecord, StoreStatus } from "./types.js";

interface SourceRow {
  id: string;
  kind: SourceKind;
  origin: string;
  title: string;
  object_hash: string;
  imported_at: string;
  deleted_at: string | null;
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
        const lineCount = content.split("\n").length;
        this.database.prepare("INSERT INTO chunks(id, object_hash, ordinal, start_line, end_line, content) VALUES (?, ?, 0, 1, ?, ?)")
          .run(randomUUID(), objectHash, lineCount, content);
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
}
