# Narrative Voice v0.5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan inline. Do not dispatch subagents. This plan follows the user's explicit request to use case-based iteration rather than TDD and to avoid intermediate commits.

**Goal:** Add a project-owned narrative response layer that turns recalled personal evidence into direct, natural, time-aware answers without inventing identity, causality, or intimacy.

**Architecture:** Keep retrieval and storage unchanged. Route recall responses from the existing explicit-only Skill into one progressively disclosed reference, then evaluate the behavior with a 36-case project-owned suite that separates hard evidence boundaries from soft reading quality.

**Tech Stack:** Codex Skill Markdown, JSON case fixtures, Node.js 22, TypeScript tests, existing esbuild release packaging.

---

## File map

| Path | Responsibility |
| --- | --- |
| `skills/the-way-here/references/narrative-voice.md` | Runtime guidance for evidence framing, mode-specific answer shapes, tone, length, sources, and final review |
| `skills/the-way-here/SKILL.md` | Read the reference only after recall results are available |
| `evals/narrative-voice/cases.json` | 36 scenario fixtures and observable requirements |
| `evals/narrative-voice/rubric.md` | Hard/soft review protocol independent of exact wording |
| `evals/narrative-voice/results.md` | Per-case baseline issue, candidate review, and remaining limitations |
| `test/load-contract.test.ts` | Assert explicit-only scope, progressive disclosure, and response-boundary contract |
| `scripts/package-release.mjs` | Add the runtime reference to the release ZIP |
| `README.md` | Explain the improved answer experience with one compact example |
| `package.json` | Set the release candidate version to `0.5.0` |

## Task 1: Build the case set before tuning language

**Files:**
- Create: `evals/narrative-voice/cases.json`
- Create: `evals/narrative-voice/rubric.md`

- [ ] Create a JSON object with `version`, `groups`, and `cases`. Each case uses this schema:

```json
{
  "id": "change-career-two-dates",
  "group": "change",
  "userMessage": "我这次又想换工作，和上次有什么不同？",
  "recall": {
    "mode": "change",
    "sufficient": true,
    "reason": "找到了足够的可核对记录。"
  },
  "evidence": [
    {
      "title": "一月工作日记",
      "occurredAt": "2024-01-12",
      "authorship": "user",
      "subject": "user",
      "contentScope": "personal",
      "text": "我只想立刻离开，还没有决定下一站。"
    },
    {
      "title": "四月工作复盘",
      "occurredAt": "2024-04-09",
      "authorship": "user",
      "subject": "user",
      "contentScope": "personal",
      "text": "我决定先留下，把发布做完，十月再重新评估。"
    }
  ],
  "requirements": {
    "mustPreserve": ["2024-01-12 未做决定", "2024-04-09 先完成发布再评估"],
    "mustNotClaim": ["用户害怕改变", "用户完成了成长", "这次与上次相同"],
    "answerShape": "earlier-later-open-present",
    "depth": "brief"
  }
}
```

- [ ] Add exactly 36 cases using the distribution in the design: 5 moment, 6 change, 5 pattern, 5 relationship, 4 quote, 4 insufficient/conflict, 3 current-intent/safety, and 4 reading-experience.
- [ ] Include at least eight restraint cases where the desired outcome is to keep an already direct answer short or to avoid using memory at all.
- [ ] Include work, health habits without medical inference, friendship, family, creative work, money decisions, conflicting beliefs, book excerpts, fiction, assistant speech, undated records, document-modification-time traps, and current intent overriding an old preference.
- [ ] Write `rubric.md` with six hard gates and six soft dimensions from the design. Require quoted evidence for every hard failure and allow multiple good answers.
- [ ] Check suite integrity with:

```bash
node -e 'const x=require("./evals/narrative-voice/cases.json"); const counts=Object.groupBy(x.cases,c=>c.group); console.log(x.cases.length, Object.fromEntries(Object.entries(counts).map(([k,v])=>[k,v.length])))'
```

Expected: `36` and the exact design distribution.

## Task 2: Write the runtime narrative voice reference

**Files:**
- Create: `skills/the-way-here/references/narrative-voice.md`

- [ ] Write a concise reference with these sections only: purpose, claim boundaries, five answer shapes, insufficient/conflicting evidence, length and warmth, source lines, final check.
- [ ] Make the reference outcome-oriented. It must not reproduce the research survey or copy third-party rule catalogs.
- [ ] Include the four-way internal distinction: current user statement, source fact, Codex interpretation, unknown.
- [ ] Encode these invariants:

```text
Answer the current question before showing memory.
Use 1–3 strong records by default.
Do not infer stable identity from a moment.
Do not infer change from document edit time.
Do not infer a pattern from fewer than three event dates.
Do not infer another person's motive.
Do not replace an unfound quote with a paraphrase.
Do not use old memory to override current intent or safety boundaries.
Do not imitate the user's archive as a writing voice.
```

- [ ] Add mode-specific information order without fixed prose templates.
- [ ] Treat phrases such as “核心是” and “不是 A，而是 B” as diagnostic only when they create empty drama; do not create absolute lexical bans.
- [ ] Keep the file small enough for conditional loading. Target under 1,200 Chinese characters excluding examples, and remove duplicated guidance already present in `SKILL.md`.

## Task 3: Route recall responses through the reference

**Files:**
- Modify: `skills/the-way-here/SKILL.md`

- [ ] In the `Recall` section, add one explicit instruction to read `references/narrative-voice.md` after recall returns and before composing the user-facing answer.
- [ ] Preserve the existing evidence selection and attribution rules. Do not move sync, enter, remember, or stop guidance into the reference.
- [ ] State that the reference applies only to the current recall answer and does not change global Codex style.
- [ ] Keep `agents/openai.yaml` unchanged so `allow_implicit_invocation: false` remains authoritative.

## Task 4: Record case review and refine the reference

**Files:**
- Create: `evals/narrative-voice/results.md`
- Modify as supported by observed cases: `skills/the-way-here/references/narrative-voice.md`

- [ ] For every case, write a short baseline issue using the current v0.4.1 Skill contract. Do not invent a detector score.
- [ ] Draft a candidate answer using the new reference and review it against `rubric.md`.
- [ ] Record one row per case with `id`, baseline issue, hard-gate result, soft-quality result, and any revision made.
- [ ] Revise the reference only when a failure appears across cases or exposes a serious boundary. Do not add a universal rule for a single stylistic preference.
- [ ] Finish with aggregate evidence:

```text
cases reviewed: 36/36
unresolved hard failures: 0
needed-improvement cases preferred or clearly improved: at least 22/28
restraint cases regressed: 0/8
```

- [ ] If any hard failure remains, keep the result marked not ready and continue case iteration before touching release documentation.

## Task 5: Lock the runtime and packaging contract

**Files:**
- Modify: `test/load-contract.test.ts`
- Modify: `scripts/package-release.mjs`

- [ ] Extend the existing installable-skill test to assert the routing reference and key boundaries without matching generated prose:

```ts
assert.match(skill, /references\/narrative-voice\.md/);
const voice = await readFile(path.join(root, "skills", "the-way-here", "references", "narrative-voice.md"), "utf8");
for (const invariant of [
  "先回答用户此刻的问题",
  "当前陈述",
  "来源事实",
  "Codex 的理解",
  "未知",
  "不能把一个时刻写成长期人格",
  "不能猜对方没有表达的动机",
  "不能拿近义转述顶替原话",
  "不能用旧记录覆盖用户现在的意图",
]) assert.match(voice, new RegExp(invariant));
```

- [ ] Add this release entry:

```js
["skills/the-way-here/references/narrative-voice.md", "skills/the-way-here/references/narrative-voice.md"],
```

- [ ] Run the focused contract check after the edits:

```bash
node --disable-warning=ExperimentalWarning --import tsx --test test/load-contract.test.ts
```

Expected: all load-contract tests pass.

## Task 6: Update the user story and version

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] Add one short section after the existing example showing the difference between evidence-first narration and inflated interpretation. Keep it user-facing; do not list internal anti-AI rules.
- [ ] Explain in one sentence that v0.5 changes how recalled evidence is expressed, not which tasks gain access to it.
- [ ] Preserve the README's existing story opening and explicit-only installation flow.
- [ ] Set package version to `0.5.0` using:

```bash
npm version 0.5.0 --no-git-tag-version
```

Expected: only `package.json` and `package-lock.json` version fields change.

## Task 7: Verify the complete candidate

**Files:**
- Inspect all modified files; do not create a commit or PR.

- [ ] Validate the Skill structure:

```bash
python3 /Users/bytedance/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/the-way-here
```

Expected: validation succeeds.

- [ ] Run repository checks:

```bash
npm test
npm run typecheck
npm run package:release
```

Expected: tests and typecheck pass; packaging creates the v0.5.0 ZIP.

- [ ] Inspect the actual archive:

```bash
unzip -l release/the-way-here-codex-v0.5.0.zip
```

Expected: the archive contains `skills/the-way-here/references/narrative-voice.md` alongside the existing Skill files.

- [ ] Run final scope checks:

```bash
git diff --check
git status --short
rg -n "allow_implicit_invocation" skills/the-way-here/agents/openai.yaml
```

Expected: no whitespace errors; all changes are limited to research, design, plan, Skill/reference, evals, packaging, contract test, README, and version files; invocation remains `false`.

- [ ] Review every explicit requirement from the design against current files and command output. Do not claim completion from green unit tests alone; the 36-case review and archive inspection are required evidence.
