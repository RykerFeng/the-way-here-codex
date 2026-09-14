import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MemoryStore } from "../src/store.js";

test("filters generic overlap instead of returning weak evidence", async () => {
  const space = await mkdtemp(path.join(os.tmpdir(), "way-here-abstain-"));
  const store = await MemoryStore.open(space);
  try {
    store.importDocument({
      kind: "file", origin: "manual.md", title: "聊天页面手册",
      content: "这个页面介绍怎么切换聊天，以及污染检查按钮在哪里。",
    });

    assert.deepEqual(store.search("怎么避免污染别的聊天"), []);
    assert.deepEqual(store.query(["月球奶酪采购预算"], 5), []);
  } finally {
    store.close();
  }
});

test("fuses a paraphrase with a keyword route and ranks the intended evidence first", async () => {
  const space = await mkdtemp(path.join(os.tmpdir(), "way-here-fusion-"));
  const store = await MemoryStore.open(space);
  try {
    const intended = store.importDocument({
      kind: "file", origin: "scope.md", title: "资料库作用范围",
      content: "# 作用范围\n\n资料库只有在你明确加载 LOAD.md 的当前 Codex 会话中使用。它不会自动影响其他聊天。",
    });
    store.importDocument({
      kind: "web", origin: "https://example.com/chat", title: "聊天页面手册",
      content: "这个页面介绍怎么切换聊天，以及污染检查按钮在哪里。",
    });

    const hits = store.query(["怎么避免污染别的聊天", "单会话 当前会话 不影响 其他聊天"], 5);

    assert.equal(hits[0]?.sourceId, intended.source.id);
    assert.ok((hits[0]?.coverage ?? 0) >= 0.4);
    assert.deepEqual(hits[0]?.matchedQueries, ["单会话 当前会话 不影响 其他聊天"]);
    assert.match(hits[0]?.excerpt ?? "", /当前 Codex 会话/);
  } finally {
    store.close();
  }
});

test("limits one source to two results in a fused answer", async () => {
  const space = await mkdtemp(path.join(os.tmpdir(), "way-here-diversity-"));
  const store = await MemoryStore.open(space);
  try {
    store.importDocument({
      kind: "file", origin: "long.md", title: "证据方法长文",
      content: Array.from({ length: 8 }, (_value, index) => `## 方法 ${index + 1}\n\n证据引用需要精确定位原文，这是第 ${index + 1} 种方法。`).join("\n\n"),
    });
    store.importDocument({
      kind: "file", origin: "short.md", title: "补充原则",
      content: "# 补充\n\n证据引用还需要清晰标明资料来源。",
    });

    const hits = store.query(["证据引用 精确 原文", "证据引用 资料来源"], 8);
    const counts = new Map<string, number>();
    for (const hit of hits) counts.set(hit.sourceId, (counts.get(hit.sourceId) ?? 0) + 1);
    assert.ok([...counts.values()].every((count) => count <= 2));
    assert.equal(new Set(hits.map((hit) => hit.origin)).has("short.md"), true);
  } finally {
    store.close();
  }
});
