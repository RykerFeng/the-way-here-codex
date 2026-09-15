#!/usr/bin/env node
import "./warnings.js";
import { access, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryError } from "./errors.js";
import { importFiles } from "./import/import-files.js";
import { importWeb } from "./import/web.js";
import { failure, success } from "./output.js";
import { MemoryStore } from "./store.js";
import { VERSION } from "./version.js";
import type { Authorship, RecallMode, RememberEntryInput, SourcePurpose } from "./types.js";

interface ParsedArguments {
  flags: Map<string, string | true>;
  positionals: string[];
}

async function main(argv: string[]): Promise<void> {
  const command = argv[0];
  if (!command || command === "help" || command === "--help" || command === "-h") {
    const topic = command === "help" ? argv[1] : undefined;
    const help = commandHelp(topic);
    success("help", help);
    return;
  }
  if (command === "version" || command === "--version" || command === "-v") {
    success("version", { version: VERSION });
    return;
  }
  const parsed = parseArguments(argv.slice(1));
  const space = requiredAbsolute(parsed, "space");
  if (command !== "init" && command !== "setup") await requireExistingSpace(space);

  if (command === "init" || command === "setup") {
    await mkdir(space, { recursive: true });
    const store = await MemoryStore.open(space);
    try {
      const value: Record<string, unknown> = { space, status: store.status() };
      if (command === "setup") {
        const loadPath = await resolveLoadPath();
        const sessionLoadPath = path.join(space, "LOAD_THE_WAY_HERE.md");
        const sessionPrompt = `请读取并遵守 ${loadPath}，带着资料空间 ${space} 里的来时路进入当前任务；不要影响其他任务。`;
        await writeFile(sessionLoadPath, `# The Way Here · 当前任务入口\n\n${sessionPrompt}\n`, { mode: 0o600 });
        value.loadFile = sessionLoadPath;
        value.prompt = sessionPrompt;
        value.next = "把 loadFile 拖进想使用来时路的 Codex 任务，或复制 prompt；其他任务不会受到影响。";
      }
      success(command, value);
    } finally {
      store.close();
    }
    return;
  }

  const store = await MemoryStore.open(space);
  try {
    if (command === "import") {
      const input = requiredPositional(parsed, "文件路径或网页地址");
      if (isHttpUrl(input)) {
        const scope = optionalString(parsed, "scope") ?? "page";
        if (scope !== "page" && scope !== "site") throw usageError("--scope 只能是 page 或 site。");
        const result = await importWeb(store, input, { scope, purpose: optionalPurpose(parsed), authorship: optionalAuthorship(parsed) });
        success(command, { space, input, scope, ...result });
      } else {
        const result = await importFiles(store, input, { purpose: optionalPurpose(parsed), authorship: optionalAuthorship(parsed) });
        success(command, { space, input: path.resolve(input), ...result });
      }
    } else if (command === "import-file") {
      const input = requiredPositional(parsed, "文件路径");
      const result = await importFiles(store, input, { purpose: optionalPurpose(parsed), authorship: optionalAuthorship(parsed) });
      success(command, { space, ...result });
    } else if (command === "import-url") {
      const url = requiredPositional(parsed, "网页地址");
      const scope = optionalString(parsed, "scope") ?? "page";
      if (scope !== "page" && scope !== "site") throw usageError("--scope 只能是 page 或 site。");
      const result = await importWeb(store, url, { scope, purpose: optionalPurpose(parsed), authorship: optionalAuthorship(parsed) });
      success(command, { space, scope, ...result });
    } else if (command === "search") {
      const query = requiredPositional(parsed, "搜索词");
      const limit = optionalInteger(parsed, "limit", 8);
      success(command, { space, query, hits: store.search(query, limit) });
    } else if (command === "query") {
      const queries = requiredQueries(parsed);
      const limit = optionalInteger(parsed, "limit", 8);
      success(command, { space, queries, hits: store.query(queries, limit) });
    } else if (command === "recall") {
      const queries = requiredQueries(parsed);
      const mode = requiredRecallMode(parsed);
      const limit = optionalInteger(parsed, "limit", 8);
      const includeReferences = optionalString(parsed, "include") === "reference";
      success(command, { space, queries, ...store.recall(queries, { mode, limit, includeReferences }) });
    } else if (command === "remember") {
      const entry = requiredRememberEntry(parsed);
      success(command, { space, remembered: store.remember(entry) });
    } else if (command === "overview") {
      success(command, { space, overview: store.overview() });
    } else if (command === "mark") {
      const sourceId = requiredPositional(parsed, "资料 ID");
      const purpose = requiredPurpose(parsed);
      success(command, { space, source: store.markSource(sourceId, purpose, optionalAuthorship(parsed)) });
    } else if (command === "read") {
      const sourceId = requiredPositional(parsed, "资料 ID");
      const start = optionalInteger(parsed, "start", 1);
      const all = parsed.flags.get("all") === true;
      const end = all ? Number.MAX_SAFE_INTEGER : optionalInteger(parsed, "end", start + 199);
      success(command, { space, result: store.readSource(sourceId, start, end) });
    } else if (command === "status") {
      success(command, { space, status: store.status() });
    } else if (command === "sources") {
      success(command, { space, sources: store.listSources() });
    } else if (command === "doctor") {
      const diagnosis = store.doctor();
      success(command, { space, ...diagnosis });
    } else if (command === "remove") {
      const sourceId = requiredPositional(parsed, "资料 ID");
      store.removeSource(sourceId);
      success(command, { space, sourceId, removed: true });
    } else if (command === "export") {
      const outputDirectory = requiredAbsolute(parsed, "out");
      await mkdir(outputDirectory, { recursive: true });
      const outputPath = path.join(outputDirectory, `memory-export-${new Date().toISOString().replaceAll(":", "-")}.json`);
      const snapshot = store.exportSnapshot();
      await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      success(command, { space, outputPath, sources: snapshot.sources.length });
    } else {
      throw usageError(`未知命令：${command}`);
    }
  } finally {
    store.close();
  }
}

async function resolveLoadPath(): Promise<string> {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.join(moduleDirectory, "LOAD.md"), path.resolve(moduleDirectory, "../LOAD.md")];
  for (const candidate of candidates) {
    if (await access(candidate).then(() => true).catch(() => false)) return candidate;
  }
  throw new MemoryError("LOAD_NOT_FOUND", "找不到会话加载协议 LOAD.md。", false, "重新下载完整发布包后重试。");
}

function parseArguments(values: string[]): ParsedArguments {
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const name = value.slice(2);
    const next = values[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(name, next);
      index += 1;
    } else {
      flags.set(name, true);
    }
  }
  return { flags, positionals };
}

function requiredAbsolute(parsed: ParsedArguments, name: string): string {
  const value = optionalString(parsed, name);
  if (!value || !path.isAbsolute(value)) throw usageError(`--${name} 必须是绝对路径。`);
  return path.resolve(value);
}

function optionalString(parsed: ParsedArguments, name: string): string | null {
  const value = parsed.flags.get(name);
  return typeof value === "string" ? value : null;
}

function optionalInteger(parsed: ParsedArguments, name: string, fallback: number): number {
  const value = optionalString(parsed, name);
  if (value === null) return fallback;
  const parsedValue = Number(value);
  if (!Number.isSafeInteger(parsedValue) || parsedValue < 1) throw usageError(`--${name} 必须是正整数。`);
  return parsedValue;
}

function requiredPositional(parsed: ParsedArguments, label: string): string {
  const value = parsed.positionals[0];
  if (!value) throw usageError(`缺少${label}。`);
  return value;
}

function requiredQueries(parsed: ParsedArguments): string[] {
  const raw = optionalString(parsed, "queries-json");
  if (!raw) throw usageError("缺少 --queries-json。");
  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(raw);
  } catch {
    throw usageError("--queries-json 必须是 JSON 字符串数组。");
  }
  if (!Array.isArray(parsedValue) || parsedValue.length < 1 || parsedValue.length > 6
    || !parsedValue.every((value) => typeof value === "string" && value.trim())) {
    throw usageError("--queries-json 必须包含 1–6 个非空字符串。");
  }
  return parsedValue.map((value) => (value as string).trim());
}

function optionalPurpose(parsed: ParsedArguments): SourcePurpose | undefined {
  const value = optionalString(parsed, "as");
  if (value === null) return undefined;
  if (value !== "memory" && value !== "reference") throw usageError("--as 只能是 memory 或 reference。");
  return value;
}

function requiredPurpose(parsed: ParsedArguments): SourcePurpose {
  const value = optionalPurpose(parsed);
  if (!value) throw usageError("缺少 --as；只能是 memory 或 reference。");
  return value;
}

function optionalAuthorship(parsed: ParsedArguments): Authorship | undefined {
  const value = optionalString(parsed, "authorship");
  if (value === null) return undefined;
  if (!["user", "other", "mixed", "unknown"].includes(value)) throw usageError("--authorship 只能是 user、other、mixed 或 unknown。");
  return value as Authorship;
}

function requiredRecallMode(parsed: ParsedArguments): RecallMode {
  const value = optionalString(parsed, "mode");
  if (!["moment", "change", "relationship", "pattern", "quote"].includes(value ?? "")) {
    throw usageError("--mode 只能是 moment、change、relationship、pattern 或 quote。");
  }
  return value as RecallMode;
}

function requiredRememberEntry(parsed: ParsedArguments): RememberEntryInput {
  const raw = optionalString(parsed, "entry-json");
  if (!raw) throw usageError("缺少 --entry-json。");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw usageError("--entry-json 必须是 JSON 对象。");
  }
  if (typeof value !== "object" || value === null) throw usageError("--entry-json 必须是 JSON 对象。");
  const entry = value as Record<string, unknown>;
  if (typeof entry.title !== "string" || typeof entry.content !== "string" || typeof entry.occurredAt !== "string"
    || (entry.context !== undefined && typeof entry.context !== "string")) {
    throw usageError("--entry-json 需要字符串字段 title、content、occurredAt；context 可选。");
  }
  return { title: entry.title, content: entry.content, occurredAt: entry.occurredAt, context: entry.context as string | undefined };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function requireExistingSpace(space: string): Promise<void> {
  const info = await stat(space).catch(() => null);
  if (!info?.isDirectory()) throw new MemoryError("SPACE_NOT_FOUND", "资料空间还没有初始化。", false, `先运行 setup --space ${space}`);
  await access(path.join(space, "memory.sqlite")).catch(() => {
    throw new MemoryError("SPACE_NOT_FOUND", "目录不是有效的资料空间。", false, `先运行 setup --space ${space}`);
  });
}

function usageError(message: string): MemoryError {
  return new MemoryError("USAGE_ERROR", message, false, usage());
}

function usage(): string {
  return "the-way-here <setup|import|overview|recall|remember|mark|read|sources|doctor|remove|export|help|version> --space /absolute/space ...";
}

function commandHelp(command?: string): { usage: string; example: string } {
  const help: Record<string, { usage: string; example: string }> = {
    setup: { usage: "the-way-here setup --space /absolute/space", example: "the-way-here setup --space /Users/me/my-memory" },
    import: { usage: "the-way-here import --space /absolute/space <file-or-url> [--as memory|reference] [--authorship user|other|mixed|unknown] [--scope page|site]", example: "the-way-here import --space /Users/me/my-memory /Users/me/过去.zip --as memory --authorship user" },
    overview: { usage: "the-way-here overview --space /absolute/space", example: "the-way-here overview --space /Users/me/my-memory" },
    recall: { usage: "the-way-here recall --space /absolute/space --mode moment|change|relationship|pattern|quote --queries-json '[\"原问题\",\"关键词改写\"]'", example: "the-way-here recall --space /Users/me/my-memory --mode change --queries-json '[\"我对工作有什么变化\",\"工作 决定\"]'" },
    remember: { usage: "the-way-here remember --space /absolute/space --entry-json '{\"title\":\"今天\",\"content\":\"...\",\"occurredAt\":\"2026-09-15\"}'", example: "the-way-here help remember" },
    query: { usage: "the-way-here query --space /absolute/space --queries-json '[\"原问题\",\"关键词改写\"]' [--limit 8]", example: "the-way-here query --space /Users/me/my-memory --queries-json '[\"最近为什么焦虑\",\"焦虑 工作 日期\"]'" },
    read: { usage: "the-way-here read --space /absolute/space <source-id> [--start 1 --end 200|--all]", example: "the-way-here read --space /Users/me/my-memory SOURCE_ID --start 10 --end 30" },
    sources: { usage: "the-way-here sources --space /absolute/space", example: "the-way-here sources --space /Users/me/my-memory" },
    doctor: { usage: "the-way-here doctor --space /absolute/space", example: "the-way-here doctor --space /Users/me/my-memory" },
  };
  return command && help[command] ? help[command] : { usage: usage(), example: "the-way-here help query" };
}

void main(process.argv.slice(2)).catch((error) => {
  failure(error);
  process.exitCode = 1;
});
