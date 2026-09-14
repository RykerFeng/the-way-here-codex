import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MemoryStore } from "../src/store.js";

test("deduplicates content while preserving separate source origins", async () => {
  const space = await mkdtemp(path.join(os.tmpdir(), "way-here-store-"));
  const store = await MemoryStore.open(space);

  const first = store.importDocument({
    kind: "file",
    origin: "diary-a.md",
    title: "第一份日记",
    content: "今天工作让我有些焦虑。",
  });
  const second = store.importDocument({
    kind: "file",
    origin: "copied/diary-b.md",
    title: "第二份日记",
    content: "今天工作让我有些焦虑。",
  });

  assert.notEqual(first.source.id, second.source.id);
  assert.equal(first.objectCreated, true);
  assert.equal(second.objectCreated, false);
  assert.deepEqual(store.status(), { sources: 2, objects: 1, chunks: 1 });

  store.removeSource(first.source.id);
  assert.deepEqual(store.status(), { sources: 1, objects: 1, chunks: 1 });
  store.close();
});

test("reopening a space keeps imported evidence and treats repeats as idempotent", async () => {
  const space = await mkdtemp(path.join(os.tmpdir(), "way-here-reopen-"));
  const initial = await MemoryStore.open(space);
  const imported = initial.importDocument({
    kind: "text",
    origin: "conversation:one",
    title: "一次对话",
    content: "我更喜欢把任务拆小。",
  });
  const repeated = initial.importDocument({
    kind: "text",
    origin: "conversation:one",
    title: "一次对话",
    content: "我更喜欢把任务拆小。",
  });
  assert.equal(repeated.source.id, imported.source.id);
  assert.equal(repeated.sourceCreated, false);
  initial.close();

  const reopened = await MemoryStore.open(space);
  assert.deepEqual(reopened.status(), { sources: 1, objects: 1, chunks: 1 });
  reopened.close();
});
