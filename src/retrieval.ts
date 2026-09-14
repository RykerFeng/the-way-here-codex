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
]);
const chineseFillerPhrases = ["有没有", "怎么", "怎样", "如何", "什么", "为何", "是否", "可以", "这个", "那个", "一个", "一下", "哪些", "别的", "吗", "呢", "吧"];

export function normalizeQuery(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

export function meaningfulQueryTokens(value: string): string[] {
  let normalized = normalizeQuery(value);
  for (const phrase of chineseFillerPhrases) normalized = normalized.replaceAll(phrase, " ");
  return queryTokens(normalized).filter((token) => !stopTokens.has(token));
}

export function scoreCandidate(query: string, fields: CandidateFields, bm25Rank: number): LexicalScore | null {
  const normalized = normalizeQuery(query);
  const terms = meaningfulQueryTokens(normalized);
  if (!normalized || terms.length === 0) return null;

  const normalizedTitle = normalizeQuery(fields.title);
  const normalizedHeading = normalizeQuery(fields.heading);
  const normalizedBody = normalizeQuery(fields.body);
  const exactInContent = normalizedHeading.includes(normalized) || normalizedBody.includes(normalized);
  const exact = normalizedTitle.includes(normalized) || exactInContent;
  const titleTokens = new Set(indexTokens(normalizedTitle));
  const headingTokens = new Set(indexTokens(normalizedHeading));
  const bodyTokens = new Set(indexTokens(normalizedBody));
  const matched = terms.filter((term) => titleTokens.has(term) || headingTokens.has(term) || bodyTokens.has(term));
  const coverage = exact ? 1 : matched.length / terms.length;
  const minimumCoverage = terms.length <= 4 ? 1 : 0.6;
  if (!exact && coverage < minimumCoverage) return null;

  const titleMatches = terms.filter((term) => titleTokens.has(term)).length;
  const asciiTitleMatches = terms.filter((term) => /^[a-z0-9][a-z0-9._-]*$/.test(term) && titleTokens.has(term)).length;
  const headingMatches = terms.filter((term) => headingTokens.has(term)).length;
  const bodyMatches = terms.filter((term) => bodyTokens.has(term)).length;
  const subjectTerms = terms.filter((term) => !titleTokens.has(term));
  if (asciiTitleMatches >= 2 && subjectTerms.length > 0 && !exactInContent) {
    const subjectMatches = subjectTerms.filter((term) => headingTokens.has(term) || bodyTokens.has(term)).length;
    const minimumSubjectCoverage = subjectTerms.length <= 3 ? 1 : 0.6;
    if (subjectMatches / subjectTerms.length < minimumSubjectCoverage) return null;
  }
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
