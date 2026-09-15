import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MemoryError } from "./errors.js";
import { evidenceExcerpt, meaningfulQueryTokens, normalizeQuery, scoreCandidate } from "./retrieval.js";
import { buildRecallResult } from "./story.js";
import { chunkText, indexTokens } from "./text.js";
import { inferDate, inferDateRange, normalizeDate } from "./time.js";
import type { Authorship, ContentScope, DoctorResult, ExportSnapshot, ImportDocumentInput, ImportDocumentResult, JourneyOverview, ReadSourceResult, RecallOptions, RecallResult, RememberEntryInput, SearchHit, SourceKind, SourcePurpose, SourceRecord, StoreStatus, SyncJobRecord, SyncJobState, TimeProvenance } from "./types.js";

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
  event_time_provenance: TimeProvenance;
  published_at: string | null;
  modified_at: string | null;
  observed_at: string;
  author: string | null;
  speaker: string | null;
  subject: string | null;
  content_scope: ContentScope;
  external_id: string | null;
  connection_id: string | null;
  is_current: number;
  superseded_at: string | null;
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
  subject: string | null;
  content_scope: ContentScope;
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
        event_time_provenance TEXT NOT NULL DEFAULT 'unknown',
        published_at TEXT,
        modified_at TEXT,
        observed_at TEXT NOT NULL DEFAULT '',
        author TEXT,
        speaker TEXT,
        subject TEXT,
        content_scope TEXT NOT NULL DEFAULT 'unknown',
        external_id TEXT,
        connection_id TEXT,
        is_current INTEGER NOT NULL DEFAULT 1,
        superseded_at TEXT,
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
      CREATE TABLE IF NOT EXISTS sync_jobs (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL,
        state TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        total INTEGER,
        imported INTEGER NOT NULL DEFAULT 0,
        unchanged INTEGER NOT NULL DEFAULT 0,
        skipped INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    migrateToV4(database);
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
    const purpose = input.purpose ?? defaultPurpose;
    const authorship = input.authorship ?? defaultAuthorship;
    const eventTimeProvenance = input.eventTimeProvenance
      ?? (input.occurredAt || input.occurredEnd ? "explicit" : inferredRange ? "inferred" : "unknown");
    const publishedAt = normalizeOptionalTimestamp(input.publishedAt);
    const modifiedAt = normalizeOptionalTimestamp(input.modifiedAt);
    const observedAt = normalizeOptionalTimestamp(input.observedAt) ?? importedAt;
    const contentScope = input.contentScope ?? (purpose === "memory" && authorship === "user" ? "personal" : "unknown");
    const author = normalizeOptionalText(input.author) ?? (authorship === "user" ? "user" : null);
    const speaker = normalizeOptionalText(input.speaker);
    const subject = normalizeOptionalText(input.subject) ?? (contentScope === "personal" && authorship === "user" ? "user" : null);
    const externalId = normalizeOptionalText(input.externalId);
    const connectionId = normalizeOptionalText(input.connectionId);
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
        `SELECT id, kind, origin, title, object_hash, imported_at, deleted_at, purpose, authorship,
                occurred_at, occurred_end, event_time_provenance, published_at, modified_at, observed_at,
                author, speaker, subject, content_scope, external_id, connection_id, is_current, superseded_at
         FROM sources WHERE kind = ? AND origin = ? AND object_hash = ?`,
      ).get(input.kind, input.origin, objectHash) as SourceRow | undefined;
      if (existing) {
        const preservedPurpose = input.purpose ?? existing.purpose;
        const preservedAuthorship = input.authorship ?? existing.authorship;
        const preservedScope = input.contentScope ?? existing.content_scope;
        const preservedTimeProvenance = input.eventTimeProvenance ?? existing.event_time_provenance;
        this.database.prepare(`
          UPDATE sources SET deleted_at = NULL, purpose = ?, authorship = ?, occurred_at = ?, occurred_end = ?,
            event_time_provenance = ?, published_at = coalesce(?, published_at), modified_at = coalesce(?, modified_at),
            observed_at = ?, author = coalesce(?, author), speaker = coalesce(?, speaker), subject = coalesce(?, subject),
            content_scope = ?, external_id = coalesce(?, external_id), connection_id = coalesce(?, connection_id),
            is_current = 1, superseded_at = NULL
          WHERE id = ?
        `).run(preservedPurpose, preservedAuthorship, occurredAt ?? existing.occurred_at, occurredEnd ?? existing.occurred_end,
          preservedTimeProvenance, publishedAt, modifiedAt, observedAt, author, speaker, subject, preservedScope,
          externalId, connectionId, existing.id);
        this.supersedeOtherVersions(existing.id, input.kind, input.origin, externalId, connectionId, importedAt);
        this.database.exec("COMMIT");
        return {
          source: this.mapSource({
            ...existing,
            deleted_at: null,
            purpose: preservedPurpose,
            authorship: preservedAuthorship,
            occurred_at: occurredAt ?? existing.occurred_at,
            occurred_end: occurredEnd ?? existing.occurred_end,
            event_time_provenance: preservedTimeProvenance,
            published_at: publishedAt ?? existing.published_at,
            modified_at: modifiedAt ?? existing.modified_at,
            observed_at: observedAt,
            author: author ?? existing.author,
            speaker: speaker ?? existing.speaker,
            subject: subject ?? existing.subject,
            content_scope: preservedScope,
            external_id: externalId ?? existing.external_id,
            connection_id: connectionId ?? existing.connection_id,
            is_current: 1,
            superseded_at: null,
          }),
          sourceCreated: false,
          objectCreated,
        };
      }

      const id = randomUUID();
      this.supersedeOtherVersions(id, input.kind, input.origin, externalId, connectionId, importedAt);
      this.database.prepare(`
        INSERT INTO sources(
          id, kind, origin, original_path, title, object_hash, imported_at, deleted_at, purpose, authorship,
          occurred_at, occurred_end, event_time_provenance, published_at, modified_at, observed_at,
          author, speaker, subject, content_scope, external_id, connection_id, is_current, superseded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)
      `).run(id, input.kind, input.origin, input.originalPath ?? null, input.title, objectHash, importedAt,
        purpose, authorship, occurredAt, occurredEnd, eventTimeProvenance, publishedAt, modifiedAt, observedAt,
        author, speaker, subject, contentScope, externalId, connectionId);
      this.database.exec("COMMIT");
      return {
        source: {
          id, kind: input.kind, origin: input.origin, title: input.title, objectHash, importedAt, deletedAt: null,
          purpose, authorship, occurredAt, occurredEnd, eventTimeProvenance, publishedAt, modifiedAt, observedAt,
          author, speaker, subject, contentScope, externalId, connectionId, isCurrent: true, supersededAt: null,
        },
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
      SELECT id, kind, origin, title, object_hash, imported_at, deleted_at, purpose, authorship,
             occurred_at, occurred_end, event_time_provenance, published_at, modified_at, observed_at,
             author, speaker, subject, content_scope, external_id, connection_id, is_current, superseded_at
      FROM sources WHERE deleted_at IS NULL AND is_current = 1 ORDER BY imported_at DESC, id
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
        { name: "schema", ok: schemaVersion === 4, detail: `schema v${schemaVersion}` },
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
               s.subject, s.content_scope,
               c.occurred_at AS chunk_occurred_at,
               bm25(chunks_fts, 0.0, 5.0, 1.0) AS rank
        FROM chunks_fts
        JOIN chunks c ON c.id = chunks_fts.chunk_id
        JOIN sources s ON s.object_hash = c.object_hash AND s.deleted_at IS NULL
        WHERE chunks_fts MATCH ? AND s.is_current = 1 AND (? IS NULL OR s.purpose = ?)
        ORDER BY rank
        LIMIT 300
      `).all(match, filter.purpose ?? null, filter.purpose ?? null) as unknown as SearchRow[];
      for (const row of matched) rows.set(`${row.source_id}:${row.chunk_id}`, row);
    }

    const exactContent = this.database.prepare(`
      SELECT c.id AS chunk_id, c.object_hash, c.start_line, c.end_line, c.content, c.heading_path,
             s.id AS source_id, s.origin, s.title, s.purpose, s.authorship,
             s.occurred_at AS source_occurred_at, s.occurred_end AS source_occurred_end,
             s.subject, s.content_scope,
             c.occurred_at AS chunk_occurred_at, 0 AS rank
      FROM sources s
      JOIN chunks c ON c.object_hash = s.object_hash
      WHERE s.deleted_at IS NULL AND s.is_current = 1 AND instr(lower(c.content), lower(?)) > 0
        AND (? IS NULL OR s.purpose = ?)
      LIMIT 200
    `).all(normalized, filter.purpose ?? null, filter.purpose ?? null) as unknown as SearchRow[];
    for (const row of exactContent) rows.set(`${row.source_id}:${row.chunk_id}`, row);

    const titleMatches = this.database.prepare(`
      SELECT c.id AS chunk_id, c.object_hash, c.start_line, c.end_line, c.content, c.heading_path,
             s.id AS source_id, s.origin, s.title, s.purpose, s.authorship,
             s.occurred_at AS source_occurred_at, s.occurred_end AS source_occurred_end,
             s.subject, s.content_scope,
             c.occurred_at AS chunk_occurred_at, 0 AS rank
      FROM sources s
      JOIN chunks c ON c.object_hash = s.object_hash AND c.ordinal = 0
      WHERE s.deleted_at IS NULL AND s.is_current = 1 AND instr(lower(s.title), lower(?)) > 0
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
          subject: row.subject,
          contentScope: row.content_scope,
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
      contentScope: "personal",
      author: "user",
      speaker: "user",
      subject: "user",
      occurredAt,
      occurredEnd: occurredAt,
    });
  }

  markSource(sourceId: string, purpose: SourcePurpose, authorship?: Authorship, contentScope?: ContentScope): SourceRecord {
    const result = this.database.prepare(`
      UPDATE sources
      SET purpose = ?,
          authorship = coalesce(?, authorship),
          content_scope = coalesce(?, content_scope),
          subject = CASE
            WHEN ? = 'personal' AND coalesce(?, authorship) = 'user' THEN 'user'
            WHEN ? IN ('sourced', 'fictional') THEN NULL
            ELSE subject
          END
      WHERE id = ? AND deleted_at IS NULL
    `).run(purpose, authorship ?? null, contentScope ?? null, contentScope ?? null, authorship ?? null, contentScope ?? null, sourceId);
    if (result.changes === 0) throw new MemoryError("SOURCE_NOT_FOUND", "资料不存在或已经移除。", false, "先运行 sources 检查资料 ID。");
    const row = this.database.prepare(`
      SELECT id, kind, origin, title, object_hash, imported_at, deleted_at, purpose, authorship,
             occurred_at, occurred_end, event_time_provenance, published_at, modified_at, observed_at,
             author, speaker, subject, content_scope, external_id, connection_id, is_current, superseded_at
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
      FROM sources WHERE deleted_at IS NULL AND is_current = 1
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
             s.purpose, s.authorship, s.occurred_at, s.occurred_end, s.event_time_provenance,
             s.published_at, s.modified_at, s.observed_at, s.author, s.speaker, s.subject,
             s.content_scope, s.external_id, s.connection_id, s.is_current, s.superseded_at, o.content
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
             s.purpose, s.authorship, s.occurred_at, s.occurred_end, s.event_time_provenance,
             s.published_at, s.modified_at, s.observed_at, s.author, s.speaker, s.subject,
             s.content_scope, s.external_id, s.connection_id, s.is_current, s.superseded_at, o.content
      FROM sources s JOIN objects o ON o.hash = s.object_hash
      WHERE s.deleted_at IS NULL AND s.is_current = 1 ORDER BY s.imported_at, s.id
    `).all() as unknown as Array<SourceRow & { content: string }>;
    return {
      version: 3,
      exportedAt: new Date().toISOString(),
      sources: rows.map((row) => ({ ...this.mapSource(row), content: row.content })),
    };
  }

  status(): StoreStatus {
    const sources = this.count("SELECT count(*) AS count FROM sources WHERE deleted_at IS NULL AND is_current = 1");
    const objects = this.count("SELECT count(DISTINCT object_hash) AS count FROM sources WHERE deleted_at IS NULL AND is_current = 1");
    const chunks = this.count("SELECT count(*) AS count FROM chunks WHERE object_hash IN (SELECT object_hash FROM sources WHERE deleted_at IS NULL AND is_current = 1)");
    return { sources, objects, chunks };
  }

  createSyncJob(connectionId: string): SyncJobRecord {
    const now = new Date().toISOString();
    const job: SyncJobRecord = {
      id: randomUUID(), connectionId, state: "pending", completed: 0, total: null,
      imported: 0, unchanged: 0, skipped: 0, error: null, createdAt: now, updatedAt: now,
    };
    this.database.prepare(`
      INSERT INTO sync_jobs(id, connection_id, state, completed, total, imported, unchanged, skipped, error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(job.id, job.connectionId, job.state, job.completed, job.total, job.imported, job.unchanged, job.skipped, job.error, job.createdAt, job.updatedAt);
    return job;
  }

  getActiveSyncJob(connectionId: string): SyncJobRecord | null {
    const row = this.database.prepare(`
      SELECT * FROM sync_jobs
      WHERE connection_id = ? AND state IN ('pending', 'running')
      ORDER BY created_at DESC LIMIT 1
    `).get(connectionId);
    return row ? mapSyncJob(row as Record<string, unknown>) : null;
  }

  updateSyncJob(id: string, patch: Partial<Pick<SyncJobRecord, "state" | "completed" | "total" | "imported" | "unchanged" | "skipped" | "error">>): SyncJobRecord {
    const existing = this.getSyncJob(id);
    if (!existing) throw new MemoryError("SYNC_JOB_NOT_FOUND", "找不到同步任务。", false, "运行 sync --start 创建新的同步任务。");
    const next = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.database.prepare(`
      UPDATE sync_jobs SET state = ?, completed = ?, total = ?, imported = ?, unchanged = ?, skipped = ?, error = ?, updated_at = ?
      WHERE id = ?
    `).run(next.state, next.completed, next.total, next.imported, next.unchanged, next.skipped, next.error, next.updatedAt, id);
    return next;
  }

  getSyncJob(id?: string): SyncJobRecord | null {
    const row = id
      ? this.database.prepare("SELECT * FROM sync_jobs WHERE id = ?").get(id)
      : this.database.prepare("SELECT * FROM sync_jobs ORDER BY created_at DESC LIMIT 1").get();
    if (!row) return null;
    return mapSyncJob(row as Record<string, unknown>);
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
      eventTimeProvenance: row.event_time_provenance,
      publishedAt: row.published_at,
      modifiedAt: row.modified_at,
      observedAt: row.observed_at,
      author: row.author,
      speaker: row.speaker,
      subject: row.subject,
      contentScope: row.content_scope,
      externalId: row.external_id,
      connectionId: row.connection_id,
      isCurrent: row.is_current === 1,
      supersededAt: row.superseded_at,
    };
  }

  private supersedeOtherVersions(id: string, kind: SourceKind, origin: string, externalId: string | null, connectionId: string | null, at: string): void {
    if (externalId && connectionId) {
      this.database.prepare(`
        UPDATE sources SET is_current = 0, superseded_at = ?
        WHERE id <> ? AND deleted_at IS NULL AND is_current = 1 AND connection_id = ? AND external_id = ?
      `).run(at, id, connectionId, externalId);
      return;
    }
    this.database.prepare(`
      UPDATE sources SET is_current = 0, superseded_at = ?
      WHERE id <> ? AND deleted_at IS NULL AND is_current = 1 AND kind = ? AND origin = ?
    `).run(at, id, kind, origin);
  }

}

function migrateToV4(database: DatabaseSync): void {
  const version = Number((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  const sourceColumns = database.prepare("PRAGMA table_info(sources)").all() as Array<{ name: string }>;
  const chunkColumns = database.prepare("PRAGMA table_info(chunks)").all() as Array<{ name: string }>;
  const ftsExists = Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chunks_fts'").get());
  const ftsColumns = ftsExists ? database.prepare("PRAGMA table_info(chunks_fts)").all() as Array<{ name: string }> : [];
  const requiredSourceColumns = [
    "purpose", "authorship", "occurred_at", "occurred_end", "event_time_provenance", "published_at",
    "modified_at", "observed_at", "author", "speaker", "subject", "content_scope", "external_id",
    "connection_id", "is_current", "superseded_at",
  ];
  const complete = version >= 4
    && requiredSourceColumns.every((name) => sourceColumns.some((column) => column.name === name))
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
    if (!sourceColumns.some((column) => column.name === "event_time_provenance")) {
      database.exec("ALTER TABLE sources ADD COLUMN event_time_provenance TEXT NOT NULL DEFAULT 'unknown'");
    }
    if (!sourceColumns.some((column) => column.name === "published_at")) database.exec("ALTER TABLE sources ADD COLUMN published_at TEXT");
    if (!sourceColumns.some((column) => column.name === "modified_at")) database.exec("ALTER TABLE sources ADD COLUMN modified_at TEXT");
    if (!sourceColumns.some((column) => column.name === "observed_at")) {
      database.exec("ALTER TABLE sources ADD COLUMN observed_at TEXT NOT NULL DEFAULT ''");
    }
    if (!sourceColumns.some((column) => column.name === "author")) database.exec("ALTER TABLE sources ADD COLUMN author TEXT");
    if (!sourceColumns.some((column) => column.name === "speaker")) database.exec("ALTER TABLE sources ADD COLUMN speaker TEXT");
    if (!sourceColumns.some((column) => column.name === "subject")) database.exec("ALTER TABLE sources ADD COLUMN subject TEXT");
    if (!sourceColumns.some((column) => column.name === "content_scope")) {
      database.exec("ALTER TABLE sources ADD COLUMN content_scope TEXT NOT NULL DEFAULT 'unknown'");
    }
    if (!sourceColumns.some((column) => column.name === "external_id")) database.exec("ALTER TABLE sources ADD COLUMN external_id TEXT");
    if (!sourceColumns.some((column) => column.name === "connection_id")) database.exec("ALTER TABLE sources ADD COLUMN connection_id TEXT");
    if (!sourceColumns.some((column) => column.name === "is_current")) {
      database.exec("ALTER TABLE sources ADD COLUMN is_current INTEGER NOT NULL DEFAULT 1");
    }
    if (!sourceColumns.some((column) => column.name === "superseded_at")) database.exec("ALTER TABLE sources ADD COLUMN superseded_at TEXT");
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
    database.exec(`
      UPDATE sources
      SET observed_at = CASE WHEN observed_at = '' THEN imported_at ELSE observed_at END,
          event_time_provenance = CASE
            WHEN event_time_provenance = 'unknown' AND occurred_at IS NOT NULL THEN 'inferred'
            ELSE event_time_provenance
          END,
          content_scope = CASE
            WHEN content_scope = 'unknown' AND purpose = 'memory' AND authorship = 'user' THEN 'personal'
            ELSE content_scope
          END,
          author = CASE WHEN author IS NULL AND authorship = 'user' THEN 'user' ELSE author END,
          subject = CASE
            WHEN subject IS NULL AND purpose = 'memory' AND authorship = 'user' THEN 'user'
            ELSE subject
          END
    `);
    database.exec("CREATE INDEX IF NOT EXISTS sources_current_origin ON sources(kind, origin, is_current)");
    database.exec("CREATE INDEX IF NOT EXISTS sources_connection_external ON sources(connection_id, external_id, is_current)");
    database.exec("PRAGMA user_version = 4; COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function normalizeOptionalTimestamp(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const trimmed = value.trim();
  const normalizedDate = normalizeDate(trimmed);
  if (normalizedDate && /^\d{4}(?:-\d{2})?(?:-\d{2})?$/.test(trimmed)) return normalizedDate.date;
  const timestamp = new Date(trimmed);
  if (Number.isNaN(timestamp.getTime())) {
    throw new MemoryError("INVALID_DATE", `无法识别时间：${value}`, false, "使用 ISO 8601 时间或 YYYY-MM-DD 日期。");
  }
  return timestamp.toISOString();
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  return normalized || null;
}

function mapSyncJob(row: Record<string, unknown>): SyncJobRecord {
  return {
    id: String(row.id),
    connectionId: String(row.connection_id),
    state: String(row.state) as SyncJobState,
    completed: Number(row.completed),
    total: row.total === null ? null : Number(row.total),
    imported: Number(row.imported),
    unchanged: Number(row.unchanged),
    skipped: Number(row.skipped),
    error: row.error === null ? null : String(row.error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
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
