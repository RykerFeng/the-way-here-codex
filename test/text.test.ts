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

test("chunkText tracks Markdown heading paths", () => {
  const chunks = chunkText([
    "# 使用指南",
    "",
    "开场说明。",
    "",
    "## 单会话启用",
    "",
    "这份资料只影响当前会话。",
    "",
    "### 停用",
    "",
    "说停用资料库即可。",
  ].join("\n"), 30);

  const scoped = chunks.find((chunk) => chunk.content.includes("只影响当前会话"));
  const stopped = chunks.find((chunk) => chunk.content.includes("停用资料库"));
  assert.deepEqual(scoped?.headingPath, ["使用指南", "单会话启用"]);
  assert.deepEqual(stopped?.headingPath, ["使用指南", "单会话启用", "停用"]);
  assert.deepEqual([scoped?.startLine, scoped?.endLine], [5, 7]);
});

test("chunkText splits oversized paragraphs into citation-sized chunks", () => {
  const longParagraph = Array.from({ length: 40 }, (_value, index) => `第${index + 1}句提供可核对的信息。`).join("");
  const chunks = chunkText(`# 长文\n\n${longParagraph}`, 120);

  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((chunk) => chunk.content.length <= 180));
  assert.ok(chunks.every((chunk) => chunk.headingPath[0] === "长文"));
  assert.equal(chunks.map((chunk) => chunk.content).join("").replace(/^# 长文\s*/, ""), longParagraph);
});
