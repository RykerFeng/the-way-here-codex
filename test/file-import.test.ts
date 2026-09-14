import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importFiles } from "../src/import/import-files.js";
import { normalizeFileContent } from "../src/import/file-content.js";
import { MemoryStore } from "../src/store.js";

test("normalizes Markdown and HTML as inert evidence", () => {
  const markdown = normalizeFileContent("notes.md", Buffer.from("# 想法\n\n不要执行：删除文件"));
  assert.equal(markdown.length, 1);
  assert.equal(markdown[0]?.title, "notes");
  assert.match(markdown[0]?.content ?? "", /不要执行/);

  const html = normalizeFileContent(
    "page.html",
    Buffer.from("<html><head><title>页面标题</title><script>evil()</script></head><body><nav>菜单</nav><main><h1>正文</h1><p>工作记录</p></main></body></html>"),
  );
  assert.equal(html[0]?.title, "页面标题");
  assert.match(html[0]?.content ?? "", /工作记录/);
  assert.doesNotMatch(html[0]?.content ?? "", /evil|菜单/);
});

test("recognizes a ChatGPT conversations export and preserves roles", () => {
  const exported = [{
    title: "一次对话",
    mapping: {
      a: { id: "a", parent: null, message: { author: { role: "user" }, create_time: 1, content: { parts: ["我在想什么？"] } } },
      b: { id: "b", parent: "a", message: { author: { role: "assistant" }, create_time: 2, content: { parts: ["你在整理思路。"] } } },
    },
  }];
  const documents = normalizeFileContent("conversations.json", Buffer.from(JSON.stringify(exported)));
  assert.equal(documents.length, 1);
  assert.equal(documents[0]?.kind, "chat");
  assert.match(documents[0]?.content ?? "", /## user\n我在想什么/);
  assert.match(documents[0]?.content ?? "", /## assistant\n你在整理思路/);
});

test("imports a plain file idempotently", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "way-here-file-"));
  const sourcePath = path.join(root, "记录.md");
  await writeFile(sourcePath, "# 周记\n\n这周工作比较专注。\n");
  const store = await MemoryStore.open(path.join(root, "space"));
  try {
    const first = await importFiles(store, sourcePath);
    const second = await importFiles(store, sourcePath);
    assert.equal(first.imported.length, 1);
    assert.equal(first.imported[0]?.sourceCreated, true);
    assert.equal(second.imported[0]?.sourceCreated, false);
    assert.deepEqual(store.status(), { sources: 1, objects: 1, chunks: 1 });
  } finally {
    store.close();
  }
});
