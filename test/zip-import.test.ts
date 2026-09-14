import assert from "node:assert/strict";
import { createWriteStream } from "node:fs";
import { access, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ZipFile } from "yazl";
import { MemoryStore } from "../src/store.js";
import { importZip, validateZipEntry } from "../src/import/zip.js";

async function makeZip(target: string, entries: Array<[string, string]>): Promise<void> {
  const zip = new ZipFile();
  for (const [name, value] of entries) zip.addBuffer(Buffer.from(value), name);
  zip.end();
  await new Promise<void>((resolve, reject) => {
    zip.outputStream.pipe(createWriteStream(target)).on("close", resolve).on("error", reject);
  });
}

test("imports supported ZIP entries, skips binaries, and remains idempotent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "way-here-zip-"));
  const zipPath = path.join(root, "资料.zip");
  await makeZip(zipPath, [
    ["notes/工作.md", "# 工作\n\n今天完成了索引。"],
    ["pages/page.html", "<title>网页</title><main>项目复盘</main>"],
    ["images/photo.png", "not really an image"],
  ]);
  const store = await MemoryStore.open(path.join(root, "space"));
  try {
    const first = await importZip(store, zipPath);
    const second = await importZip(store, zipPath);
    assert.equal(first.imported.length, 2);
    assert.equal(first.skipped.length, 1);
    assert.equal(first.skipped[0]?.code, "UNSUPPORTED_TYPE");
    assert.equal(second.imported.every((item) => !item.sourceCreated), true);
    assert.equal(store.search("项目").length, 1);
  } finally {
    store.close();
  }
});

test("validates hostile ZIP entry metadata before reading", () => {
  assert.equal(validateZipEntry({ fileName: "../escape.md", generalPurposeBitFlag: 0, externalFileAttributes: 0 }), "UNSAFE_PATH");
  assert.equal(validateZipEntry({ fileName: "/absolute.md", generalPurposeBitFlag: 0, externalFileAttributes: 0 }), "UNSAFE_PATH");
  assert.equal(validateZipEntry({ fileName: "secret.md", generalPurposeBitFlag: 1, externalFileAttributes: 0 }), "ENCRYPTED_ENTRY");
  assert.equal(validateZipEntry({ fileName: "link.md", generalPurposeBitFlag: 0, externalFileAttributes: 0o120777 << 16 }), "SYMLINK_ENTRY");
});

test("enforces entry, per-file, and total extracted limits without writing outside the space", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "way-here-limits-"));
  const zipPath = path.join(root, "limits.zip");
  await makeZip(zipPath, [["one.md", "123456"], ["two.md", "abcdef"]]);
  const store = await MemoryStore.open(path.join(root, "space"));
  try {
    const perFile = await importZip(store, zipPath, { maxEntryBytes: 5 });
    assert.equal(perFile.imported.length, 0);
    assert.equal(perFile.skipped.every((item) => item.code === "ENTRY_TOO_LARGE"), true);

    const total = await importZip(store, zipPath, { maxEntryBytes: 20, maxTotalBytes: 7 });
    assert.equal(total.imported.length, 1);
    assert.equal(total.skipped.some((item) => item.code === "TOTAL_TOO_LARGE"), true);

    const count = await importZip(store, zipPath, { maxEntries: 1 });
    assert.equal(count.skipped.some((item) => item.code === "TOO_MANY_ENTRIES"), true);
    await assert.rejects(access(path.join(root, "escape.md")));
  } finally {
    store.close();
  }
});
