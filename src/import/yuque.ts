import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { MemoryStore } from "../store.js";
import type { Authorship, ContentScope, ImportDocumentResult, SourcePurpose, SyncProgress } from "../types.js";
import { importWeb, type WebImportSummary } from "./web.js";
import type { SkippedEntry } from "./zip.js";

const execFileAsync = promisify(execFile);

export type YuqueRunner = (args: string[], environment: NodeJS.ProcessEnv) => Promise<string>;

export interface YuqueImportOptions {
  purpose?: SourcePurpose;
  authorship?: Authorship;
  contentScope?: ContentScope;
  connectionId?: string;
  runner?: YuqueRunner;
  environment?: NodeJS.ProcessEnv;
  webFallback?: typeof importWeb;
  onProgress?: (progress: SyncProgress) => void;
}

export interface YuqueImportSummary {
  imported: Array<ImportDocumentResult & { entry: string }>;
  skipped: SkippedEntry[];
  unchanged: number;
  adapter: "yuque-api" | "public-web";
}

interface YuqueLocation {
  book: string;
  slug: string | null;
  host: string;
}

interface YuqueDoc {
  id?: number | string;
  slug?: string;
  title?: string;
  body?: string;
  body_markdown?: string;
  body_html?: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
  content_updated_at?: string;
  user?: { name?: string; login?: string };
  creator?: { name?: string; login?: string };
}

export function parseYuqueUrl(value: string): YuqueLocation | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.toLocaleLowerCase();
  if (host !== "yuque.com" && host !== "www.yuque.com" && !host.endsWith(".yuque.com")) return null;
  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (host === "yuque.com" || host === "www.yuque.com") {
    if (segments.length < 2) return null;
    return { book: `${segments[0]}/${segments[1]}`, slug: segments[2] ?? null, host: url.origin };
  }
  if (segments.length < 1) return null;
  return { book: segments[0]!, slug: segments[1] ?? null, host: url.origin };
}

export async function importYuque(store: MemoryStore, url: string, options: YuqueImportOptions = {}): Promise<YuqueImportSummary> {
  const location = parseYuqueUrl(url);
  const environment = options.environment ?? process.env;
  const token = environment.YUQUE_TOKEN?.trim() || environment.YUQUE_PERSONAL_TOKEN?.trim();
  if (!location || !token) {
    const fallback = options.webFallback ?? importWeb;
    const result: WebImportSummary = await fallback(store, url, {
      scope: location?.slug ? "page" : "site",
      purpose: options.purpose,
      authorship: options.authorship,
      contentScope: options.contentScope,
      connectionId: options.connectionId,
      onProgress: options.onProgress,
    });
    return { ...result, adapter: "public-web" };
  }

  const runner = options.runner ?? runYuqueCli;
  const cliEnvironment = { ...environment, YUQUE_TOKEN: token, YUQUE_HOST: location.host, NO_COLOR: "1" };
  const summaries = location.slug
    ? [{ slug: location.slug } satisfies YuqueDoc]
    : asDocumentArray(await runner(["doc", "list", location.book, "--all", "--json"], cliEnvironment));
  const result: YuqueImportSummary = { imported: [], skipped: [], unchanged: 0, adapter: "yuque-api" };
  for (const summary of summaries) {
    const identity = String(summary.slug ?? summary.id ?? "").trim();
    if (!identity) {
      result.skipped.push({ entry: summary.title ?? location.book, code: "YUQUE_DOC_ID_MISSING", message: "语雀文档没有可读取的 ID 或 slug。" });
      continue;
    }
    try {
      const doc = unwrapDocument(await runner(["doc", "get", location.book, identity, "--json"], cliEnvironment));
      const content = doc.body_markdown || doc.body || doc.body_html || doc.description || "";
      if (!content.trim()) {
        result.skipped.push({ entry: identity, code: "EMPTY_CONTENT", message: "语雀文档没有可导入的正文。" });
        continue;
      }
      const docUrl = buildYuqueDocUrl(url, location, String(doc.slug ?? identity));
      const imported = store.importDocument({
        kind: "web",
        origin: docUrl,
        title: doc.title || summary.title || identity,
        content,
        purpose: options.purpose ?? "memory",
        authorship: options.authorship ?? "user",
        contentScope: options.contentScope ?? "unknown",
        author: doc.user?.name || doc.user?.login || doc.creator?.name || doc.creator?.login,
        publishedAt: doc.created_at,
        modifiedAt: doc.content_updated_at || doc.updated_at,
        externalId: String(doc.id ?? doc.slug ?? identity),
        connectionId: options.connectionId,
      });
      result.imported.push({ ...imported, entry: docUrl });
      if (!imported.sourceCreated && !imported.objectCreated) result.unchanged += 1;
    } catch (error) {
      result.skipped.push({ entry: identity, code: "YUQUE_DOC_READ_FAILED", message: error instanceof Error ? error.message : String(error) });
    }
    const imported = result.imported.filter((item) => item.sourceCreated || item.objectCreated).length;
    options.onProgress?.({ completed: result.imported.length + result.skipped.length, total: summaries.length, imported, unchanged: result.unchanged, skipped: result.skipped.length });
  }
  return result;
}

async function runYuqueCli(args: string[], environment: NodeJS.ProcessEnv): Promise<string> {
  try {
    const { stdout } = await execFileAsync("yuque", args, { env: environment, maxBuffer: 20 * 1024 * 1024 });
    return stdout;
  } catch (firstError) {
    try {
      const { stdout } = await execFileAsync("npx", ["--yes", "yuque-open-cli@1.2.0", ...args], { env: environment, maxBuffer: 20 * 1024 * 1024 });
      return stdout;
    } catch {
      throw firstError;
    }
  }
}

function asDocumentArray(raw: string): YuqueDoc[] {
  const value = parseJson(raw);
  if (Array.isArray(value)) return value as YuqueDoc[];
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.data)) return record.data as YuqueDoc[];
    if (Array.isArray(record.docs)) return record.docs as YuqueDoc[];
  }
  return [];
}

function unwrapDocument(raw: string): YuqueDoc {
  const value = parseJson(raw);
  if (value && typeof value === "object" && "data" in value && (value as { data?: unknown }).data) {
    return (value as { data: YuqueDoc }).data;
  }
  return value as YuqueDoc;
}

function parseJson(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = Math.min(...[trimmed.indexOf("{"), trimmed.indexOf("[")].filter((item) => item >= 0));
    if (Number.isFinite(start)) return JSON.parse(trimmed.slice(start));
    throw new Error("语雀 CLI 没有返回有效 JSON。");
  }
}

function buildYuqueDocUrl(input: string, location: YuqueLocation, slug: string): string {
  const original = new URL(input);
  if (location.slug) return original.href;
  original.pathname = `${original.pathname.replace(/\/$/, "")}/${encodeURIComponent(slug)}`;
  return original.href;
}
