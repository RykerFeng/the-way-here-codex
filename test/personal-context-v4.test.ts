import assert from "node:assert/strict";
import { mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ZipFile } from "yazl";
import { importGitHub, parseGitHubUrl } from "../src/import/github.js";
import { importFiles } from "../src/import/import-files.js";
import { importYuque, parseYuqueUrl } from "../src/import/yuque.js";
import { connectProfile, detectConnectionKind, ensureProfile, profileSpace, readProfile } from "../src/profile.js";
import { MemoryStore } from "../src/store.js";

async function zipBuffer(entries: Array<[string, string]>): Promise<Buffer> {
  const zip = new ZipFile();
  for (const [name, value] of entries) zip.addBuffer(Buffer.from(value), name);
  zip.end();
  const chunks: Buffer[] = [];
  return await new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on("error", reject);
  });
}

test("one profile connects websites, Yuque, GitHub, ZIP, and folders without global configuration", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "way-here-profile-"));
  const space = profileSpace("me", root);
  await ensureProfile(space);
  const inputs = [
    "https://example.com/journal",
    "https://www.yuque.com/alice/life",
    "https://github.com/alice/notes",
    path.join(root, "past.zip"),
    path.join(root, "diary"),
  ];
  for (const input of inputs) await connectProfile(space, input, { purpose: "memory", authorship: "user" });
  const profile = await readProfile(space);
  assert.deepEqual(profile?.connections.map((item) => item.kind), ["web", "yuque", "github", "local", "local"]);
  assert.ok(profile?.connections.every((item) => item.contentScope === "unknown"));
  assert.equal(profile?.connections.length, 5);
  assert.doesNotMatch(await readFile(path.join(space, "profile.json"), "utf8"), /TOKEN|secret/i);
});

test("connection detection and URL parsers keep source routing explicit", () => {
  assert.equal(detectConnectionKind("https://notes.yuque.com/life/today"), "yuque");
  assert.equal(detectConnectionKind("https://github.com/a/b"), "github");
  assert.deepEqual(parseYuqueUrl("https://www.yuque.com/alice/life/today"), { book: "alice/life", slug: "today", host: "https://www.yuque.com" });
  assert.deepEqual(parseGitHubUrl("https://github.com/alice/notes/tree/dev"), { owner: "alice", repo: "notes", ref: "dev" });
});

test("Yuque authorized import preserves author and platform times", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "way-here-yuque-"));
  const store = await MemoryStore.open(path.join(root, "space"));
  const calls: string[][] = [];
  try {
    const result = await importYuque(store, "https://www.yuque.com/alice/life", {
      purpose: "memory",
      authorship: "user",
      contentScope: "unknown",
      connectionId: "yuque-1",
      environment: { ...process.env, YUQUE_TOKEN: "not-written-to-disk" },
      runner: async (args) => {
        calls.push(args);
        if (args[1] === "list") return JSON.stringify({ data: [{ id: 7, slug: "first", title: "第一次出发" }] });
        return JSON.stringify({ data: {
          id: 7, slug: "first", title: "第一次出发", body_markdown: "# 第一次出发\n\n那天我决定独自去远方。",
          created_at: "2024-01-02T03:04:05Z", content_updated_at: "2024-02-03T03:04:05Z", user: { name: "Alice" },
        } });
      },
    });
    assert.equal(result.adapter, "yuque-api");
    assert.equal(result.imported.length, 1);
    assert.equal(result.imported[0]?.source.author, "Alice");
    assert.equal(result.imported[0]?.source.publishedAt, "2024-01-02T03:04:05.000Z");
    assert.equal(result.imported[0]?.source.modifiedAt, "2024-02-03T03:04:05.000Z");
    assert.equal(result.imported[0]?.source.subject, null);
    assert.equal(calls.length, 2);
  } finally {
    store.close();
  }
});

test("Yuque without a token falls back to the public website path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "way-here-yuque-public-"));
  const store = await MemoryStore.open(path.join(root, "space"));
  let usedFallback = false;
  try {
    const result = await importYuque(store, "https://www.yuque.com/alice/life", {
      environment: {},
      webFallback: async () => {
        usedFallback = true;
        return { imported: [], skipped: [], unchanged: 0 };
      },
    });
    assert.equal(result.adapter, "public-web");
    assert.equal(usedFallback, true);
  } finally {
    store.close();
  }
});

test("GitHub imports the default branch snapshot but cites stable repository paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "way-here-github-"));
  const store = await MemoryStore.open(path.join(root, "space"));
  const archive = await zipBuffer([
    ["notes-trunk/README.md", "# 来时路\n\n这里记录了我做项目时的取舍。"],
    ["notes-trunk/src/index.ts", "not supported"],
  ]);
  const calls: string[] = [];
  const fetcher = async (url: string | URL | Request) => {
    const value = String(url);
    calls.push(value);
    if (value.includes("api.github.com")) return Response.json({ default_branch: "trunk" });
    return new Response(archive, { status: 200, headers: { "content-type": "application/zip", "content-length": String(archive.length) } });
  };
  try {
    const result = await importGitHub(store, "https://github.com/alice/notes", { fetcher: fetcher as typeof fetch, connectionId: "github-1" });
    assert.equal(result.adapter, "github-archive");
    assert.equal(result.ref, "trunk");
    assert.equal(result.imported.length, 1);
    assert.equal(result.imported[0]?.source.origin, "https://github.com/alice/notes/tree/trunk#README.md");
    assert.equal(store.search("项目 取舍")[0]?.origin, "https://github.com/alice/notes/tree/trunk#README.md");
    assert.equal(calls.length, 2);
  } finally {
    store.close();
  }
});

test("a changed remote document supersedes its old version without erasing provenance", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "way-here-version-"));
  const store = await MemoryStore.open(path.join(root, "space"));
  try {
    const first = store.importDocument({ kind: "web", origin: "https://example.com/me", title: "旧想法", content: "我原本只想离开。", externalId: "doc-1", connectionId: "site-1", purpose: "memory", authorship: "user", contentScope: "personal" });
    const second = store.importDocument({ kind: "web", origin: "https://example.com/me", title: "新想法", content: "我后来决定先完成手上的事。", externalId: "doc-1", connectionId: "site-1", purpose: "memory", authorship: "user", contentScope: "personal" });
    assert.equal(store.listSources().length, 1);
    assert.equal(store.listSources()[0]?.id, second.source.id);
    assert.equal(store.readSource(first.source.id, 1, 10).source.isCurrent, false);
    assert.equal(store.readSource(first.source.id, 1, 10).source.supersededAt !== null, true);
    assert.equal(store.search("原本只想离开").length, 0);
    assert.equal(store.search("决定先完成")[0]?.sourceId, second.source.id);
  } finally {
    store.close();
  }
});

test("event time stays separate from the time a local document was edited", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "way-here-three-times-"));
  const note = path.join(root, "2021-04-03-回忆.md");
  await writeFile(note, "# 那次决定\n\n那天我决定换一条路。\n");
  await utimes(note, new Date("2026-09-14T08:00:00Z"), new Date("2026-09-14T08:00:00Z"));
  const store = await MemoryStore.open(path.join(root, "space"));
  try {
    const source = (await importFiles(store, note, { purpose: "memory", authorship: "user", contentScope: "personal" })).imported[0]!.source;
    assert.equal(source.occurredAt, "2021-04-03");
    assert.equal(source.eventTimeProvenance, "filename");
    assert.equal(source.modifiedAt, "2026-09-14T08:00:00.000Z");
    assert.notEqual(source.observedAt, source.modifiedAt);
  } finally {
    store.close();
  }
});

test("ordinary conversation is not persisted unless remember is called", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "way-here-consent-"));
  const store = await MemoryStore.open(path.join(root, "space"));
  try {
    assert.equal(store.status().sources, 0);
    await writeFile(path.join(root, "conversation.txt"), "这段对话没有被自动保存");
    assert.equal(store.status().sources, 0);
    store.remember({ title: "明确留下", content: "我明确要求把这句话留下。", occurredAt: "2026-09-15" });
    assert.equal(store.status().sources, 1);
  } finally {
    store.close();
  }
});

test("fiction and excerpts cannot become personal history, while unknown ownership forces abstention", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "way-here-attribution-"));
  const store = await MemoryStore.open(path.join(root, "space"));
  try {
    store.importDocument({ kind: "text", origin: "novel.md", title: "小说", content: "我在海边辞掉了工作。", purpose: "memory", authorship: "user", contentScope: "fictional" });
    store.importDocument({ kind: "text", origin: "excerpt.md", title: "书摘", content: "作者说离开前要存六个月现金。", purpose: "memory", authorship: "user", contentScope: "sourced" });
    store.importDocument({ kind: "web", origin: "https://example.com/post", title: "归属未知", content: "我曾经因为害怕失败而停下。", purpose: "memory", authorship: "user", contentScope: "unknown" });

    assert.equal(store.recall(["海边辞掉工作"], { mode: "moment" }).hits.length, 0);
    assert.equal(store.recall(["六个月现金"], { mode: "moment" }).hits.length, 0);
    const unknown = store.recall(["害怕失败 停下"], { mode: "moment" });
    assert.equal(unknown.hits.length, 1);
    assert.equal(unknown.sufficient, false);
    assert.match(unknown.reason, /不能据此断言/);
    store.markSource(unknown.hits[0]!.sourceId, "memory", "user", "personal");
    assert.equal(store.recall(["害怕失败 停下"], { mode: "moment" }).sufficient, true);
  } finally {
    store.close();
  }
});
