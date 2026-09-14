import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { MemoryStore } from "../src/store.js";

test("opens a v1 space, preserves evidence, and upgrades its index", async () => {
  const space = await mkdtemp(path.join(os.tmpdir(), "way-here-migration-"));
  const database = new DatabaseSync(path.join(space, "memory.sqlite"));
  database.exec(`
    CREATE TABLE objects (hash TEXT PRIMARY KEY, content TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE sources (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, origin TEXT NOT NULL, original_path TEXT,
      title TEXT NOT NULL, object_hash TEXT NOT NULL REFERENCES objects(hash),
      imported_at TEXT NOT NULL, deleted_at TEXT, UNIQUE(kind, origin, object_hash)
    );
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY, object_hash TEXT NOT NULL REFERENCES objects(hash), ordinal INTEGER NOT NULL,
      start_line INTEGER NOT NULL, end_line INTEGER NOT NULL, content TEXT NOT NULL,
      UNIQUE(object_hash, ordinal)
    );
    CREATE VIRTUAL TABLE chunks_fts USING fts5(chunk_id UNINDEXED, body_tokens);
    INSERT INTO objects VALUES ('hash', '# 旧资料\n\n迁移后仍能找到关键证据。', '2026-01-01T00:00:00.000Z');
    INSERT INTO sources VALUES ('source-v1', 'file', 'old.md', NULL, '旧资料', 'hash', '2026-01-01T00:00:00.000Z', NULL);
    INSERT INTO chunks VALUES ('chunk-v1', 'hash', 0, 1, 3, '# 旧资料\n\n迁移后仍能找到关键证据。');
    INSERT INTO chunks_fts VALUES ('chunk-v1', '迁移 移后 后仍 仍能 能找 找到 到关 关键 键证 证据');
    PRAGMA user_version = 1;
  `);
  database.close();

  const store = await MemoryStore.open(space);
  try {
    assert.equal(store.search("关键证据")[0]?.sourceId, "source-v1");
  } finally {
    store.close();
  }

  const migrated = new DatabaseSync(path.join(space, "memory.sqlite"));
  try {
    const version = migrated.prepare("PRAGMA user_version").get() as { user_version: number };
    const chunkColumns = migrated.prepare("PRAGMA table_info(chunks)").all() as Array<{ name: string }>;
    const ftsColumns = migrated.prepare("PRAGMA table_info(chunks_fts)").all() as Array<{ name: string }>;
    const rebuilt = migrated.prepare("SELECT heading_path, start_line, end_line FROM chunks WHERE object_hash = 'hash'").get() as { heading_path: string; start_line: number; end_line: number };
    assert.equal(version.user_version, 2);
    assert.ok(chunkColumns.some((column) => column.name === "heading_path"));
    assert.ok(ftsColumns.some((column) => column.name === "heading_tokens"));
    assert.deepEqual(JSON.parse(rebuilt.heading_path), ["旧资料"]);
    assert.deepEqual([rebuilt.start_line, rebuilt.end_line], [1, 3]);
  } finally {
    migrated.close();
  }
});
