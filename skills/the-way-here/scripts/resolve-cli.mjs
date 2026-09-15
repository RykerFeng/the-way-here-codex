#!/usr/bin/env node
import { createHash } from "node:crypto";
import { access, chmod, mkdir, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = "RykerFeng/the-way-here-codex";
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  process.env.THE_WAY_HERE_CLI,
  path.resolve(scriptDirectory, "../../../dist/the-way-here.mjs"),
  path.resolve(scriptDirectory, "../../../dist/cli.js"),
].filter(Boolean);

for (const candidate of candidates) {
  if (await exists(candidate)) {
    process.stdout.write(`${path.resolve(candidate)}\n`);
    process.exit(0);
  }
}

const cacheRoot = process.env.THE_WAY_HERE_HOME?.trim()
  ? path.resolve(process.env.THE_WAY_HERE_HOME)
  : process.platform === "darwin"
    ? path.join(os.homedir(), "Library", "Application Support", "The Way Here")
    : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "the-way-here");
const toolDirectory = path.join(cacheRoot, "tool");
const target = path.join(toolDirectory, "the-way-here.mjs");
if (await exists(target)) {
  process.stdout.write(`${target}\n`);
  process.exit(0);
}

await mkdir(toolDirectory, { recursive: true });
const release = await fetchJson(`https://api.github.com/repos/${repository}/releases/latest`);
const bundle = release.assets?.find((asset) => asset.name === "the-way-here.mjs");
const checksum = release.assets?.find((asset) => asset.name === "the-way-here.mjs.sha256");
if (!bundle || !checksum) throw new Error("最新 Release 缺少 the-way-here.mjs 或校验文件。");

const [bundleResponse, checksumResponse] = await Promise.all([fetch(bundle.browser_download_url), fetch(checksum.browser_download_url)]);
if (!bundleResponse.ok || !checksumResponse.ok) throw new Error("无法下载 The Way Here Release。");
const bytes = Buffer.from(await bundleResponse.arrayBuffer());
const expected = (await checksumResponse.text()).trim().split(/\s+/)[0]?.toLocaleLowerCase();
const actual = createHash("sha256").update(bytes).digest("hex");
if (!expected || expected !== actual) throw new Error("The Way Here Release 校验失败。");

const temporary = path.join(toolDirectory, `.the-way-here-${process.pid}.tmp`);
await writeFile(temporary, bytes, { mode: 0o700 });
await chmod(temporary, 0o700);
await rename(temporary, target);
process.stdout.write(`${target}\n`);

async function exists(value) {
  return access(value).then(() => true).catch(() => false);
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/vnd.github+json", "user-agent": "the-way-here-skill" } });
  if (!response.ok) throw new Error(`GitHub Release 请求失败：HTTP ${response.status}`);
  return response.json();
}
