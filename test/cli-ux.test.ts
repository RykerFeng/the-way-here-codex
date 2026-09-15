import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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
  assert.equal(result.loadFile, path.join(space, "LOAD_THE_WAY_HERE.md"));
  assert.match(result.prompt, /LOAD\.md/);
  assert.match(result.prompt, /来时路/);
  assert.match(result.prompt, /当前任务/);
  assert.match(result.prompt, new RegExp(space.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(await readFile(result.loadFile, "utf8"), /当前任务入口/);
});

test("personal memories stay separate from references and today can be left for later", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "way-here-story-ux-"));
  const space = path.join(root, "space");
  const diary = path.join(root, "2024-01-12-日记.md");
  const article = path.join(root, "article.md");
  await writeFile(diary, "# 第一次认真考虑\n\n那天我认真想换工作，但还没有作决定。\n");
  await writeFile(article, "# 职业建议文章\n\n作者说换工作前要准备现金。\n");
  await run(["setup", "--space", space]);

  const importedMemory = await run(["import", "--space", space, diary, "--as", "memory", "--authorship", "user"]);
  await run(["import", "--space", space, article]);
  const overview = await run(["overview", "--space", space]);
  const recalled = await run(["recall", "--space", space, "--mode", "moment", "--queries-json", JSON.stringify(["认真想换工作"])]);
  const remembered = await run(["remember", "--space", space, "--entry-json", JSON.stringify({
    title: "今天先问清楚节奏",
    content: "面对新机会，我决定先问清楚节奏。",
    occurredAt: "2026-09-15",
  })]);
  const futureRecall = await run(["recall", "--space", space, "--mode", "moment", "--queries-json", JSON.stringify(["新机会 问清楚节奏"])]);

  assert.equal(importedMemory.imported[0].source.purpose, "memory");
  assert.equal(importedMemory.imported[0].source.authorship, "user");
  assert.equal(importedMemory.imported[0].source.occurredAt, "2024-01-12");
  assert.deepEqual(overview.overview, {
    memories: 1,
    references: 1,
    datedMemories: 1,
    earliestMemory: "2024-01-12",
    latestMemory: "2024-01-12",
    starterPrompts: overview.overview.starterPrompts,
  });
  assert.equal(recalled.hits.length, 1);
  assert.equal(recalled.hits[0].purpose, "memory");
  assert.equal(remembered.remembered.source.purpose, "memory");
  assert.equal(futureRecall.hits[0].title, "今天先问清楚节奏");
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

  assert.equal(version.version, "0.3.0");
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
