import { indexTokens, queryTokens } from "./text.js";

export interface CandidateFields {
  title: string;
  heading: string;
  body: string;
}

export interface LexicalScore {
  coverage: number;
  exact: boolean;
  score: number;
  terms: string[];
}

const stopTokens = new Set([
  "and", "or", "the", "a", "an", "to", "of", "in", "is", "are", "what", "how", "why",
  "怎么", "怎样", "如何", "什么", "为何", "是否", "可以", "这个", "那个", "一个", "一下", "有没有", "哪些", "别的",
]);

export function normalizeQuery(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

export function meaningfulQueryTokens(value: string): string[] {
  return queryTokens(normalizeQuery(value)).filter((token) => !stopTokens.has(token));
}

export function scoreCandidate(query: string, fields: CandidateFields, bm25Rank: number): LexicalScore | null {
  const normalized = normalizeQuery(query);
  const terms = meaningfulQueryTokens(normalized);
  if (!normalized || terms.length === 0) return null;

  const normalizedTitle = normalizeQuery(fields.title);
  const normalizedHeading = normalizeQuery(fields.heading);
  const normalizedBody = normalizeQuery(fields.body);
  const exact = normalizedTitle.includes(normalized) || normalizedHeading.includes(normalized) || normalizedBody.includes(normalized);
  const titleTokens = new Set(indexTokens(normalizedTitle));
  const headingTokens = new Set(indexTokens(normalizedHeading));
  const bodyTokens = new Set(indexTokens(normalizedBody));
  const matched = terms.filter((term) => titleTokens.has(term) || headingTokens.has(term) || bodyTokens.has(term));
  const coverage = exact ? 1 : matched.length / terms.length;
  const minimumCoverage = terms.length === 1 ? 1 : 0.5;
  if (!exact && coverage < minimumCoverage) return null;

  const titleMatches = terms.filter((term) => titleTokens.has(term)).length;
  const headingMatches = terms.filter((term) => headingTokens.has(term)).length;
  const bodyMatches = terms.filter((term) => bodyTokens.has(term)).length;
  const boundedBm25 = Math.min(3, Math.log1p(Math.max(0, -bm25Rank) * 1_000_000));
  const score = (exact ? 12 : 0) + coverage * 8 + titleMatches * 2.5 + headingMatches * 1.5 + bodyMatches * 0.25 + boundedBm25;
  return { coverage, exact, score, terms };
}

export function evidenceExcerpt(content: string, query: string, terms: string[], maximum = 320): string {
  const folded = normalizeQuery(content);
  const exactIndex = folded.indexOf(normalizeQuery(query));
  const tokenIndexes = terms.map((term) => folded.indexOf(term)).filter((index) => index >= 0);
  const anchor = exactIndex >= 0 ? exactIndex : (tokenIndexes.length > 0 ? Math.min(...tokenIndexes) : 0);
  const start = Math.max(0, anchor - 90);
  const end = Math.min(content.length, start + maximum);
  return `${start > 0 ? "…" : ""}${content.slice(start, end).trim()}${end < content.length ? "…" : ""}`;
}
