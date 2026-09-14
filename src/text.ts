export interface TextChunk {
  ordinal: number;
  startLine: number;
  endLine: number;
  content: string;
  headingPath: string[];
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

interface TextBlock {
  startLine: number;
  endLine: number;
  content: string;
  headingPath: string[];
}

export function chunkText(value: string, targetCharacters = 1_200): TextChunk[] {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  const blocks: TextBlock[] = [];
  const headings: string[] = [];
  let index = 0;
  while (index < lines.length) {
    if (!lines[index]!.trim()) {
      index += 1;
      continue;
    }
    const start = index;
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[index]!.trim());
    if (heading) {
      const level = heading[1]!.length;
      headings.length = level - 1;
      headings[level - 1] = heading[2]!.trim();
      blocks.push({ startLine: index + 1, endLine: index + 1, content: lines[index]!.trim(), headingPath: compactHeadingPath(headings) });
      index += 1;
      continue;
    }
    while (index + 1 < lines.length && lines[index + 1]!.trim() && !/^#{1,6}\s+/.test(lines[index + 1]!.trim())) index += 1;
    const content = lines.slice(start, index + 1).join("\n").trim();
    blocks.push(...splitBlock({ startLine: start + 1, endLine: index + 1, content, headingPath: compactHeadingPath(headings) }, targetCharacters));
    index += 1;
  }

  const chunks: TextChunk[] = [];
  let current: { startLine: number; endLine: number; parts: string[]; headingPath: string[] } | undefined;
  for (const block of blocks) {
    const candidateLength = (current?.parts.join("\n\n").length ?? 0) + (current ? 2 : 0) + block.content.length;
    const headingChanged = current && current.headingPath.join("\u0000") !== block.headingPath.join("\u0000");
    if (current && (candidateLength > targetCharacters || headingChanged)) {
      chunks.push({ ordinal: chunks.length, startLine: current.startLine, endLine: current.endLine, content: current.parts.join("\n\n"), headingPath: current.headingPath });
      current = undefined;
    }
    if (!current) current = { startLine: block.startLine, endLine: block.endLine, parts: [], headingPath: block.headingPath };
    current.endLine = block.endLine;
    current.parts.push(block.content);
  }
  if (current) chunks.push({ ordinal: chunks.length, startLine: current.startLine, endLine: current.endLine, content: current.parts.join("\n\n"), headingPath: current.headingPath });
  return chunks;
}

function compactHeadingPath(headings: string[]): string[] {
  return headings.filter((heading, index) => heading && heading !== headings[index - 1]);
}

function splitBlock(block: TextBlock, targetCharacters: number): TextBlock[] {
  if (block.content.length <= targetCharacters) return [block];
  const units = block.content.match(/[^。！？.!?\n]+[。！？.!?]?|\n/g)?.filter((unit) => unit !== "\n") ?? [block.content];
  const pieces: string[] = [];
  let current = "";
  for (const unit of units) {
    if (unit.length > targetCharacters) {
      if (current) pieces.push(current);
      current = "";
      for (let offset = 0; offset < unit.length; offset += targetCharacters) pieces.push(unit.slice(offset, offset + targetCharacters));
    } else if (current && current.length + unit.length > targetCharacters) {
      pieces.push(current);
      current = unit;
    } else {
      current += unit;
    }
  }
  if (current) pieces.push(current);
  return pieces.map((content) => ({ ...block, content }));
}
