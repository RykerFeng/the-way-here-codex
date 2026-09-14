import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

export interface HtmlContent {
  title: string;
  content: string;
}

interface Candidate {
  element: Element;
  bonus: number;
  readerTitle?: string | null;
}

const removableSelector = [
  "script", "style", "noscript", "template", "svg", "canvas", "iframe",
  "nav", "header", "footer", "aside", "dialog", "form",
  "[hidden]", "[aria-hidden='true']", "[role='navigation']", "[role='banner']",
  "[role='contentinfo']", "[role='complementary']",
  ".table-of-contents", ".theme-doc-toc-mobile", ".theme-doc-breadcrumbs",
  ".pagination-nav", ".theme-doc-footer", "[class*='tocCollapsible']", "[class*='breadcrumbs']",
].join(",");

export function extractHtmlContent(html: string, url = "https://example.invalid/"): HtmlContent {
  const dom = new JSDOM(html, { url });
  const document = dom.window.document;
  const candidates: Candidate[] = [];

  const cleaned = document.cloneNode(true) as Document;
  cleaned.querySelectorAll(removableSelector).forEach((node) => node.remove());
  addCandidate(candidates, cleaned.querySelector("article.markdown-body"), 1_200);
  addCandidate(candidates, cleaned.querySelector("main article"), 850);
  addCandidate(candidates, cleaned.querySelector("article"), 700);
  addCandidate(candidates, cleaned.querySelector("main"), 500);
  addCandidate(candidates, cleaned.querySelector("[role='main']"), 450);

  const reader = new Readability(cleaned.cloneNode(true) as Document, { charThreshold: 40 }).parse();
  if (reader?.content) {
    const readerDocument = new JSDOM(`<main>${reader.content}</main>`, { url }).window.document;
    addCandidate(candidates, readerDocument.querySelector("main"), 650, reader.title);
  }
  addCandidate(candidates, cleaned.body, 0);

  const selected = candidates
    .map((candidate) => ({ candidate, content: structuredText(candidate.element) }))
    .filter((item) => item.content.length > 0)
    .sort((left, right) => score(right.candidate, right.content) - score(left.candidate, left.content))[0];

  const extractedContent = selected?.content ?? "";
  const selectedHeading = selected?.candidate.element.querySelector("h1")?.textContent?.trim();
  const title = selectedHeading
    || selected?.candidate.readerTitle?.trim()
    || cleaned.querySelector("h1")?.textContent?.trim()
    || cleaned.querySelector("meta[property='og:title']")?.getAttribute("content")?.trim()
    || cleaned.title.trim()
    || "未命名网页";
  const content = extractedContent.startsWith("# ") ? extractedContent : `# ${title}\n\n${extractedContent}`.trim();
  return { title, content };
}

function addCandidate(candidates: Candidate[], element: Element | null, bonus: number, readerTitle?: string | null): void {
  if (element) candidates.push({ element, bonus, readerTitle });
}

function score(candidate: Candidate, content: string): number {
  const linkLength = [...candidate.element.querySelectorAll("a")]
    .reduce((total, link) => total + (link.textContent?.trim().length ?? 0), 0);
  const noisyPhrases = content.match(/Navigation Menu|Sign in|Sign up|Pull requests|Cookie|Privacy Policy/gi)?.length ?? 0;
  return candidate.bonus + Math.min(content.length, 12_000) - linkLength * 2 - noisyPhrases * 250;
}

function structuredText(root: Element): string {
  const blocks: string[] = [];
  const blockTags = new Set(["P", "DIV", "SECTION", "ARTICLE", "MAIN", "BLOCKQUOTE", "PRE", "TABLE", "TR"]);

  const visit = (node: Node): void => {
    if (node.nodeType === node.TEXT_NODE) {
      const value = node.textContent?.replace(/\s+/g, " ").trim();
      if (value) blocks.push(value);
      return;
    }
    if (node.nodeType !== node.ELEMENT_NODE) return;
    const element = node as Element;
    const heading = /^H([1-6])$/.exec(element.tagName);
    if (heading) {
      const value = element.textContent?.replace(/\s+/g, " ").trim();
      if (value) blocks.push("\n", `${"#".repeat(Number(heading[1]))} ${value}`, "\n");
      return;
    }
    if (element.tagName === "LI") {
      const value = element.textContent?.replace(/\s+/g, " ").trim();
      if (value) blocks.push("\n", `- ${value}`, "\n");
      return;
    }
    if (element.tagName === "BR") {
      blocks.push("\n");
      return;
    }
    if (blockTags.has(element.tagName)) {
      blocks.push("\n");
      const before = blocks.length;
      element.childNodes.forEach(visit);
      if (blocks.length > before) blocks.push("\n");
      return;
    }
    element.childNodes.forEach(visit);
  };

  root.childNodes.forEach(visit);
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
