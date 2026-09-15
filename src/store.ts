import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MemoryError } from "./errors.js";
import { evidenceExcerpt, meaningfulQueryTokens, normalizeQuery, scoreCandidate } from "./retrieval.js";
import { buildRecallResult } from "./story.js";
import { chunkText, indexTokens } from "./text.js";
import { inferDate, inferDateRange, normalizeDate } from "./time.js";
import type { Authorship, DoctorResult, ExportSnapshot, ImportDocumentInput, ImportDocumentResult, JourneyOverview, ReadSourceResult, RecallOptions, RecallResult, RememberEntryInput, SearchHit, SourceKind, SourcePurpose, SourceRecord, StoreStatus } from "./types.js";

interface QueryFilter {
  purpose?: SourcePurpose;
  maxPerSource?: number;
}

interface SourceRow {
  id: string;
  kind: SourceKind;
  origin: string;
  title: string;
  object_hash: string;
  imported_at: string;
  deleted_at: string | null;
  purpose: SourcePurpose;
  authorship: Authorship;
  occurred_at: string | null;
  occurred_end: string | null;
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
  purpose: SourcePurpose;
  authorship: Authorship;
  source_occurred_at: string | null;
  source_occurred_end: string | null;
  chunk_occurred_at: string | null;
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
        purpose TEXT NOT NULL DEFAULT 'reference',
        authorship TEXT NOT NULL DEFAULT 'unknown',
        occurred_at TEXT,
        occurred_end TEXT,
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
        occurred_at TEXT,
        UNIQUE(object_hash, ordinal)
      );
    `);
    migrateToV3(database);
    return new MemoryStore(database);
  }

  importDocument(input: ImportDocumentInput): ImportDocumentResult {
    const content = input.content.replace(/\r\n?/g, "\n").trim();
    if (!content) throw new MemoryError("EMPTY_CONTENT", "资料没有可保存的文字。", false, "提供包含正文的文件或网页。");
    const objectHash = createHash("sha256").update(content).digest("hex");
    const importedAt = new Date().toISOString();
    const defaultPurpose = input.kind === "chat" ? "memory" : "reference";
    const defaultAuthorship = input.kind === "chat" ? "mixed" : "unknown";
    const inferredRange = inferDateRange([input.title, input.origin, content]);
    const occurredAt = normalizeOptionalDate(input.occurredAt) ?? inferredRange?.start ?? null;
    const occurredEnd = normalizeOptionalDate(input.occurredEnd) ?? (input.occurredAt ? occurredAt : inferredRange?.end) ?? occurredAt;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existingObject = this.database.prepare("SELECT hash FROM objects WHERE hash = ?").get(objectHash);
      const objectCreated = !existingObject;
      if (objectCreated) {
        this.database.prepare("INSERT INTO objects(hash, content, created_at) VALUES (?, ?, ?)").run(objectHash, content, importedAt);
        for (const chunk of chunkText(content)) {
          const chunkId = randomUUID();
          const chunkOccurredAt = inferDate([...chunk.headingPath.slice().reverse(), chunk.content.slice(0, 240)])?.date ?? null;
          this.database.prepare("INSERT INTO chunks(id, object_hash, ordinal, start_line, end_line, content, heading_path, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .run(chunkId, objectHash, chunk.ordinal, chunk.startLine, chunk.endLine, chunk.content, JSON.stringify(chunk.headingPath), chunkOccurredAt);
          this.database.prepare("INSERT INTO chunks_fts(chunk_id, heading_tokens, body_tokens) VALUES (?, ?, ?)")
            .run(chunkId, indexTokens(chunk.headingPath.join(" ")).join(" "), indexTokens(chunk.content).join(" "));
        }
      }

      const existing = this.database.prepare(
        "SELECT id, kind, origin, title, object_hash, imported_at, deleted_at, purpose, authorship, occurred_at, occurred_end FROM sources WHERE kind = ? AND origin = ? AND object_hash = ?",
      ).get(input.kind, input.origin, objectHash) as SourceRow | undefined;
      if (existing) {
        const purpose = input.purpose ?? existing.purpose;
        const authorship = input.authorship ?? existing.authorship;
        this.database.prepare("UPDATE sources SET deleted_at = NULL, purpose = ?, authorship = ?, occurred_at = ?, occurred_end = ? WHERE id = ?")
          .run(purpose, authorship, occurredAt ?? existing.occurred_at, occurredEnd ?? existing.occurred_end, existing.id);
        this.database.exec("COMMIT");
        return {
          source: this.mapSource({
            ...existing,
            deleted_at: null,
            purpose,
            authorship,
            occurred_at: occurredAt ?? existing.occurred_at,
            occurred_end: occurredEnd ?? existing.occurred_end,
          }),
          sourceCreated: false,
          objectCreated,
        };
      }

      const id = randomUUID();
      const purpose = input.purpose ?? defaultPurpose;
      const authorship = input.authorship ?? defaultAuthorship;
      this.database.prepare(
        "INSERT INTO sources(id, kind, origin, original_path, title, object_hash, imported_at, deleted_at, purpose, authorship, occurred_at, occurred_end) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)",
      ).run(id, input.kind, input.origin, input.originalPath ?? null, input.title, objectHash, importedAt, purpose, authorship, occurredAt, occurredEnd);
      this.database.exec("COMMIT");
      return {
        source: { id, kind: input.kind, origin: input.origin, title: input.title, objectHash, importedAt, deletedAt: null, purpose, authorship, occurredAt, occurredEnd },
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
    if (result.changes === 0) throw new MemoryError("SOURCE_NOT_FOUND", "资料不存在或已经移除。", false, "先运行 sources 检查资料 ID。");
  }

  listSources(): SourceRecord[] {
    const rows = this.database.prepare(`
      SELECT id, kind, origin, title, object_hash, imported_at, deleted_at, purpose, authorship, occurred_at, occurred_end
      FROM sources WHERE deleted_at IS NULL ORDER BY imported_at DESC, id
    `).all() as unknown as SourceRow[];
    return rows.map((row) => this.mapSource(row));
  }

  doctor(): DoctorResult {
    const schemaVersion = Number((this.database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
    const integrity = String((this.database.prepare("PRAGMA quick_check").get() as { quick_check: string }).quick_check);
    const ftsTable = Boolean(this.database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chunks_fts'").get());
    return {
      schemaVersion,
      checks: [
        { name: "database", ok: integrity === "ok", detail: integrity === "ok" ? "SQLite 可读且完整" : integrity },
        { name: "schema", ok: schemaVersion === 3, detail: `schema v${schemaVersion}` },
        { name: "fts5", ok: ftsTable, detail: ftsTable ? "全文索引可用" : "缺少 chunks_fts" },
      ],
    };
  }

  search(query: string, limit = 8, filter: QueryFilter = {}): SearchHit[] {
    const normalized = normalizeQuery(query);
    if (!normalized) return [];
    const tokens = meaningfulQueryTokens(normalized);
    if (tokens.length === 0) return [];
    const rows = new Map<string, SearchRow>();
    if (tokens.length > 0 && !(tokens.length === 1 && [...tokens[0]!].length === 1)) {
      const match = tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(" OR ");
      const matched = this.database.prepare(`
        SELECT c.id AS chunk_id, c.object_hash, c.start_line, c.end_line, c.content, c.heading_path,
               s.id AS source_id, s.origin, s.title, s.purpose, s.authorship,
               s.occurred_at AS source_occurred_at, s.occurred_end AS source_occurred_end,
               c.occurred_at AS chunk_occurred_at,
               bm25(chunks_fts, 0.0, 5.0, 1.0) AS rank
        FROM chunks_fts
        JOIN chunks c ON c.id = chunks_fts.chunk_id
        JOIN sources s ON s.object_hash = c.object_hash AND s.deleted_at IS NULL
        WHERE chunks_fts MATCH ? AND (? IS NULL OR s.purpose = ?)
        ORDER BY rank
        LIMIT 300
      `).all(match, filter.purpose ?? null, filter.purpose ?? null) as unknown as SearchRow[];
      for (const row of matched) rows.set(`${row.source_id}:${row.chunk_id}`, row);
    }

    const exactContent = this.database.prepare(`
      SELECT c.id AS chunk_id, c.object_hash, c.start_line, c.end_line, c.content, c.heading_path,
             s.id AS source_id, s.origin, s.title, s.purpose, s.authorship,
             s.occurred_at AS source_occurred_at, s.occurred_end AS source_occurred_end,
             c.occurred_at AS chunk_occurred_at, 0 AS rank
      FROM sources s
      JOIN chunks c ON c.object_hash = s.object_hash
      WHERE s.deleted_at IS NULL AND instr(lower(c.content), lower(?)) > 0
        AND (? IS NULL OR s.purpose = ?)
      LIMIT 200
    `).all(normalized, filter.purpose ?? null, filter.purpose ?? null) as unknown as SearchRow[];
    for (const row of exactContent) rows.set(`${row.source_id}:${row.chunk_id}`, row);

    const titleMatches = this.database.prepare(`
      SELECT c.id AS chunk_id, c.object_hash, c.start_line, c.end_line, c.content, c.heading_path,
             s.id AS source_id, s.origin, s.title, s.purpose, s.authorship,
             s.occurred_at AS source_occurred_at, s.occurred_end AS source_occurred_end,
             c.occurred_at AS chunk_occurred_at, 0 AS rank
      FROM sources s
      JOIN chunks c ON c.object_hash = s.object_hash AND c.ordinal = 0
      WHERE s.deleted_at IS NULL AND instr(lower(s.title), lower(?)) > 0
        AND (? IS NULL OR s.purpose = ?)
      LIMIT 200
    `).all(normalized, filter.purpose ?? null, filter.purpose ?? null) as unknown as SearchRow[];
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
          purpose: row.purpose,
          authorship: row.authorship,
          occurredAt: row.chunk_occurred_at
            ?? (row.source_occurred_at === row.source_occurred_end ? row.source_occurred_at : null),
        };
      })
      .filter((hit): hit is SearchHit => hit !== null)
      .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, "zh-CN"))
      .slice(0, Math.max(1, Math.min(limit, 30)));
  }

  query(queries: string[], limit = 8, filter: QueryFilter = {}): SearchHit[] {
    const unique = [...new Set(queries.map((query) => query.normalize("NFKC").trim()).filter(Boolean))].slice(0, 6);
    if (unique.length === 0) return [];
    const fused = new Map<string, SearchHit & { rrf: number; bestLexical: number }>();
    unique.forEach((query, queryIndex) => {
      const weight = queryIndex === 0 ? 1.25 : 1;
      this.search(query, 30, filter).forEach((hit, rank) => {
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
      if (count >= (filter.maxPerSource ?? 2)) continue;
      counts.set(hit.sourceId, count + 1);
      diverse.push(hit);
      if (diverse.length >= Math.max(1, Math.min(limit, 30))) break;
    }
    return diverse;
  }

  recall(queries: string[], options: RecallOptions): RecallResult {
    const candidates = this.query(queries, 30, {
      purpose: options.includeReferences ? undefined : "memory",
      maxPerSource: options.mode === "change" || options.mode === "pattern" ? 8 : 2,
    });
    return buildRecallResult(options.mode, candidates, options.limit ?? 8);
  }

  remember(entry: RememberEntryInput): ImportDocumentResult {
    const title = entry.title.normalize("NFKC").replace(/\s+/g, " ").trim();
    const content = entry.content.replace(/\r\n?/g, "\n").trim();
    const context = entry.context?.replace(/\r\n?/g, "\n").trim();
    if (!title || title.length > 120) throw new MemoryError("INVALID_ENTRY", "记忆标题不能为空且不能超过 120 个字符。", false, "使用一句简短标题。");
    if (!content || content.length > 100_000) throw new MemoryError("INVALID_ENTRY", "记忆正文不能为空且不能超过 100,000 个字符。", false, "缩短内容后重试。");
    const occurredAt = normalizeOptionalDate(entry.occurredAt);
    if (!occurredAt) throw new MemoryError("INVALID_DATE", "记忆必须有明确日期。", false, "使用 YYYY-MM-DD、YYYY-MM 或 YYYY。");
    const body = [`# ${title}`, `## ${occurredAt} · 你选择留下的话`, content];
    if (context) body.push("## 当时的背景（由 Codex 整理）", context);
    const rendered = body.join("\n\n");
    const stableId = createHash("sha256").update(`${occurredAt}\u0000${title}\u0000${rendered}`).digest("hex").slice(0, 24);
    return this.importDocument({
      kind: "text",
      origin: `remembered:${occurredAt}:${stableId}`,
      title,
      content: rendered,
      purpose: "memory",
      authorship: context ? "mixed" : "user",
      occurredAt,
      occurredEnd: occurredAt,
    });
  }

  markSource(sourceId: string, purpose: SourcePurpose, authorship?: Authorship): SourceRecord {
    const result = this.database.prepare("UPDATE sources SET purpose = ?, authorship = coalesce(?, authorship) WHERE id = ? AND deleted_at IS NULL")
      .run(purpose, authorship ?? null, sourceId);
    if (result.changes === 0) throw new MemoryError("SOURCE_NOT_FOUND", "资料不存在或已经移除。", false, "先运行 sources 检查资料 ID。");
    const row = this.database.prepare(`
      SELECT id, kind, origin, title, object_hash, imported_at, deleted_at, purpose, authorship, occurred_at, occurred_end
      FROM sources WHERE id = ?
    `).get(sourceId) as unknown as SourceRow;
    return this.mapSource(row);
  }

  overview(): JourneyOverview {
    const counts = this.database.prepare(`
      SELECT
        sum(CASE WHEN purpose = 'memory' THEN 1 ELSE 0 END) AS memories,
        sum(CASE WHEN purpose = 'reference' THEN 1 ELSE 0 END) AS reference_count,
        sum(CASE WHEN purpose = 'memory' AND occurred_at IS NOT NULL THEN 1 ELSE 0 END) AS dated_memories,
        min(CASE WHEN purpose = 'memory' THEN occurred_at END) AS earliest_memory,
        max(CASE WHEN purpose = 'memory' THEN coalesce(occurred_end, occurred_at) END) AS latest_memory
      FROM sources WHERE deleted_at IS NULL
    `).get() as { memories: number | null; reference_count: number | null; dated_memories: number | null; earliest_memory: string | null; latest_memory: string | null };
    return {
      memories: Number(counts.memories ?? 0),
      references: Number(counts.reference_count ?? 0),
      datedMemories: Number(counts.dated_memories ?? 0),
      earliestMemory: counts.earliest_memory,
      latestMemory: counts.latest_memory,
      starterPrompts: [
        "上次走到类似处境时，我后来是怎么选择的？",
        "这几年，我对同一件事的想法发生过什么变化？",
        "有哪些曾经困住我的事，现在已经不再困住我？",
      ],
    };
  }

  readSource(sourceId: string, startLine = 1, endLine = 200): ReadSourceResult {
    const row = this.database.prepare(`
      SELECT s.id, s.kind, s.origin, s.title, s.object_hash, s.imported_at, s.deleted_at,
             s.purpose, s.authorship, s.occurred_at, s.occurred_end, o.content
      FROM sources s JOIN objects o ON o.hash = s.object_hash
      WHERE s.id = ? AND s.deleted_at IS NULL
    `).get(sourceId) as (SourceRow & { content: string }) | undefined;
    if (!row) throw new MemoryError("SOURCE_NOT_FOUND", "资料不存在或已经移除。", false, "先运行 query 或 sources 找到资料 ID。");
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
      SELECT s.id, s.kind, s.origin, s.title, s.object_hash, s.imported_at, s.deleted_at,
             s.purpose, s.authorship, s.occurred_at, s.occurred_end, o.content
      FROM sources s JOIN objects o ON o.hash = s.object_hash
      WHERE s.deleted_at IS NULL ORDER BY s.imported_at, s.id
    `).all() as unknown as Array<SourceRow & { content: string }>;
    return {
      version: 2,
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
      purpose: row.purpose,
      authorship: row.authorship,
      occurredAt: row.occurred_at,
      occurredEnd: row.occurred_end,
    };
  }

}

function migrateToV3(database: DatabaseSync): void {
  const version = Number((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  const sourceColumns = database.prepare("PRAGMA table_info(sources)").all() as Array<{ name: string }>;
  const chunkColumns = database.prepare("PRAGMA table_info(chunks)").all() as Array<{ name: string }>;
  const ftsExists = Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chunks_fts'").get());
  const ftsColumns = ftsExists ? database.prepare("PRAGMA table_info(chunks_fts)").all() as Array<{ name: string }> : [];
  const complete = version >= 3
    && ["purpose", "authorship", "occurred_at", "occurred_end"].every((name) => sourceColumns.some((column) => column.name === name))
    && ["heading_path", "occurred_at"].every((name) => chunkColumns.some((column) => column.name === name))
    && ftsColumns.some((column) => column.name === "heading_tokens");
  if (complete) return;

  database.exec("BEGIN IMMEDIATE");
  try {
    if (!sourceColumns.some((column) => column.name === "purpose")) {
      database.exec("ALTER TABLE sources ADD COLUMN purpose TEXT NOT NULL DEFAULT 'reference'");
    }
    if (!sourceColumns.some((column) => column.name === "authorship")) {
      database.exec("ALTER TABLE sources ADD COLUMN authorship TEXT NOT NULL DEFAULT 'unknown'");
    }
    if (!sourceColumns.some((column) => column.name === "occurred_at")) database.exec("ALTER TABLE sources ADD COLUMN occurred_at TEXT");
    if (!sourceColumns.some((column) => column.name === "occurred_end")) database.exec("ALTER TABLE sources ADD COLUMN occurred_end TEXT");
    if (!chunkColumns.some((column) => column.name === "heading_path")) {
      database.exec("ALTER TABLE chunks ADD COLUMN heading_path TEXT NOT NULL DEFAULT '[]'");
    }
    if (!chunkColumns.some((column) => column.name === "occurred_at")) database.exec("ALTER TABLE chunks ADD COLUMN occurred_at TEXT");
    if (ftsExists) database.exec("DROP TABLE chunks_fts");
    database.exec("CREATE VIRTUAL TABLE chunks_fts USING fts5(chunk_id UNINDEXED, heading_tokens, body_tokens)");
    const objects = database.prepare("SELECT hash, content FROM objects").all() as Array<{ hash: string; content: string }>;
    database.exec("DELETE FROM chunks");
    const insertChunk = database.prepare("INSERT INTO chunks(id, object_hash, ordinal, start_line, end_line, content, heading_path, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    const insertFts = database.prepare("INSERT INTO chunks_fts(chunk_id, heading_tokens, body_tokens) VALUES (?, ?, ?)");
    for (const object of objects) {
      for (const chunk of chunkText(object.content)) {
        const chunkId = randomUUID();
        const occurredAt = inferDate([...chunk.headingPath.slice().reverse(), chunk.content.slice(0, 240)])?.date ?? null;
        insertChunk.run(chunkId, object.hash, chunk.ordinal, chunk.startLine, chunk.endLine, chunk.content, JSON.stringify(chunk.headingPath), occurredAt);
        insertFts.run(chunkId, indexTokens(chunk.headingPath.join(" ")).join(" "), indexTokens(chunk.content).join(" "));
      }
    }
    if (version < 3) {
      database.exec(`
        UPDATE sources
        SET purpose = CASE WHEN kind = 'chat' THEN 'memory' ELSE 'reference' END,
            authorship = CASE WHEN kind = 'chat' THEN 'mixed' ELSE 'unknown' END
      `);
      const migratedSources = database.prepare(`
        SELECT s.id, s.title, s.origin, o.content
        FROM sources s JOIN objects o ON o.hash = s.object_hash
      `).all() as Array<{ id: string; title: string; origin: string; content: string }>;
      const updateDate = database.prepare("UPDATE sources SET occurred_at = ?, occurred_end = ? WHERE id = ?");
      for (const source of migratedSources) {
        const range = inferDateRange([source.title, source.origin, source.content]);
        updateDate.run(range?.start ?? null, range?.end ?? null, source.id);
      }
    }
    database.exec("PRAGMA user_version = 3; COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function normalizeOptionalDate(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const normalized = normalizeDate(value);
  if (!normalized) throw new MemoryError("INVALID_DATE", `无法识别日期：${value}`, false, "使用 YYYY-MM-DD、YYYY-MM 或 YYYY。");
  return normalized.date;
}

function parseHeadingPath(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}
