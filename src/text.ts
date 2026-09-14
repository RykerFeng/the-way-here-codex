export interface TextChunk {
  ordinal: number;
  startLine: number;
  endLine: number;
  content: string;
}

const hanRun = /\p{Script=Han}+/gu;
const latinWord = /[\p{Letter}\p{Number}]+/gu;

export function indexTokens(value: string): string[] {
  const normalized = value.normalize("NFKC").toLocaleLowerCase();
  const tokens: string[] = [];
  for (const match of normalized.matchAll(hanRun)) {
    const characters = [...match[0]];
    if (characters.length === 1) tokens.push(characters[0]!);
    for (let index = 0; index < characters.length - 1; index += 1) {
      tokens.push(`${characters[index]}${characters[index + 1]}`);
    }
  }
  const withoutHan = normalized.replace(hanRun, " ");
  tokens.push(...withoutHan.match(latinWord) ?? []);
  return [...new Set(tokens.filter(Boolean))];
}

export function queryTokens(value: string): string[] {
  return indexTokens(value).filter((token) => !["and", "or", "not", "near"].includes(token) || token === "or");
}

export function chunkText(value: string, targetCharacters = 4_000): TextChunk[] {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  const paragraphs: Array<{ startLine: number; endLine: number; content: string }> = [];
  let start = 0;
  for (let index = 0; index <= lines.length; index += 1) {
    const atEnd = index === lines.length;
    if (!atEnd && lines[index]!.trim() !== "") continue;
    if (index > start) {
      paragraphs.push({
        startLine: start + 1,
        endLine: index,
        content: lines.slice(start, index).join("\n").trim(),
      });
    }
    start = index + 1;
  }

  const chunks: TextChunk[] = [];
  let current: { startLine: number; endLine: number; parts: string[] } | undefined;
  for (const paragraph of paragraphs) {
    const candidateLength = (current?.parts.join("\n\n").length ?? 0) + (current ? 2 : 0) + paragraph.content.length;
    if (current && candidateLength > targetCharacters) {
      chunks.push({ ordinal: chunks.length, startLine: current.startLine, endLine: current.endLine, content: current.parts.join("\n\n") });
      current = undefined;
    }
    if (!current) current = { startLine: paragraph.startLine, endLine: paragraph.endLine, parts: [] };
    current.endLine = paragraph.endLine;
    current.parts.push(paragraph.content);
  }
  if (current) chunks.push({ ordinal: chunks.length, startLine: current.startLine, endLine: current.endLine, content: current.parts.join("\n\n") });
  return chunks;
}
