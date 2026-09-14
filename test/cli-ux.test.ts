import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const cliPath = path.join(projectRoot, "src", "cli.ts");

async function run(args: string[]): Promise<Record<string, any>> {
  const { stdout, stderr } = await execute(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", cliPath, ...args], { cwd: projectRoot });
  assert.equal(stderr, "");
  return JSON.parse(stdout) as Record<string, any>;
}

test("setup returns a paste-ready task-scoped prompt", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "way-here-setup-"));
  const space = path.join(root, "my evidence");

  const result = await run(["setup", "--space", space]);

  assert.equal(result.command, "setup");
  assert.equal(result.space, space);
  assert.match(result.prompt, /LOAD\.md/);
  assert.match(result.prompt, new RegExp(space.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("unified import, sources, query, and doctor form a complete journey", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "way-here-ux-"));
  const space = path.join(root, "space");
  const note = path.join(root, "样例资料.md");
  await writeFile(note, "# 样例资料\n\n只在当前会话加载，不会影响其他聊天。\n");
  await run(["setup", "--space", space]);

  const imported = await run(["import", "--space", space, note]);
  const sources = await run(["sources", "--space", space]);
  const queried = await run(["query", "--space", space, "--queries-json", JSON.stringify(["会影响别的窗口吗", "当前会话 不影响 其他聊天"])]);
  const doctor = await run(["doctor", "--space", space]);

  assert.equal(imported.imported.length, 1);
  assert.equal(sources.sources[0].title, "样例资料");
  assert.equal(queried.hits[0].sourceId, sources.sources[0].id);
  assert.deepEqual(doctor.checks.map((check: { ok: boolean }) => check.ok), [true, true, true]);
});

test("version and command help do not require a space", async () => {
  const version = await run(["version"]);
  const help = await run(["help", "query"]);

  assert.equal(version.version, "0.2.0");
  assert.match(help.usage, /queries-json/);
  assert.match(help.example, /query --space/);
});

test("unified import recognizes URLs before touching the file system", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "way-here-url-route-"));
  const space = path.join(root, "space");
  await run(["setup", "--space", space]);
  await assert.rejects(
    execute(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", cliPath, "import", "--space", space, "https://127.0.0.1/private"], { cwd: projectRoot }),
    (error: { stderr?: string }) => {
      const value = JSON.parse(error.stderr ?? "{}") as { error?: { code?: string } };
      return value.error?.code === "UNSAFE_URL";
    },
  );
});
