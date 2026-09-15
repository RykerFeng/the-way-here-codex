import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { MemoryError } from "../errors.js";
import type { MemoryStore } from "../store.js";
import { isSupportedFileName, normalizeFileContent } from "./file-content.js";
import { importZip, type ImportLimits, type ImportSummary } from "./zip.js";
import type { Authorship, ContentScope, SourcePurpose, SyncProgress } from "../types.js";

export interface ImportFileOptions extends ImportLimits {
  purpose?: SourcePurpose;
  authorship?: Authorship;
  contentScope?: ContentScope;
  connectionId?: string;
  onProgress?: (progress: SyncProgress) => void;
}

export async function importFiles(store: MemoryStore, inputPath: string, options: ImportFileOptions = {}): Promise<ImportSummary> {
  const resolved = path.resolve(inputPath);
  const info = await stat(resolved).catch(() => null);
  if (!info) throw new MemoryError("FILE_NOT_FOUND", "找不到要导入的文件或目录。", false, "检查输入路径。 ");
  if (info.isDirectory()) return importDirectory(store, resolved, options);
  if (!info.isFile()) throw new MemoryError("UNSUPPORTED_TYPE", "输入既不是普通文件也不是目录。", false, "改用 ZIP、文本文件或普通目录。 ");
  if (path.extname(resolved).toLocaleLowerCase() === ".zip") return importZip(store, resolved, options);
  if (!isSupportedFileName(resolved)) {
    throw new MemoryError("UNSUPPORTED_TYPE", "暂不支持这种文件。", false, "请使用 ZIP、Markdown、TXT、HTML 或 JSON。 ");
  }
  const maxEntryBytes = options.maxEntryBytes ?? 10 * 1024 * 1024;
  if (info.size > maxEntryBytes) throw new MemoryError("ENTRY_TOO_LARGE", "文件太大。", false, "拆分文件或使用更小的资料包。 ");
  const bytes = await readFile(resolved);
  const documents = normalizeFileContent(resolved, bytes);
  const result: ImportSummary = { imported: [], skipped: [] };
  for (const document of documents) {
    const origin = `${resolved}${document.originSuffix ? `#${document.originSuffix}` : ""}`;
    const imported = store.importDocument({
      kind: document.kind,
      origin,
      title: document.title,
      content: document.content,
      originalPath: resolved,
      purpose: options.purpose ?? document.purpose,
      authorship: options.authorship ?? document.authorship,
      occurredAt: document.occurredAt,
      occurredEnd: document.occurredEnd,
      eventTimeProvenance: document.eventTimeProvenance,
      modifiedAt: info.mtime.toISOString(),
      contentScope: options.contentScope,
      connectionId: options.connectionId,
    });
    result.imported.push({ ...imported, entry: path.basename(resolved) });
  }
  if (documents.length === 0) result.skipped.push({ entry: path.basename(resolved), code: "EMPTY_CONTENT", message: "文件没有可导入的正文。" });
  options.onProgress?.(progressOf(result));
  return result;
}

async function importDirectory(store: MemoryStore, directory: string, options: ImportFileOptions): Promise<ImportSummary> {
  const result: ImportSummary = { imported: [], skipped: [] };
  const maxEntries = options.maxEntries ?? 20_000;
  const ignored = new Set([".git", "node_modules", "dist", ".next", "coverage"]);
  const queue = [directory];
  let seen = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))) {
      if (ignored.has(entry.name) || entry.isSymbolicLink()) continue;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(target);
        continue;
      }
      seen += 1;
      if (seen > maxEntries) {
        result.skipped.push({ entry: path.relative(directory, target), code: "TOO_MANY_ENTRIES", message: `目录超过 ${maxEntries} 个文件。` });
        return result;
      }
      if (!isSupportedFileName(target) && path.extname(target).toLocaleLowerCase() !== ".zip") continue;
      const imported = await importFiles(store, target, options);
      result.imported.push(...imported.imported);
      result.skipped.push(...imported.skipped);
      options.onProgress?.(progressOf(result));
    }
  }
  return result;
}

function progressOf(result: ImportSummary): SyncProgress {
  const unchanged = result.imported.filter((item) => !item.sourceCreated && !item.objectCreated).length;
  return {
    completed: result.imported.length + result.skipped.length,
    total: null,
    imported: result.imported.length - unchanged,
    unchanged,
    skipped: result.skipped.length,
  };
}
