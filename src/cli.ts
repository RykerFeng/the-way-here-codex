#!/usr/bin/env node
import { access, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { MemoryError } from "./errors.js";
import { importFiles } from "./import/import-files.js";
import { importWeb } from "./import/web.js";
import { failure, success } from "./output.js";
import { MemoryStore } from "./store.js";

interface ParsedArguments {
  flags: Map<string, string | true>;
  positionals: string[];
}

async function main(argv: string[]): Promise<void> {
  const command = argv[0];
  if (!command || command === "help" || command === "--help" || command === "-h") {
    success("help", { usage: usage() });
    return;
  }
  const parsed = parseArguments(argv.slice(1));
  const space = requiredAbsolute(parsed, "space");
  if (command !== "init") await requireExistingSpace(space);

  if (command === "init") {
    await mkdir(space, { recursive: true });
    const store = await MemoryStore.open(space);
    try {
      success(command, { space, status: store.status() });
    } finally {
      store.close();
    }
    return;
  }

  const store = await MemoryStore.open(space);
  try {
    if (command === "import-file") {
      const input = requiredPositional(parsed, "文件路径");
      const result = await importFiles(store, input);
      success(command, { space, ...result });
    } else if (command === "import-url") {
      const url = requiredPositional(parsed, "网页地址");
      const scope = optionalString(parsed, "scope") ?? "page";
      if (scope !== "page" && scope !== "site") throw usageError("--scope 只能是 page 或 site。");
      const result = await importWeb(store, url, { scope });
      success(command, { space, scope, ...result });
    } else if (command === "search") {
      const query = requiredPositional(parsed, "搜索词");
      const limit = optionalInteger(parsed, "limit", 8);
      success(command, { space, query, hits: store.search(query, limit) });
    } else if (command === "read") {
      const sourceId = requiredPositional(parsed, "资料 ID");
      const start = optionalInteger(parsed, "start", 1);
      const all = parsed.flags.get("all") === true;
      const end = all ? Number.MAX_SAFE_INTEGER : optionalInteger(parsed, "end", start + 199);
      success(command, { space, result: store.readSource(sourceId, start, end) });
    } else if (command === "status") {
      success(command, { space, status: store.status() });
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

async function requireExistingSpace(space: string): Promise<void> {
  const info = await stat(space).catch(() => null);
  if (!info?.isDirectory()) throw new MemoryError("SPACE_NOT_FOUND", "资料空间还没有初始化。", false, `先运行 init --space ${space}`);
  await access(path.join(space, "memory.sqlite")).catch(() => {
    throw new MemoryError("SPACE_NOT_FOUND", "目录不是有效的资料空间。", false, `先运行 init --space ${space}`);
  });
}

function usageError(message: string): MemoryError {
  return new MemoryError("USAGE_ERROR", message, false, usage());
}

function usage(): string {
  return "the-way-here <init|import-file|import-url|search|read|status|remove|export> --space /absolute/space ...";
}

void main(process.argv.slice(2)).catch((error) => {
  failure(error);
  process.exitCode = 1;
});
