import { load } from "cheerio";
import { MemoryError } from "../errors.js";
import type { MemoryStore } from "../store.js";
import type { ImportDocumentResult } from "../types.js";
import { normalizeFileContent } from "./file-content.js";
import { canonicalizeUrl, defaultDnsResolver, type DnsResolver, validatePublicUrl } from "./network-policy.js";
import type { SkippedEntry } from "./zip.js";

export type WebFetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface WebImportOptions {
  scope: "page" | "site";
  fetcher?: WebFetcher;
  resolver?: DnsResolver;
  maxPages?: number;
  maxDepth?: number;
  maxRedirects?: number;
  maxResponseBytes?: number;
  maxTotalBytes?: number;
  delayMs?: number;
}

export interface WebImportedEntry extends ImportDocumentResult {
  entry: string;
}

export interface WebImportSummary {
  imported: WebImportedEntry[];
  skipped: SkippedEntry[];
}

interface PageResult {
  response: Response;
  finalUrl: URL;
}

const defaults = {
  maxPages: 50,
  maxDepth: 2,
  maxRedirects: 5,
  maxResponseBytes: 5 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
  delayMs: 150,
};

export async function importWeb(store: MemoryStore, entryUrl: string, options: WebImportOptions): Promise<WebImportSummary> {
  const settings = { ...defaults, ...options };
  const fetcher = options.fetcher ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const resolver = options.resolver ?? defaultDnsResolver;
  const entry = await validatePublicUrl(entryUrl, resolver);
  const canonicalEntry = canonicalizeUrl(entry);
  const queue: Array<{ url: string; depth: number }> = [{ url: canonicalEntry, depth: 0 }];
  const queued = new Set([canonicalEntry]);
  const visited = new Set<string>();
  const result: WebImportSummary = { imported: [], skipped: [] };
  let totalBytes = 0;
  const allowedPath = directoryScope(entry.pathname);
  const robots = options.scope === "site" ? await readRobots(entry, fetcher, resolver, settings.maxRedirects) : [];

  while (queue.length > 0 && visited.size < settings.maxPages) {
    const next = queue.shift();
    if (!next || visited.has(next.url)) continue;
    visited.add(next.url);
    if (visited.size > 1 && settings.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, settings.delayMs));

    const page = await fetchWithRedirects(next.url, fetcher, resolver, settings.maxRedirects);
    const finalCanonical = canonicalizeUrl(page.finalUrl);
    if (!page.response.ok) {
      result.skipped.push(skip(finalCanonical, `HTTP_${page.response.status}`, `网页返回 ${page.response.status}。`));
      continue;
    }
    const contentType = page.response.headers.get("content-type")?.toLocaleLowerCase() ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      result.skipped.push(skip(finalCanonical, "NON_HTML", "不是 HTML 网页，已跳过。"));
      continue;
    }
    let body: { buffer: Buffer; bytes: number };
    try {
      body = await readBounded(page.response, settings.maxResponseBytes);
    } catch (error) {
      if (error instanceof MemoryError && error.code === "RESPONSE_TOO_LARGE") {
        result.skipped.push(skip(finalCanonical, error.code, error.message));
        continue;
      }
      throw error;
    }
    if (totalBytes + body.bytes > settings.maxTotalBytes) {
      result.skipped.push(skip(finalCanonical, "TOTAL_TOO_LARGE", "网站导入总量已达到上限。"));
      break;
    }
    totalBytes += body.bytes;
    const html = body.buffer.toString("utf8");
    const pageName = page.finalUrl.pathname.endsWith("/") ? `${page.finalUrl.pathname}index.html` : `${page.finalUrl.pathname}.html`;
    const documents = normalizeFileContent(pageName, body.buffer, finalCanonical);
    if (documents[0]) {
      const imported = store.importDocument({
        kind: "web",
        origin: finalCanonical,
        title: documents[0].title,
        content: documents[0].content,
      });
      result.imported.push({ ...imported, entry: finalCanonical });
    } else {
      result.skipped.push(skip(finalCanonical, "EMPTY_CONTENT", "网页没有可导入的正文。"));
    }

    if (options.scope !== "site" || next.depth >= settings.maxDepth) continue;
    for (const link of extractLinks(html, page.finalUrl)) {
      const canonical = canonicalizeUrl(link);
      if (queued.has(canonical) || visited.has(canonical)) continue;
      if (link.origin !== entry.origin || !link.pathname.startsWith(allowedPath) || disallowedByRobots(link.pathname, robots)) continue;
      queued.add(canonical);
      queue.push({ url: canonical, depth: next.depth + 1 });
    }
  }
  return result;
}

async function fetchWithRedirects(urlValue: string, fetcher: WebFetcher, resolver: DnsResolver, maxRedirects: number): Promise<PageResult> {
  let current = await validatePublicUrl(urlValue, resolver);
  for (let redirects = 0; ; redirects += 1) {
    const response = await fetcher(canonicalizeUrl(current), {
      redirect: "manual",
      headers: { "user-agent": "the-way-here-codex/0.1", accept: "text/html,application/xhtml+xml" },
    });
    if (response.status < 300 || response.status >= 400) return { response, finalUrl: current };
    const location = response.headers.get("location");
    if (!location) return { response, finalUrl: current };
    if (redirects >= maxRedirects) throw new MemoryError("TOO_MANY_REDIRECTS", "网页重定向次数过多。", true, "换成最终网页地址后重试。 ");
    current = await validatePublicUrl(new URL(location, current), resolver);
  }
}

async function readBounded(response: Response, limit: number): Promise<{ buffer: Buffer; bytes: number }> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw responseTooLarge();
  if (!response.body) return { buffer: Buffer.alloc(0), bytes: 0 };
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw responseTooLarge();
      }
      chunks.push(Buffer.from(item.value));
    }
  } finally {
    reader.releaseLock();
  }
  return { buffer: Buffer.concat(chunks), bytes };
}

async function readRobots(entry: URL, fetcher: WebFetcher, resolver: DnsResolver, maxRedirects: number): Promise<string[]> {
  try {
    const page = await fetchWithRedirects(new URL("/robots.txt", entry).href, fetcher, resolver, maxRedirects);
    if (!page.response.ok) return [];
    const body = await readBounded(page.response, 512 * 1024);
    return parseRobots(body.buffer.toString("utf8"));
  } catch {
    return [];
  }
}

function parseRobots(value: string): string[] {
  const rules: string[] = [];
  let applies = false;
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLocaleLowerCase();
    const content = line.slice(separator + 1).trim();
    if (key === "user-agent") applies = content === "*";
    else if (key === "disallow" && applies && content) rules.push(content);
  }
  return rules;
}

function disallowedByRobots(pathname: string, rules: string[]): boolean {
  return rules.some((rule) => pathname.startsWith(rule));
}

function extractLinks(html: string, base: URL): URL[] {
  const $ = load(html);
  const links: URL[] = [];
  $("a[href]").each((_index, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    try {
      const link = new URL(href, base);
      if (link.protocol === "http:" || link.protocol === "https:") links.push(link);
    } catch {
      // Invalid links are evidence noise, not a failed crawl.
    }
  });
  return links;
}

function directoryScope(pathname: string): string {
  if (pathname.endsWith("/")) return pathname;
  return pathname.slice(0, pathname.lastIndexOf("/") + 1) || "/";
}

function responseTooLarge(): MemoryError {
  return new MemoryError("RESPONSE_TOO_LARGE", "网页正文超过单页大小上限。", false, "改用单页模式或缩小网站范围。 ");
}

function skip(entry: string, code: string, message: string): SkippedEntry {
  return { entry, code, message };
}
