import assert from "node:assert/strict";
import test from "node:test";
import { chunkText, indexTokens, queryTokens } from "../src/text.js";

test("indexTokens emits Chinese bigrams and folded Latin words", () => {
  const tokens = indexTokens("工作焦虑 TypeScript 2026");
  assert.ok(tokens.includes("工作"));
  assert.ok(tokens.includes("作焦"));
  assert.ok(tokens.includes("焦虑"));
  assert.ok(tokens.includes("typescript"));
  assert.ok(tokens.includes("2026"));
});

test("queryTokens removes duplicates and FTS syntax", () => {
  assert.deepEqual(queryTokens('工作 工作 "OR"'), ["工作", "or"]);
});

test("chunkText keeps one-based line ranges", () => {
  const chunks = chunkText("第一段。\n\n第二段比较长。", 8);
  assert.deepEqual(chunks.map(({ startLine, endLine }) => [startLine, endLine]), [[1, 1], [3, 3]]);
  assert.equal(chunks[1]?.content, "第二段比较长。");
});
