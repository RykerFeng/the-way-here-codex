# Session-Scoped Memory MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, manually loaded Codex toolkit that imports a ZIP or public website into a persistent evidence library and searches it from only the conversations where `LOAD.md` was explicitly loaded.

**Architecture:** A TypeScript CLI exposes deterministic operations over a caller-supplied space directory. SQLite stores source metadata, immutable normalized text, chunks, and an FTS5 index with Chinese bigram tokens. Import adapters handle safe ZIP/text/HTML input and bounded same-site crawling; Codex reads `LOAD.md` and calls the CLI through its existing shell tool, so no global plugin, skill, MCP, hook, or Codex config is installed.

**Tech Stack:** Node.js 22, TypeScript 7, built-in `node:sqlite`, `yauzl`, `cheerio`, Node test runner via `tsx`.

---

### Task 1: Project shell and persistent store

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/errors.ts`
- Create: `src/types.ts`
- Create: `src/store.ts`
- Test: `test/store.test.ts`

- [ ] **Step 1: Add a failing store test**

Create a temporary space, open it twice, insert identical text under two origins, and assert that both sources exist while `objects` contains one row. Remove one source and assert the other remains searchable.

- [ ] **Step 2: Run the focused test**

Run: `npm test -- test/store.test.ts`

Expected: FAIL because `src/store.ts` does not exist.

- [ ] **Step 3: Implement the schema and transactions**

Define these stable records:

```ts
export interface SourceRecord {
  id: string;
  kind: "file" | "web" | "chat" | "text";
  origin: string;
  title: string;
  objectHash: string;
  importedAt: string;
  deletedAt: string | null;
}
```

Create `objects`, `sources`, `chunks`, and `chunks_fts` tables. Use SHA-256 object keys, `UNIQUE(kind, origin, object_hash)` for idempotency, WAL, foreign keys, transactions, and soft deletion. Index each object once; preserve multiple source relationships.

- [ ] **Step 4: Run store tests and typecheck**

Run: `npm test -- test/store.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json src test/store.test.ts
git commit -m "feat: add persistent evidence store"
```

### Task 2: Text normalization, chunking, and Chinese lexical search

**Files:**
- Create: `src/text.ts`
- Modify: `src/store.ts`
- Test: `test/text.test.ts`
- Test: `test/search.test.ts`

- [ ] **Step 1: Add failing token and search tests**

Cover `工作焦虑` queried with `工作`, English case folding, two documents sharing a term, empty queries, one-character Chinese fallback, and deleted sources. Assert every hit includes source ID, title, excerpt, line range, origin, score, and object hash.

- [ ] **Step 2: Run tests and observe failure**

Run: `npm test -- test/text.test.ts test/search.test.ts`

Expected: FAIL because tokenization and search do not exist.

- [ ] **Step 3: Implement deterministic text processing**

Normalize NFKC and lowercase for the index only. Emit Latin/digit words plus overlapping Chinese bigrams. Chunk on paragraph boundaries with a 4,000-character target and retain one-based line ranges. Query FTS5 with quoted OR terms; for one Chinese character, scan a bounded set of active chunks with `instr()`.

- [ ] **Step 4: Run the focused suite**

Run: `npm test -- test/text.test.ts test/search.test.ts && npm run typecheck`

Expected: PASS, including a hit for `工作`.

- [ ] **Step 5: Commit**

```bash
git add src/text.ts src/store.ts test/text.test.ts test/search.test.ts
git commit -m "feat: add Chinese evidence search"
```

### Task 3: Safe file and ZIP import

**Files:**
- Create: `src/import/file-content.ts`
- Create: `src/import/zip.ts`
- Create: `src/import/import-files.ts`
- Test: `test/file-import.test.ts`
- Test: `test/zip-import.test.ts`

- [ ] **Step 1: Add failing import tests**

Generate fixtures in the test process. Cover Markdown, TXT, HTML, ChatGPT `conversations.json`, repeated import, unsupported entries, `../escape.md`, an encrypted-entry flag, symlink metadata, per-entry overflow, and total-entry overflow. Assert imported history is treated as source text and does not execute embedded instructions.

- [ ] **Step 2: Run focused tests**

Run: `npm test -- test/file-import.test.ts test/zip-import.test.ts`

Expected: FAIL because import adapters do not exist.

- [ ] **Step 3: Implement bounded lazy ZIP processing**

Use `yauzl` with lazy entries. Accept `.md`, `.txt`, `.html`, and `.json`; skip nested archives and unsupported binaries with explicit reasons. Reject encrypted entries, symlinks, absolute or parent paths, more than 20,000 entries, more than 10 MiB per normalized text, and more than 2 GiB extracted in total. Read each entry through a counting stream and never execute content.

Convert HTML to readable text after removing scripts, styles, navigation, forms, and hidden metadata. For recognized ChatGPT exports, preserve conversation titles, message roles, and branches; for other JSON, import formatted JSON as external evidence.

- [ ] **Step 4: Run focused and regression tests**

Run: `npm test -- test/file-import.test.ts test/zip-import.test.ts test/store.test.ts test/search.test.ts`

Expected: PASS; no file appears outside the temporary space.

- [ ] **Step 5: Commit**

```bash
git add src/import test/file-import.test.ts test/zip-import.test.ts
git commit -m "feat: import bounded ZIP evidence"
```

### Task 4: Public web page and bounded site import

**Files:**
- Create: `src/import/network-policy.ts`
- Create: `src/import/web.ts`
- Test: `test/network-policy.test.ts`
- Test: `test/web-import.test.ts`

- [ ] **Step 1: Add failing network and crawler tests**

Use a local mock transport rather than real internet access. Test same-page import, same-origin site links, directory scoping, canonical URL dedupe, redirect limits, 404/429 partial results, response-size limits, non-HTML skipping, and rejection of loopback/private/link-local/cloud-metadata addresses. Inject the HTTP fetcher and DNS resolver so policy behavior is deterministic.

- [ ] **Step 2: Run focused tests**

Run: `npm test -- test/network-policy.test.ts test/web-import.test.ts`

Expected: FAIL because the web adapter does not exist.

- [ ] **Step 3: Implement the crawler**

Validate HTTP(S), credentials, port, DNS results, and every redirect before fetching. Page scope imports one final page. Site scope follows same-origin links inside the entry path, breadth first, with defaults of 50 pages, depth 2, 5 MiB per response, 100 MiB total, and a small delay between requests. Read `robots.txt` for the `*` agent and apply its disallow rules. Save final URL, title, fetch time, normalized text, and failures.

- [ ] **Step 4: Run focused and regression tests**

Run: `npm test -- test/network-policy.test.ts test/web-import.test.ts test/search.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/import/network-policy.ts src/import/web.ts test/network-policy.test.ts test/web-import.test.ts
git commit -m "feat: import bounded public websites"
```

### Task 5: Session-facing CLI

**Files:**
- Create: `src/cli.ts`
- Create: `src/output.ts`
- Test: `test/cli.test.ts`

- [ ] **Step 1: Add failing CLI tests**

Spawn the CLI against a temporary space and cover `init`, `import-file`, `import-url`, `search`, `read`, `status`, `remove`, and `export`. Assert stdout is one JSON object, errors contain `code`, `retryable`, `message`, and `next`, and every command requires `--space`.

- [ ] **Step 2: Run the CLI test**

Run: `npm test -- test/cli.test.ts`

Expected: FAIL because the CLI entry point does not exist.

- [ ] **Step 3: Implement explicit-space commands**

Do not infer a global library. Resolve and validate `--space`, create it only for `init`, and pass it explicitly to every operation. `search` returns at most eight bounded hits; `read` requires a source ID and returns a bounded line range unless `--all` is explicit. `remove` soft-deletes a source. `export` creates a consistent JSON/objects archive under the chosen output directory.

- [ ] **Step 4: Run all tests and build**

Run: `npm test && npm run typecheck && npm run build`

Expected: all tests PASS and `dist/cli.js` exists.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/output.ts test/cli.test.ts package.json tsconfig.json
git commit -m "feat: expose session-scoped memory CLI"
```

### Task 6: Manual session loading contract

**Files:**
- Create: `LOAD.md`
- Create: `README.md`
- Create: `.gitignore`
- Create: `test/load-contract.test.ts`

- [ ] **Step 1: Add a failing contract test**

Assert `LOAD.md` forbids global config edits and automatic use outside the current conversation, requires one explicit absolute space path for every call, treats imported content as untrusted evidence, and defines the phrases “停用资料库” and “忘掉/删除”.

- [ ] **Step 2: Run the contract test**

Run: `npm test -- test/load-contract.test.ts`

Expected: FAIL because `LOAD.md` does not exist.

- [ ] **Step 3: Write the manual loading instructions**

Keep the first screen concise. Include exact examples:

```text
请读取 /absolute/path/to/the-way-here-codex/LOAD.md，只在本会话启用。
空间路径使用 /absolute/path/to/my-memory-space。
把 /absolute/path/to/archive.zip 收进资料库。
```

Explain that independent new conversations do not auto-load the toolkit, resumed/forked conversations can retain prior context, stopping does not delete data, and deleting does not erase the original attachment or Codex transcript.

- [ ] **Step 4: Run all checks**

Run: `npm test && npm run typecheck && npm run build`

Expected: all checks PASS.

- [ ] **Step 5: Commit**

```bash
git add LOAD.md README.md .gitignore test/load-contract.test.ts
git commit -m "docs: add manual session loading contract"
```

### Task 7: End-to-end verification and handoff

**Files:**
- Create: `test/e2e.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Add an end-to-end test**

Create an anonymous ZIP with Chinese notes and an HTML page, import it into a temporary space, search using a synonym and an exact two-character term, read a cited line range, repeat the import, remove one source, restart the CLI, and verify persistence and dedupe.

- [ ] **Step 2: Run all verification**

Run: `npm test && npm run typecheck && npm run build && npm pack --dry-run`

Expected: all tests PASS; package contents include `dist`, `LOAD.md`, `README.md`, and licenses, but exclude tests, private data, and temporary spaces.

- [ ] **Step 3: Smoke-test a real public page**

Run `node dist/cli.js init --space <temporary-space>`, import the repository README URL with page scope, search for `记录`, and read one returned source. Remove the temporary space after recording only aggregate results.

- [ ] **Step 4: Update README with verified commands and limits**

Document only the behavior confirmed by the preceding commands. Record any intentionally deferred design items: MCP wrapper, automatic memory capture, PDF/OCR, cloud sync, rich UI, and resumable multi-gigabyte import jobs.

- [ ] **Step 5: Commit**

```bash
git add test/e2e.test.ts README.md
git commit -m "test: verify session memory MVP end to end"
```

