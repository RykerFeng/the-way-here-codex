import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));

test("the Codex contract carries the past into the present without overreaching", async () => {
  const load = await readFile(path.join(root, "LOAD.md"), "utf8");
  for (const invariant of [
    "先理解用户此刻",
    "不要为了展示记忆而每轮检索",
    "至少两个不同日期",
    "至少三个不同日期",
    "必须命中原话",
    "sufficient: false",
    "不把 assistant、朋友、同事、网页作者的话归给用户",
    "不依据记忆做医学或心理诊断",
    "普通聊天绝不自动保存",
    "“不要保存”永远优先",
    "只约束当前任务",
  ]) {
    assert.match(load, new RegExp(invariant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("the installable skill is explicit-only and offers a task-local off switch", async () => {
  const skill = await readFile(path.join(root, "skills", "the-way-here", "SKILL.md"), "utf8");
  const metadata = await readFile(path.join(root, "skills", "the-way-here", "agents", "openai.yaml"), "utf8");
  assert.match(skill, /Use only when the user invokes \$the-way-here/);
  assert.match(skill, /Do not modify `AGENTS\.md`/);
  assert.match(skill, /\$the-way-here off/);
  assert.match(skill, /Ordinary conversation is never saved automatically/);
  assert.match(skill, /references\/narrative-voice\.md/);
  assert.match(metadata, /allow_implicit_invocation: false/);

  const voice = await readFile(
    path.join(root, "skills", "the-way-here", "references", "narrative-voice.md"),
    "utf8",
  );
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
  ]) {
    assert.match(voice, new RegExp(invariant));
  }
});

test("the narrative voice review covers 36 varied cases without treating prose as a golden string", async () => {
  const raw = await readFile(path.join(root, "evals", "narrative-voice", "cases.json"), "utf8");
  const suite = JSON.parse(raw) as {
    groups: Record<string, number>;
    cases: Array<{
      id: string;
      group: string;
      evidence: unknown[];
      requirements: {
        mustPreserve: string[];
        mustNotClaim: string[];
        answerShape: string;
        depth: string;
        restraint?: boolean;
      };
    }>;
  };
  const expected = {
    moment: 5,
    change: 6,
    pattern: 5,
    relationship: 5,
    quote: 4,
    "insufficient/conflict": 4,
    "current-intent/safety": 3,
    "reading-experience": 4,
  };
  assert.equal(suite.cases.length, 36);
  assert.deepEqual(suite.groups, expected);
  assert.equal(new Set(suite.cases.map(({ id }) => id)).size, 36);
  assert.equal(suite.cases.filter(({ requirements }) => requirements.restraint).length, 8);

  const actual = Object.fromEntries(
    Object.keys(expected).map((group) => [
      group,
      suite.cases.filter((candidate) => candidate.group === group).length,
    ]),
  );
  assert.deepEqual(actual, expected);
  for (const candidate of suite.cases) {
    assert.ok(candidate.requirements.mustPreserve.length > 0, `${candidate.id} needs preserved facts`);
    assert.ok(candidate.requirements.mustNotClaim.length > 0, `${candidate.id} needs explicit boundaries`);
    assert.ok(candidate.requirements.answerShape, `${candidate.id} needs an answer shape`);
    assert.ok(["brief", "deep"].includes(candidate.requirements.depth), `${candidate.id} has invalid depth`);
  }

  const results = await readFile(path.join(root, "evals", "narrative-voice", "results.md"), "utf8");
  for (const { id } of suite.cases) {
    assert.match(results, new RegExp(`\\| ${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\|`));
  }
  assert.match(results, /cases reviewed: \*\*36\/36\*\*/);
  assert.match(results, /unresolved hard failures: \*\*0\*\*/);
  assert.match(results, /restraint cases regressed: \*\*0\/8\*\*/);
});
