import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yazl from "yazl";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const name = `the-way-here-codex-v${packageJson.version}`;
const outputDirectory = path.join(root, "release");
const outputPath = path.join(outputDirectory, `${name}.zip`);
const files = [
  ["dist/the-way-here.mjs", "the-way-here.mjs"],
  ["LOAD.md", "LOAD.md"],
  ["README.md", "README.md"],
  ["LICENSE", "LICENSE"],
];

await mkdir(outputDirectory, { recursive: true });
const zip = new yazl.ZipFile();
const checksums = [];
for (const [source, destination] of files) {
  const bytes = await readFile(path.join(root, source));
  zip.addBuffer(bytes, `${name}/${destination}`, { mode: 0o100644 });
  checksums.push(`${createHash("sha256").update(bytes).digest("hex")}  ${destination}`);
}
zip.addBuffer(Buffer.from(`${checksums.join("\n")}\n`), `${name}/SHA256SUMS.txt`, { mode: 0o100644 });
zip.end();

await new Promise((resolve, reject) => {
  const output = createWriteStream(outputPath, { mode: 0o644 });
  output.on("close", resolve);
  output.on("error", reject);
  zip.outputStream.on("error", reject).pipe(output);
});

process.stdout.write(`${outputPath}\n`);
