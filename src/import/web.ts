import { load } from "cheerio";
import { MemoryError } from "../errors.js";
import type { MemoryStore } from "../store.js";
import type { Authorship, ContentScope, ImportDocumentResult, SourcePurpose, SyncProgress } from "../types.js";
import { normalizeFileContent } from "./file-content.js";
import { canonicalizeUrl, defaultDnsResolver, type DnsResolver, validatePublicUrl } from "./network-policy.js";
import type { SkippedEntry } from "./zip.js";
import { VERSION } from "../version.js";

export type WebFetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface WebImportOptions {
  scope: "page" | "site";
  purpose?: SourcePurpose;
  authorship?: Authorship;
  contentScope?: ContentScope;
  connectionId?: string;
  fetcher?: WebFetcher;
  resolver?: DnsResolver;
  maxPages?: number;
  maxDepth?: number;
  maxRedirects?: number;
  maxResponseBytes?: number;
  maxTotalBytes?: number;
  delayMs?: number;
  onProgress?: (progress: SyncProgress) => void;
}

export interface WebImportedEntry extends ImportDocumentResult {
  entry: string;
}

export interface WebImportSummary {
  imported: WebImportedEntry[];
  skipped: SkippedEntry[];
  unchanged: number;
}

interface PageResult {
  response: Response;
  finalUrl: URL;
}

interface RobotsRules {
  disallow: string[];
  sitemaps: string[];
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
  const result: WebImportSummary = { imported: [], skipped: [], unchanged: 0 };
  let totalBytes = 0;
  const allowedPath = directoryScope(entry.pathname);
  const discoveredModifiedAt = new Map<string, string>();
  const discoveredPublishedAt = new Map<string, string>();
  const robots = options.scope === "site"
    ? await readRobots(entry, fetcher, resolver, settings.maxRedirects)
    : { disallow: [] as string[], sitemaps: [] as string[] };

  if (options.scope === "site") {
    const sitemapEntries = await discoverSitemapEntries(entry, robots.sitemaps, fetcher, resolver, settings.maxRedirects, settings.maxPages);
    for (const item of sitemapEntries) {
      if (queued.size >= settings.maxPages) break;
      if (item.url.origin !== entry.origin || !item.url.pathname.startsWith(allowedPath)) continue;
      const canonical = canonicalizeUrl(item.url);
      if (queued.has(canonical)) continue;
      if (item.modifiedAt) discoveredModifiedAt.set(canonical, item.modifiedAt);
      queued.add(canonical);
      queue.push({ url: canonical, depth: 0 });
    }
  }

  while (queue.length > 0 && visited.size < settings.maxPages) {
    const next = queue.shift();
    if (!next || visited.has(next.url)) continue;
    visited.add(next.url);
    reportProgress(options, result, visited.size - 1, queue.length + visited.size);
    if (visited.size > 1 && settings.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, settings.delayMs));

    const page = await fetchWithRedirects(next.url, fetcher, resolver, settings.maxRedirects);
    const finalCanonical = canonicalizeUrl(page.finalUrl);
    if (options.scope === "site" && page.finalUrl.origin !== entry.origin) {
      result.skipped.push(skip(finalCanonical, "CROSS_ORIGIN_REDIRECT", "网页跳转到站外，已跳过。"));
      continue;
    }
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
      const metadata = extractPageMetadata(html);
      const imported = store.importDocument({
        kind: "web",
        origin: finalCanonical,
        title: documents[0].title,
        content: documents[0].content,
        purpose: options.purpose ?? "reference",
        authorship: options.authorship ?? (options.purpose === "memory" ? "unknown" : "other"),
        contentScope: options.contentScope,
        occurredAt: documents[0].occurredAt,
        eventTimeProvenance: documents[0].occurredAt ? "inferred" : "unknown",
        publishedAt: metadata.publishedAt ?? discoveredPublishedAt.get(finalCanonical),
        modifiedAt: metadata.modifiedAt ?? discoveredModifiedAt.get(finalCanonical),
        author: metadata.author,
        connectionId: options.connectionId,
        externalId: finalCanonical,
      });
      result.imported.push({ ...imported, entry: finalCanonical });
      if (!imported.sourceCreated && !imported.objectCreated) result.unchanged += 1;
    } else {
      result.skipped.push(skip(finalCanonical, "EMPTY_CONTENT", "网页没有可导入的正文。"));
    }

    if (options.scope !== "site" || next.depth >= settings.maxDepth) continue;
    if (next.depth === 0) {
      for (const feedUrl of extractFeedLinks(html, page.finalUrl)) {
        const feedEntries = await readFeedEntries(feedUrl, fetcher, resolver, settings.maxRedirects, settings.maxPages - queued.size);
        for (const item of feedEntries) {
          if (item.url.origin !== entry.origin || !item.url.pathname.startsWith(allowedPath)) continue;
          const canonical = canonicalizeUrl(item.url);
          if (queued.has(canonical) || visited.has(canonical)) continue;
          if (item.publishedAt) discoveredPublishedAt.set(canonical, item.publishedAt);
          queued.add(canonical);
          queue.push({ url: canonical, depth: 1 });
        }
      }
    }
    for (const link of extractLinks(html, page.finalUrl)) {
      const canonical = canonicalizeUrl(link);
      if (queued.has(canonical) || visited.has(canonical)) continue;
      if (link.origin !== entry.origin || !link.pathname.startsWith(allowedPath) || disallowedByRobots(link.pathname, robots.disallow)) continue;
      queued.add(canonical);
      queue.push({ url: canonical, depth: next.depth + 1 });
    }
  }
  reportProgress(options, result, result.imported.length + result.skipped.length, visited.size);
  return result;
}

function reportProgress(options: WebImportOptions, result: WebImportSummary, completed: number, total: number): void {
  const imported = result.imported.filter((item) => item.sourceCreated || item.objectCreated).length;
  options.onProgress?.({ completed, total, imported, unchanged: result.unchanged, skipped: result.skipped.length });
}

function extractFeedLinks(html: string, base: URL): URL[] {
  const $ = load(html);
  const feeds: URL[] = [];
  $("link[rel='alternate'][href]").each((_index, element) => {
    const type = $(element).attr("type")?.toLocaleLowerCase() ?? "";
    if (!type.includes("rss") && !type.includes("atom") && !type.includes("xml")) return;
    try {
      feeds.push(new URL($(element).attr("href")!, base));
    } catch {
      // Ignore malformed feed links.
    }
  });
  return feeds.slice(0, 4);
}

async function readFeedEntries(
  feedUrl: URL,
  fetcher: WebFetcher,
  resolver: DnsResolver,
  maxRedirects: number,
  limit: number,
): Promise<Array<{ url: URL; publishedAt: string | null }>> {
  if (limit <= 0) return [];
  try {
    const page = await fetchWithRedirects(feedUrl.href, fetcher, resolver, maxRedirects);
    if (!page.response.ok) return [];
    const body = (await readBounded(page.response, 5 * 1024 * 1024)).buffer.toString("utf8");
    const $ = load(body, { xmlMode: true });
    const found: Array<{ url: URL; publishedAt: string | null }> = [];
    $("item, entry").each((_index, element) => {
      if (found.length >= limit) return;
      const link = $(element).find("link").first().attr("href")?.trim() || $(element).find("link").first().text().trim();
      if (!link) return;
      try {
        found.push({
          url: new URL(link, page.finalUrl),
          publishedAt: $(element).find("pubDate, published, updated").first().text().trim() || null,
        });
      } catch {
        // Ignore malformed feed entries.
      }
    });
    return found;
  } catch {
    return [];
  }
}

async function fetchWithRedirects(urlValue: string, fetcher: WebFetcher, resolver: DnsResolver, maxRedirects: number): Promise<PageResult> {
  let current = await validatePublicUrl(urlValue, resolver);
  for (let redirects = 0; ; redirects += 1) {
    const response = await fetcher(canonicalizeUrl(current), {
      redirect: "manual",
      headers: { "user-agent": `the-way-here-codex/${VERSION}`, accept: "text/html,application/xhtml+xml" },
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

async function readRobots(entry: URL, fetcher: WebFetcher, resolver: DnsResolver, maxRedirects: number): Promise<RobotsRules> {
  try {
    const page = await fetchWithRedirects(new URL("/robots.txt", entry).href, fetcher, resolver, maxRedirects);
    if (!page.response.ok) return { disallow: [], sitemaps: [] };
    const body = await readBounded(page.response, 512 * 1024);
    return parseRobots(body.buffer.toString("utf8"));
  } catch {
    return { disallow: [], sitemaps: [] };
  }
}

function parseRobots(value: string): RobotsRules {
  const result: RobotsRules = { disallow: [], sitemaps: [] };
  let applies = false;
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLocaleLowerCase();
    const content = line.slice(separator + 1).trim();
    if (key === "user-agent") applies = content === "*";
    else if (key === "disallow" && applies && content) result.disallow.push(content);
    else if (key === "sitemap" && content) result.sitemaps.push(content);
  }
  return result;
}

async function discoverSitemapEntries(
  entry: URL,
  declared: string[],
  fetcher: WebFetcher,
  resolver: DnsResolver,
  maxRedirects: number,
  limit: number,
): Promise<Array<{ url: URL; modifiedAt: string | null }>> {
  const seeds = declared.length > 0 ? declared : [new URL("/sitemap.xml", entry).href];
  const queue = seeds.slice(0, 8);
  const visited = new Set<string>();
  const found: Array<{ url: URL; modifiedAt: string | null }> = [];
  while (queue.length > 0 && found.length < limit && visited.size < 16) {
    const candidate = queue.shift()!;
    let candidateUrl: URL;
    try {
      candidateUrl = new URL(candidate, entry);
    } catch {
      continue;
    }
    if (candidateUrl.origin !== entry.origin) continue;
    let page: PageResult;
    try {
      page = await fetchWithRedirects(candidateUrl.href, fetcher, resolver, maxRedirects);
    } catch {
      continue;
    }
    const canonical = canonicalizeUrl(page.finalUrl);
    if (page.finalUrl.origin !== entry.origin || visited.has(canonical) || !page.response.ok) continue;
    visited.add(canonical);
    const type = page.response.headers.get("content-type")?.toLocaleLowerCase() ?? "";
    if (!type.includes("xml") && !type.includes("text/plain") && !candidateUrl.pathname.endsWith(".xml")) continue;
    let body: string;
    try {
      body = (await readBounded(page.response, 5 * 1024 * 1024)).buffer.toString("utf8");
    } catch {
      continue;
    }
    const $ = load(body, { xmlMode: true });
    $("sitemap > loc").each((_index, element) => {
      const value = $(element).text().trim();
      if (value && queue.length < 16) queue.push(new URL(value, page.finalUrl).href);
    });
    $("url").each((_index, element) => {
      if (found.length >= limit) return;
      const value = $(element).find("loc").first().text().trim();
      if (!value) return;
      try {
        found.push({
          url: new URL(value, page.finalUrl),
          modifiedAt: $(element).find("lastmod").first().text().trim() || null,
        });
      } catch {
        // Ignore malformed sitemap entries.
      }
    });
  }
  return found;
}

function extractPageMetadata(html: string): { publishedAt: string | null; modifiedAt: string | null; author: string | null } {
  const $ = load(html);
  const meta = (selectors: string[]): string | null => {
    for (const selector of selectors) {
      const value = $(selector).first().attr("content")?.trim() || $(selector).first().attr("datetime")?.trim();
      if (value) return value;
    }
    return null;
  };
  return {
    publishedAt: meta(["meta[property='article:published_time']", "meta[name='date']", "time[datetime]"]),
    modifiedAt: meta(["meta[property='article:modified_time']", "meta[name='last-modified']"]),
    author: meta(["meta[name='author']", "meta[property='article:author']"]),
  };
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
