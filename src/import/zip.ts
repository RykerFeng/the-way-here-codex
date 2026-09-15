import path from "node:path";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import { MemoryError } from "../errors.js";
import type { MemoryStore } from "../store.js";
import type { Authorship, ImportDocumentResult, SourcePurpose } from "../types.js";
import { isSupportedFileName, normalizeFileContent } from "./file-content.js";

export interface ImportLimits {
  maxEntries?: number;
  maxEntryBytes?: number;
  maxTotalBytes?: number;
}

export interface ZipImportOptions extends ImportLimits {
  purpose?: SourcePurpose;
  authorship?: Authorship;
}

export interface ImportedEntry extends ImportDocumentResult {
  entry: string;
}

export interface SkippedEntry {
  entry: string;
  code: string;
  message: string;
}

export interface ImportSummary {
  imported: ImportedEntry[];
  skipped: SkippedEntry[];
}

export interface ZipEntryMetadata {
  fileName: string;
  generalPurposeBitFlag: number;
  externalFileAttributes: number;
}

const DEFAULT_LIMITS = {
  maxEntries: 20_000,
  maxEntryBytes: 10 * 1024 * 1024,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
};

export function validateZipEntry(entry: ZipEntryMetadata): string | null {
  const name = entry.fileName.replaceAll("\\", "/");
  const segments = name.split("/");
  if (name.startsWith("/") || /^[a-zA-Z]:\//.test(name) || segments.includes("..")) return "UNSAFE_PATH";
  if ((entry.generalPurposeBitFlag & 0x1) !== 0) return "ENCRYPTED_ENTRY";
  const unixMode = entry.externalFileAttributes >>> 16;
  if ((unixMode & 0o170000) === 0o120000) return "SYMLINK_ENTRY";
  return null;
}

export async function importZip(store: MemoryStore, zipPath: string, options: ZipImportOptions = {}): Promise<ImportSummary> {
  const actual = { ...DEFAULT_LIMITS, ...options };
  const resolvedZipPath = path.resolve(zipPath);
  const zip = await openZip(resolvedZipPath);
  return await new Promise<ImportSummary>((resolve, reject) => {
    const result: ImportSummary = { imported: [], skipped: [] };
    let entryCount = 0;
    let totalBytes = 0;
    let settled = false;

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(result);
    };

    zip.on("error", (error) => finish(error));
    zip.on("end", () => finish());
    zip.on("entry", (entry: Entry) => {
      void processEntry(entry).then(() => zip.readEntry()).catch((error: unknown) => {
        finish(error instanceof Error ? error : new Error(String(error)));
      });
    });

    const processEntry = async (entry: Entry): Promise<void> => {
      entryCount += 1;
      if (entryCount > actual.maxEntries) {
        result.skipped.push(skip(entry.fileName, "TOO_MANY_ENTRIES", `超过 ZIP 条目上限 ${actual.maxEntries}。`));
        return;
      }
      if (entry.fileName.endsWith("/")) return;
      const invalid = validateZipEntry(entry);
      if (invalid) {
        result.skipped.push(skip(entry.fileName, invalid, "ZIP 条目不安全，已跳过。"));
        return;
      }
      if (!isSupportedFileName(entry.fileName)) {
        result.skipped.push(skip(entry.fileName, "UNSUPPORTED_TYPE", "只接收 Markdown、TXT、HTML 和 JSON。"));
        return;
      }
      if (entry.uncompressedSize > actual.maxEntryBytes) {
        result.skipped.push(skip(entry.fileName, "ENTRY_TOO_LARGE", `单个文件超过 ${actual.maxEntryBytes} 字节。`));
        return;
      }

      const bytes = await readEntry(zip, entry, actual.maxEntryBytes);
      if (totalBytes + bytes.length > actual.maxTotalBytes) {
        result.skipped.push(skip(entry.fileName, "TOTAL_TOO_LARGE", `解压总量超过 ${actual.maxTotalBytes} 字节。`));
        return;
      }
      totalBytes += bytes.length;
      const documents = normalizeFileContent(entry.fileName, bytes);
      if (documents.length === 0) {
        result.skipped.push(skip(entry.fileName, "EMPTY_CONTENT", "文件没有可导入的正文。"));
        return;
      }
      for (const document of documents) {
        const origin = `${resolvedZipPath}#${entry.fileName}${document.originSuffix ? `#${document.originSuffix}` : ""}`;
        const imported = store.importDocument({
          kind: document.kind,
          origin,
          title: document.title,
          content: document.content,
          originalPath: resolvedZipPath,
          purpose: options.purpose ?? document.purpose,
          authorship: options.authorship ?? document.authorship,
          occurredAt: document.occurredAt,
          occurredEnd: document.occurredEnd,
        });
        result.imported.push({ ...imported, entry: entry.fileName });
      }
    };

    zip.readEntry();
  });
}

function openZip(zipPath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error || !zip) reject(error ?? new MemoryError("INVALID_ZIP", "无法打开 ZIP。", false, "确认资料包没有损坏。"));
      else resolve(zip);
    });
  });
}

function readEntry(zip: ZipFile, entry: Entry, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new MemoryError("ZIP_READ_FAILED", "无法读取 ZIP 条目。", false, "检查资料包是否损坏。"));
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      stream.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          stream.destroy(new MemoryError("ENTRY_TOO_LARGE", "ZIP 条目解压后过大。", false, "拆分资料包后重试。"));
          return;
        }
        chunks.push(chunk);
      });
      stream.on("error", reject);
      stream.on("end", () => resolve(Buffer.concat(chunks)));
    });
  });
}

function skip(entry: string, code: string, message: string): SkippedEntry {
  return { entry, code, message };
}
