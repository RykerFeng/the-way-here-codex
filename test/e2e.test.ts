import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { ZipFile } from "yazl";

const execute = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const cliPath = path.join(projectRoot, "src", "cli.ts");

async function run(args: string[]): Promise<Record<string, any>> {
  const { stdout } = await execute(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", cliPath, ...args], {
    cwd: projectRoot,
  });
  return JSON.parse(stdout) as Record<string, any>;
}

async function makeZip(target: string): Promise<void> {
  const zip = new ZipFile();
  zip.addBuffer(Buffer.from("# 周记\n\n最近工作焦虑。\n但散步以后好一些。"), "notes/week.md");
  zip.addBuffer(Buffer.from("<title>旧网页</title><main>项目完成后要休息。</main>"), "pages/rest.html");
  zip.end();
  await new Promise<void>((resolve, reject) => {
    zip.outputStream.pipe(createWriteStream(target)).on("close", resolve).on("error", reject);
  });
}

test("CLI imports a ZIP, searches, reads, deduplicates, removes, exports, and reopens", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "way-here-e2e-"));
  const space = path.join(root, "space");
  const zipPath = path.join(root, "anonymous.zip");
  const backup = path.join(root, "backup");
  await makeZip(zipPath);

  assert.equal((await run(["init", "--space", space])).ok, true);
  const imported = await run(["import-file", "--space", space, zipPath]);
  assert.equal(imported.imported.length, 2);
  const repeated = await run(["import-file", "--space", space, zipPath]);
  assert.equal(repeated.imported.every((item: any) => item.sourceCreated === false), true);

  const searched = await run(["search", "--space", space, "工作"]);
  assert.equal(searched.hits.length, 1);
  assert.match(searched.hits[0].excerpt, /工作焦虑/);
  const sourceId = searched.hits[0].sourceId as string;
  const read = await run(["read", "--space", space, sourceId, "--start", "1", "--end", "10"]);
  assert.match(read.result.content, /散步以后/);

  const exported = await run(["export", "--space", space, "--out", backup]);
  assert.equal(exported.sources, 2);
  await run(["remove", "--space", space, sourceId]);
  assert.equal((await run(["search", "--space", space, "工作"])).hits.length, 0);
  assert.deepEqual((await run(["status", "--space", space])).status, { sources: 1, objects: 1, chunks: 1 });
});

test("CLI refuses an implicit or relative space", async () => {
  await assert.rejects(
    execute(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", cliPath, "status", "--space", "relative"], { cwd: projectRoot }),
    (error: { stderr?: string }) => {
      const value = JSON.parse(error.stderr ?? "{}") as { error?: { code?: string; retryable?: boolean; next?: string } };
      return value.error?.code === "USAGE_ERROR" && value.error.retryable === false && Boolean(value.error.next);
    },
  );
});
