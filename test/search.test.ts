import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MemoryStore } from "../src/store.js";

test("search finds a two-character Chinese term with evidence metadata", async () => {
  const space = await mkdtemp(path.join(os.tmpdir(), "way-here-search-"));
  const store = await MemoryStore.open(space);
  store.importDocument({
    kind: "file",
    origin: "diary/2026-09-14.md",
    title: "周日记录",
    content: "早上散步。\n\n下午想到工作时有些焦虑。",
  });

  const [hit] = store.search("工作", 8);
  assert.ok(hit);
  assert.equal(hit.title, "周日记录");
  assert.equal(hit.origin, "diary/2026-09-14.md");
  assert.match(hit.excerpt, /工作/);
  assert.equal(hit.startLine, 1);
  assert.equal(hit.endLine, 3);
  assert.match(hit.objectHash, /^[a-f0-9]{64}$/);
  assert.equal(typeof hit.score, "number");
  store.close();
});

test("search folds English case and ranks title matches", async () => {
  const space = await mkdtemp(path.join(os.tmpdir(), "way-here-rank-"));
  const store = await MemoryStore.open(space);
  const titleMatch = store.importDocument({ kind: "file", origin: "a.md", title: "TypeScript 决策", content: "我们选了静态类型。" });
  store.importDocument({ kind: "file", origin: "b.md", title: "工程记录", content: "这里正文提到了 TYPESCRIPT。" });

  const hits = store.search("typescript");
  assert.equal(hits[0]?.sourceId, titleMatch.source.id);
  assert.equal(hits.length, 2);
  store.close();
});

test("search supports one-character Chinese fallback and excludes removed sources", async () => {
  const space = await mkdtemp(path.join(os.tmpdir(), "way-here-single-"));
  const store = await MemoryStore.open(space);
  const imported = store.importDocument({ kind: "text", origin: "note", title: "饮食", content: "今天吃面。" });
  assert.equal(store.search("面").length, 1);
  store.removeSource(imported.source.id);
  assert.equal(store.search("面").length, 0);
  store.close();
});

test("search returns no results for an empty query", async () => {
  const space = await mkdtemp(path.join(os.tmpdir(), "way-here-empty-"));
  const store = await MemoryStore.open(space);
  assert.deepEqual(store.search("   "), []);
  store.close();
});
