import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { MemoryError } from "../errors.js";
import type { MemoryStore } from "../store.js";
import { isSupportedFileName, normalizeFileContent } from "./file-content.js";
import { importZip, type ImportLimits, type ImportSummary } from "./zip.js";

export async function importFiles(store: MemoryStore, inputPath: string, limits: ImportLimits = {}): Promise<ImportSummary> {
  const resolved = path.resolve(inputPath);
  const info = await stat(resolved).catch(() => null);
  if (!info?.isFile()) throw new MemoryError("FILE_NOT_FOUND", "找不到要导入的文件。", false, "检查文件的绝对路径。 ");
  if (path.extname(resolved).toLocaleLowerCase() === ".zip") return importZip(store, resolved, limits);
  if (!isSupportedFileName(resolved)) {
    throw new MemoryError("UNSUPPORTED_TYPE", "暂不支持这种文件。", false, "请使用 ZIP、Markdown、TXT、HTML 或 JSON。 ");
  }
  const maxEntryBytes = limits.maxEntryBytes ?? 10 * 1024 * 1024;
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
    });
    result.imported.push({ ...imported, entry: path.basename(resolved) });
  }
  if (documents.length === 0) result.skipped.push({ entry: path.basename(resolved), code: "EMPTY_CONTENT", message: "文件没有可导入的正文。" });
  return result;
}
