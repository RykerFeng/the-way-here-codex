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
