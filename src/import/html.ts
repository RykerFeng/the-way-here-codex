import { load } from "cheerio";

export interface HtmlContent {
  title: string;
  content: string;
}

interface HtmlNode {
  type: string;
  data?: string;
  name?: string;
  children?: HtmlNode[];
}

interface ExtractedCandidate {
  content: string;
  firstHeading: string;
  score: number;
}

const removableSelector = [
  "script", "style", "noscript", "template", "svg", "canvas", "iframe",
  "nav", "header", "footer", "aside", "dialog", "form",
  "[hidden]", "[aria-hidden='true']", "[role='navigation']", "[role='banner']",
  "[role='contentinfo']", "[role='complementary']",
  ".table-of-contents", ".theme-doc-toc-mobile", ".theme-doc-breadcrumbs",
  ".pagination-nav", ".theme-doc-footer", "[class*='tocCollapsible']", "[class*='breadcrumbs']",
].join(",");

const candidateSelectors: Array<{ selector: string; bonus: number }> = [
  { selector: "article.markdown-body", bonus: 1_200 },
  { selector: "main article", bonus: 850 },
  { selector: "article", bonus: 700 },
  { selector: "main", bonus: 500 },
  { selector: "[role='main']", bonus: 450 },
  { selector: "body", bonus: 0 },
];

const blockTags = new Set(["p", "div", "section", "article", "main", "blockquote", "pre", "table", "tr"]);

export function extractHtmlContent(html: string, _url = "https://example.invalid/"): HtmlContent {
  const $ = load(html);
  $(removableSelector).remove();

  const candidates: ExtractedCandidate[] = [];
  for (const definition of candidateSelectors) {
    const element = $(definition.selector).first();
    const node = element.get(0) as unknown as HtmlNode | undefined;
    if (!node) continue;
    const content = structuredText(node);
    if (!content) continue;
    const linkLength = element.find("a").toArray()
      .reduce((total, link) => total + ($(link).text().trim().length), 0);
    const noisyPhrases = content.match(/Navigation Menu|Sign in|Sign up|Pull requests|Cookie|Privacy Policy/gi)?.length ?? 0;
    candidates.push({
      content,
      firstHeading: element.find("h1").first().text().trim(),
      score: definition.bonus + Math.min(content.length, 12_000) - linkLength * 2 - noisyPhrases * 250,
    });
  }

  const selected = candidates.sort((left, right) => right.score - left.score)[0];
  const pageTitle = $("meta[property='og:title']").attr("content")?.trim() || $("title").first().text().trim();
  const contentHeading = selected?.firstHeading || $("h1").first().text().trim();
  const title = (pageTitle && !looksLikeSiteTitle(pageTitle) ? pageTitle : contentHeading)
    || pageTitle
    || "未命名网页";
  const extracted = selected?.content ?? "";
  return { title, content: extracted.startsWith("# ") ? extracted : `# ${title}\n\n${extracted}`.trim() };
}

function looksLikeSiteTitle(value: string): boolean {
  return /\s(?:[-|·])\s|GitHub/i.test(value);
}

function structuredText(root: HtmlNode): string {
  const blocks: string[] = [];
  const visit = (node: HtmlNode): void => {
    if (node.type === "text") {
      const value = node.data?.replace(/\s+/g, " ").trim();
      if (value) blocks.push(value);
      return;
    }
    const name = node.name?.toLocaleLowerCase();
    if (!name) {
      node.children?.forEach(visit);
      return;
    }
    if (/^h[1-6]$/.test(name)) {
      const value = plainText(node);
      if (value) blocks.push("\n", `${"#".repeat(Number(name[1]))} ${value}`, "\n");
      return;
    }
    if (name === "li") {
      const value = plainText(node);
      if (value) blocks.push("\n", `- ${value}`, "\n");
      return;
    }
    if (name === "br") {
      blocks.push("\n");
      return;
    }
    if (blockTags.has(name)) blocks.push("\n");
    node.children?.forEach(visit);
    if (blockTags.has(name)) blocks.push("\n");
  };
  root.children?.forEach(visit);
  return blocks.join(" ")
    .replace(/ *\n */g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function plainText(node: HtmlNode): string {
  if (node.type === "text") return node.data ?? "";
  return (node.children ?? []).map(plainText).join(" ").replace(/\s+/g, " ").trim();
}
