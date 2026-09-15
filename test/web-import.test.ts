import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importWeb, type WebFetcher } from "../src/import/web.js";
import type { DnsResolver } from "../src/import/network-policy.js";
import { MemoryStore } from "../src/store.js";

const resolver: DnsResolver = async () => [{ address: "93.184.216.34", family: 4 }];

function mockFetcher(pages: Record<string, { body?: string; status?: number; type?: string; location?: string }>): WebFetcher {
  return async (url) => {
    const page = pages[url];
    if (!page) return new Response("missing", { status: 404, headers: { "content-type": "text/plain" } });
    const headers = new Headers({ "content-type": page.type ?? "text/html; charset=utf-8" });
    if (page.location) headers.set("location", page.location);
    return new Response(page.body ?? "", { status: page.status ?? 200, headers });
  };
}

test("imports one public page as searchable evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "way-here-web-page-"));
  const store = await MemoryStore.open(path.join(root, "space"));
  try {
    const result = await importWeb(store, "https://example.com/article", {
      scope: "page",
      resolver,
      fetcher: mockFetcher({
        "https://example.com/article": { body: "<title>文章</title><main><h1>项目思考</h1><p>我们需要保留证据。</p></main>" },
      }),
    });
    assert.equal(result.imported.length, 1);
    assert.equal(result.imported[0]?.source.title, "文章");
    assert.equal(result.imported[0]?.source.purpose, "reference");
    assert.equal(result.imported[0]?.source.authorship, "other");
    assert.equal(store.search("证据")[0]?.origin, "https://example.com/article");
  } finally {
    store.close();
  }
});

test("a user-owned journal site can be explicitly brought in as personal history", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "way-here-web-memory-"));
  const store = await MemoryStore.open(path.join(root, "space"));
  try {
    const result = await importWeb(store, "https://example.com/diary/2023-08-04", {
      scope: "page",
      purpose: "memory",
      authorship: "user",
      resolver,
      fetcher: mockFetcher({
        "https://example.com/diary/2023-08-04": { body: "<title>2023-08-04 日记</title><main><p>今天我第一次独自出发。</p></main>" },
      }),
    });
    assert.equal(result.imported[0]?.source.purpose, "memory");
    assert.equal(result.imported[0]?.source.authorship, "user");
    assert.equal(result.imported[0]?.source.occurredAt, "2023-08-04");
    assert.equal(store.recall(["第一次独自出发"], { mode: "moment" }).hits.length, 1);
  } finally {
    store.close();
  }
});

test("site crawl stays on origin and entry directory, obeys robots, and reports partial failures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "way-here-web-site-"));
  const store = await MemoryStore.open(path.join(root, "space"));
  const calls: string[] = [];
  const base = mockFetcher({
    "https://example.com/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /docs/private" },
    "https://example.com/docs/": { body: '<main>目录 <a href="a">A</a> <a href="/docs/missing">坏链</a> <a href="/docs/private">私密</a> <a href="/outside">外面</a> <a href="https://other.example/docs/x">站外</a></main>' },
    "https://example.com/docs/a": { body: '<title>A</title><main>工作进展 <a href="/docs/#fragment">返回</a></main>' },
    "https://example.com/docs/missing": { status: 429, body: "slow down" },
  });
  const fetcher: WebFetcher = async (url, init) => {
    calls.push(url);
    return base(url, init);
  };
  try {
    const result = await importWeb(store, "https://example.com/docs/", {
      scope: "site", resolver, fetcher, delayMs: 0, maxPages: 10, maxDepth: 2,
    });
    assert.equal(result.imported.length, 2, JSON.stringify({ calls, result }, null, 2));
    assert.equal(result.skipped.some((item) => item.code === "HTTP_429"), true);
    assert.equal(calls.includes("https://example.com/docs/private"), false);
    assert.equal(calls.includes("https://example.com/outside"), false);
    assert.equal(calls.some((url) => url.includes("other.example")), false);
  } finally {
    store.close();
  }
});

test("site discovery uses sitemap and RSS dates beyond visible navigation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "way-here-web-discovery-"));
  const store = await MemoryStore.open(path.join(root, "space"));
  try {
    const result = await importWeb(store, "https://example.com/journal/", {
      scope: "site", resolver, delayMs: 0, maxPages: 10,
      fetcher: mockFetcher({
        "https://example.com/robots.txt": { type: "text/plain", body: "User-agent: *\nSitemap: https://example.com/sitemap.xml" },
        "https://example.com/sitemap.xml": { type: "application/xml", body: "<urlset><url><loc>https://example.com/journal/from-map</loc><lastmod>2024-05-02</lastmod></url></urlset>" },
        "https://example.com/journal/": { body: '<title>日记</title><link rel="alternate" type="application/rss+xml" href="/feed.xml"><main>入口没有文章链接</main>' },
        "https://example.com/feed.xml": { type: "application/rss+xml", body: "<rss><channel><item><link>https://example.com/journal/from-feed</link><pubDate>2024-06-03T00:00:00Z</pubDate></item></channel></rss>" },
        "https://example.com/journal/from-map": { body: "<title>地图发现</title><main>从站点地图发现的过去。</main>" },
        "https://example.com/journal/from-feed": { body: "<title>订阅发现</title><main>从订阅发现的过去。</main>" },
      }),
    });
    assert.equal(result.imported.length, 3);
    const mapSource = result.imported.find((item) => item.source.title === "地图发现")?.source;
    const feedSource = result.imported.find((item) => item.source.title === "订阅发现")?.source;
    assert.equal(mapSource?.modifiedAt, "2024-05-02");
    assert.equal(feedSource?.publishedAt, "2024-06-03T00:00:00.000Z");
  } finally {
    store.close();
  }
});

test("validates redirects and response limits", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "way-here-web-limits-"));
  const store = await MemoryStore.open(path.join(root, "space"));
  try {
    await assert.rejects(importWeb(store, "https://example.com/start", {
      scope: "page", resolver, maxRedirects: 1,
      fetcher: mockFetcher({
        "https://example.com/start": { status: 302, location: "/middle" },
        "https://example.com/middle": { status: 302, location: "/end" },
        "https://example.com/end": { body: "<main>end</main>" },
      }),
    }), (error: { code?: string }) => error.code === "TOO_MANY_REDIRECTS");

    const limited = await importWeb(store, "https://example.com/large", {
      scope: "page", resolver, maxResponseBytes: 5,
      fetcher: mockFetcher({ "https://example.com/large": { body: "<main>too large</main>" } }),
    });
    assert.equal(limited.imported.length, 0);
    assert.equal(limited.skipped[0]?.code, "RESPONSE_TOO_LARGE");

    const binary = await importWeb(store, "https://example.com/file.pdf", {
      scope: "page", resolver,
      fetcher: mockFetcher({ "https://example.com/file.pdf": { type: "application/pdf", body: "%PDF" } }),
    });
    assert.equal(binary.skipped[0]?.code, "NON_HTML");

    const outside = await importWeb(store, "https://example.com/docs/", {
      scope: "site", resolver, delayMs: 0,
      fetcher: mockFetcher({
        "https://example.com/robots.txt": { type: "text/plain", body: "User-agent: *" },
        "https://example.com/sitemap.xml": { status: 404, type: "text/plain" },
        "https://example.com/docs/": { status: 302, location: "https://other.example/docs/" },
        "https://other.example/docs/": { body: "<main>站外正文</main>" },
      }),
    });
    assert.equal(outside.imported.length, 0);
    assert.equal(outside.skipped[0]?.code, "CROSS_ORIGIN_REDIRECT");
  } finally {
    store.close();
  }
});
