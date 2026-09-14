import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MemoryError } from "./errors.js";
import { evidenceExcerpt, meaningfulQueryTokens, normalizeQuery, scoreCandidate } from "./retrieval.js";
import { chunkText, indexTokens } from "./text.js";
import type { ExportSnapshot, ImportDocumentInput, ImportDocumentResult, ReadSourceResult, SearchHit, SourceKind, SourceRecord, StoreStatus } from "./types.js";

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
  heading_path: string;
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
        heading_path TEXT NOT NULL DEFAULT '[]',
        UNIQUE(object_hash, ordinal)
      );
    `);
    migrateToV2(database);
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
          this.database.prepare("INSERT INTO chunks(id, object_hash, ordinal, start_line, end_line, content, heading_path) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .run(chunkId, objectHash, chunk.ordinal, chunk.startLine, chunk.endLine, chunk.content, JSON.stringify(chunk.headingPath));
          this.database.prepare("INSERT INTO chunks_fts(chunk_id, heading_tokens, body_tokens) VALUES (?, ?, ?)")
            .run(chunkId, indexTokens(chunk.headingPath.join(" ")).join(" "), indexTokens(chunk.content).join(" "));
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
    const normalized = normalizeQuery(query);
    if (!normalized) return [];
    const tokens = meaningfulQueryTokens(normalized);
    if (tokens.length === 0) return [];
    const rows = new Map<string, SearchRow>();
    if (tokens.length > 0 && !(tokens.length === 1 && [...tokens[0]!].length === 1)) {
      const match = tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(" OR ");
      const matched = this.database.prepare(`
        SELECT c.id AS chunk_id, c.object_hash, c.start_line, c.end_line, c.content, c.heading_path,
               s.id AS source_id, s.origin, s.title, bm25(chunks_fts, 0.0, 5.0, 1.0) AS rank
        FROM chunks_fts
        JOIN chunks c ON c.id = chunks_fts.chunk_id
        JOIN sources s ON s.object_hash = c.object_hash AND s.deleted_at IS NULL
        WHERE chunks_fts MATCH ?
        LIMIT 200
      `).all(match) as unknown as SearchRow[];
      for (const row of matched) rows.set(`${row.source_id}:${row.chunk_id}`, row);
    }

    const exactContent = this.database.prepare(`
      SELECT c.id AS chunk_id, c.object_hash, c.start_line, c.end_line, c.content, c.heading_path,
             s.id AS source_id, s.origin, s.title, 0 AS rank
      FROM sources s
      JOIN chunks c ON c.object_hash = s.object_hash
      WHERE s.deleted_at IS NULL AND instr(lower(c.content), lower(?)) > 0
      LIMIT 200
    `).all(normalized) as unknown as SearchRow[];
    for (const row of exactContent) rows.set(`${row.source_id}:${row.chunk_id}`, row);

    const titleMatches = this.database.prepare(`
      SELECT c.id AS chunk_id, c.object_hash, c.start_line, c.end_line, c.content, c.heading_path,
             s.id AS source_id, s.origin, s.title, 0 AS rank
      FROM sources s
      JOIN chunks c ON c.object_hash = s.object_hash AND c.ordinal = 0
      WHERE s.deleted_at IS NULL AND instr(lower(s.title), lower(?)) > 0
      LIMIT 200
    `).all(normalized) as unknown as SearchRow[];
    for (const row of titleMatches) rows.set(`${row.source_id}:${row.chunk_id}`, row);

    return [...rows.values()]
      .map((row): SearchHit | null => {
        const headingPath = parseHeadingPath(row.heading_path);
        const lexical = scoreCandidate(normalized, { title: row.title, heading: headingPath.join(" "), body: row.content }, row.rank);
        if (!lexical) return null;
        return {
          sourceId: row.source_id,
          chunkId: row.chunk_id,
          title: row.title,
          origin: row.origin,
          objectHash: row.object_hash,
          excerpt: evidenceExcerpt(row.content, normalized, lexical.terms),
          startLine: row.start_line,
          endLine: row.end_line,
          headingPath,
          coverage: lexical.coverage,
          exact: lexical.exact,
          matchedQueries: [query.trim()],
          score: lexical.score,
        };
      })
      .filter((hit): hit is SearchHit => hit !== null)
      .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, "zh-CN"))
      .slice(0, Math.max(1, Math.min(limit, 30)));
  }

  query(queries: string[], limit = 8): SearchHit[] {
    const unique = [...new Set(queries.map((query) => query.normalize("NFKC").trim()).filter(Boolean))].slice(0, 6);
    if (unique.length === 0) return [];
    const fused = new Map<string, SearchHit & { rrf: number; bestLexical: number }>();
    unique.forEach((query, queryIndex) => {
      const weight = queryIndex === 0 ? 1.25 : 1;
      this.search(query, 30).forEach((hit, rank) => {
        const key = `${hit.sourceId}:${hit.chunkId}`;
        const existing = fused.get(key);
        const contribution = weight / (60 + rank + 1);
        if (existing) {
          existing.rrf += contribution;
          existing.bestLexical = Math.max(existing.bestLexical, hit.score);
          existing.coverage = Math.max(existing.coverage, hit.coverage);
          existing.exact ||= hit.exact;
          if (!existing.matchedQueries.includes(query)) existing.matchedQueries.push(query);
        } else {
          fused.set(key, { ...hit, matchedQueries: [query], rrf: contribution, bestLexical: hit.score });
        }
      });
    });

    const ranked = [...fused.values()]
      .map(({ rrf, bestLexical, ...hit }) => ({ ...hit, score: rrf + bestLexical / 10_000 }))
      .sort((left, right) => right.score - left.score || right.coverage - left.coverage || left.title.localeCompare(right.title, "zh-CN"));
    const counts = new Map<string, number>();
    const diverse: SearchHit[] = [];
    for (const hit of ranked) {
      const count = counts.get(hit.sourceId) ?? 0;
      if (count >= 2) continue;
      counts.set(hit.sourceId, count + 1);
      diverse.push(hit);
      if (diverse.length >= Math.max(1, Math.min(limit, 30))) break;
    }
    return diverse;
  }

  readSource(sourceId: string, startLine = 1, endLine = 200): ReadSourceResult {
    const row = this.database.prepare(`
      SELECT s.id, s.kind, s.origin, s.title, s.object_hash, s.imported_at, s.deleted_at, o.content
      FROM sources s JOIN objects o ON o.hash = s.object_hash
      WHERE s.id = ? AND s.deleted_at IS NULL
    `).get(sourceId) as (SourceRow & { content: string }) | undefined;
    if (!row) throw new MemoryError("SOURCE_NOT_FOUND", "资料不存在或已经移除。", false, "先运行 search 找到资料 ID。 ");
    const lines = row.content.split("\n");
    const safeStart = Math.max(1, Math.min(Math.floor(startLine), lines.length));
    const safeEnd = Math.max(safeStart, Math.min(Math.floor(endLine), lines.length));
    return {
      source: this.mapSource(row),
      startLine: safeStart,
      endLine: safeEnd,
      totalLines: lines.length,
      content: lines.slice(safeStart - 1, safeEnd).join("\n"),
    };
  }

  exportSnapshot(): ExportSnapshot {
    const rows = this.database.prepare(`
      SELECT s.id, s.kind, s.origin, s.title, s.object_hash, s.imported_at, s.deleted_at, o.content
      FROM sources s JOIN objects o ON o.hash = s.object_hash
      WHERE s.deleted_at IS NULL ORDER BY s.imported_at, s.id
    `).all() as unknown as Array<SourceRow & { content: string }>;
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      sources: rows.map((row) => ({ ...this.mapSource(row), content: row.content })),
    };
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

function migrateToV2(database: DatabaseSync): void {
  const version = Number((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  const chunkColumns = database.prepare("PRAGMA table_info(chunks)").all() as Array<{ name: string }>;
  const ftsExists = Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chunks_fts'").get());
  const ftsColumns = ftsExists ? database.prepare("PRAGMA table_info(chunks_fts)").all() as Array<{ name: string }> : [];
  if (version >= 2 && chunkColumns.some((column) => column.name === "heading_path") && ftsColumns.some((column) => column.name === "heading_tokens")) return;

  database.exec("BEGIN IMMEDIATE");
  try {
    if (!chunkColumns.some((column) => column.name === "heading_path")) {
      database.exec("ALTER TABLE chunks ADD COLUMN heading_path TEXT NOT NULL DEFAULT '[]'");
    }
    if (ftsExists) database.exec("DROP TABLE chunks_fts");
    database.exec("CREATE VIRTUAL TABLE chunks_fts USING fts5(chunk_id UNINDEXED, heading_tokens, body_tokens)");
    const chunks = database.prepare("SELECT id, content, heading_path FROM chunks").all() as Array<{ id: string; content: string; heading_path: string }>;
    const insert = database.prepare("INSERT INTO chunks_fts(chunk_id, heading_tokens, body_tokens) VALUES (?, ?, ?)");
    for (const chunk of chunks) {
      const heading = parseHeadingPath(chunk.heading_path).join(" ");
      insert.run(chunk.id, indexTokens(heading).join(" "), indexTokens(chunk.content).join(" "));
    }
    database.exec("PRAGMA user_version = 2; COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function parseHeadingPath(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}
