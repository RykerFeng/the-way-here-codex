import assert from "node:assert/strict";
import test from "node:test";
import { extractHtmlContent } from "../src/import/html.js";

test("prefers a GitHub README over repository navigation", () => {
  const html = `<!doctype html>
    <html>
      <head><title>acme/useful: Useful Project · GitHub</title></head>
      <body>
        <header><a>Navigation Menu</a><a>Sign in</a></header>
        <main>
          <nav>Code Issues Pull requests Actions</nav>
          <article class="markdown-body entry-content">
            <h1>Useful Project</h1>
            <p>这是实际正文，说明怎样只在当前会话启用资料库。</p>
            <h2>使用</h2>
            <p>把 LOAD.md 的绝对路径粘贴给 Codex。</p>
          </article>
          <aside>About Stars Forks</aside>
        </main>
        <footer>GitHub, Inc.</footer>
      </body>
    </html>`;

  const parsed = extractHtmlContent(html, "https://github.com/acme/useful");

  assert.equal(parsed.title, "Useful Project");
  assert.match(parsed.content, /这是实际正文/);
  assert.match(parsed.content, /## 使用/);
  assert.doesNotMatch(parsed.content, /Navigation Menu|Sign in|Pull requests|Stars|GitHub, Inc/);
});

test("uses reader content for an article page", () => {
  const html = `<!doctype html>
    <html>
      <head><title>一篇长文章 - 示例站</title></head>
      <body>
        <header>首页 新闻 订阅 登录</header>
        <main>
          <article>
            <h1>如何整理个人资料</h1>
            <p>第一段解释为什么要让资料来源保持清晰，并且把判断和原文分开。</p>
            <p>第二段说明每条结论都应该能够回到原始段落，而不是只给一个模糊链接。</p>
            <p>第三段建议在没有证据时直接说明没有找到，避免用相似词拼出似是而非的答案。</p>
          </article>
          <aside>推荐阅读 广告 热门文章</aside>
        </main>
        <footer>联系我们 隐私政策</footer>
      </body>
    </html>`;

  const parsed = extractHtmlContent(html, "https://example.com/articles/evidence");

  assert.equal(parsed.title, "如何整理个人资料");
  assert.match(parsed.content, /第一段解释/);
  assert.match(parsed.content, /第三段建议/);
  assert.doesNotMatch(parsed.content, /首页 新闻|推荐阅读|隐私政策/);
});
