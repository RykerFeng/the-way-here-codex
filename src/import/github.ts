import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { MemoryStore } from "../store.js";
import type { Authorship, ContentScope, SourcePurpose, SyncProgress } from "../types.js";
import { VERSION } from "../version.js";
import { importZip, type ImportSummary } from "./zip.js";

export interface GitHubImportOptions {
  purpose?: SourcePurpose;
  authorship?: Authorship;
  contentScope?: ContentScope;
  connectionId?: string;
  fetcher?: typeof fetch;
  maxArchiveBytes?: number;
  onProgress?: (progress: SyncProgress) => void;
}

interface GitHubLocation {
  owner: string;
  repo: string;
  ref: string | null;
}

export function parseGitHubUrl(value: string): GitHubLocation | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.hostname.toLocaleLowerCase() !== "github.com") return null;
  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (segments.length < 2) return null;
  return { owner: segments[0]!, repo: segments[1]!.replace(/\.git$/i, ""), ref: segments[2] === "tree" ? segments[3] ?? null : null };
}

export async function importGitHub(store: MemoryStore, input: string, options: GitHubImportOptions = {}): Promise<ImportSummary & { adapter: "github-archive"; ref: string }> {
  const location = parseGitHubUrl(input);
  if (!location) throw new Error("不是可识别的 GitHub 仓库地址。");
  const fetcher = options.fetcher ?? fetch;
  const headers: HeadersInit = { accept: "application/vnd.github+json", "user-agent": `the-way-here-codex/${VERSION}` };
  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  if (token) headers.authorization = `Bearer ${token}`;
  let ref = location.ref;
  if (!ref) {
    const metadata = await fetcher(`https://api.github.com/repos/${encodeURIComponent(location.owner)}/${encodeURIComponent(location.repo)}`, { headers });
    if (!metadata.ok) throw new Error(`GitHub 仓库信息读取失败（HTTP ${metadata.status}）。`);
    const value = await metadata.json() as { default_branch?: string };
    ref = value.default_branch || "main";
  }
  const archiveHeaders: HeadersInit = { "user-agent": `the-way-here-codex/${VERSION}` };
  if (token) archiveHeaders.authorization = `Bearer ${token}`;
  const archive = await fetcher(`https://codeload.github.com/${encodeURIComponent(location.owner)}/${encodeURIComponent(location.repo)}/zip/${encodeURIComponent(ref)}`, { headers: archiveHeaders });
  if (!archive.ok) throw new Error(`GitHub 仓库下载失败（HTTP ${archive.status}）。`);
  const maximum = options.maxArchiveBytes ?? 100 * 1024 * 1024;
  const declared = Number(archive.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum) throw new Error("GitHub 仓库压缩包超过 100 MB 上限。");
  const bytes = await readBoundedArchive(archive, maximum);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "the-way-here-github-"));
  const archivePath = path.join(temporary, "repository.zip");
  try {
    await writeFile(archivePath, bytes, { mode: 0o600 });
    const repositoryUrl = `https://github.com/${location.owner}/${location.repo}/tree/${encodeURIComponent(ref)}`;
    const result = await importZip(store, archivePath, {
      purpose: options.purpose ?? "reference",
      authorship: options.authorship ?? "other",
      contentScope: options.contentScope ?? "sourced",
      connectionId: options.connectionId,
      originPrefix: repositoryUrl,
      onProgress: options.onProgress,
    });
    return { ...result, adapter: "github-archive", ref };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function readBoundedArchive(response: Response, maximum: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > maximum) {
        await reader.cancel();
        throw new Error("GitHub 仓库压缩包超过 100 MB 上限。");
      }
      chunks.push(Buffer.from(item.value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
