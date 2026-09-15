import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MemoryStore } from "../src/store.js";
import type { Authorship, SourcePurpose } from "../src/types.js";

interface Fixture {
  id: string;
  date?: string;
  text: string;
  purpose?: SourcePurpose;
  authorship?: Authorship;
}

const fixtures: Fixture[] = [
  { id: "career-jan", date: "2024-01-12", text: "项目失控后，我第一次认真想换工作，只想立刻离开，还没有决定下一站。" },
  { id: "career-apr", date: "2024-04-09", text: "再次想到换工作，我决定先留下，把发布做完，十月再重新评估。" },
  { id: "launch-may", date: "2024-05-20", text: "发布结束后，我发现自己已经能平静复盘，不再急着证明什么。" },
  { id: "sleep-one", date: "2025-02-03", text: "睡前刷消息到一点，半夜醒来以后很难再睡。" },
  { id: "sleep-two", date: "2025-02-17", text: "晚上争论工作安排，半夜醒来，脑子一直排明天的任务。" },
  { id: "sleep-three", date: "2025-02-26", text: "临睡前还在回邮件，半夜醒来后又开始担心遗漏。" },
  { id: "linran", date: "2025-03-02", text: "我对林然说暂时不能借钱。林然回答说他理解，也希望我们别因此疏远。", authorship: "mixed" },
  { id: "meimei", date: "2025-03-08", text: "美美约我散步。我告诉她最近需要安静，不是对她生气。", authorship: "mixed" },
  { id: "slow", date: "2025-06-01", text: "复盘时我写下：我想把速度放慢一点，但不想停止前进。" },
  { id: "undated", text: "有一次演讲前，我在楼梯间练了三遍开场，最后还是走进了会场。" },
  { id: "third-party", date: "2025-07-01", text: "同事阿周说他每天都焦虑；我只记录了这句话，没有评价自己的状态。", authorship: "mixed" },
  { id: "book-note", date: "2024-04-01", text: "文章作者建议：换工作之前应该先准备六个月现金。", purpose: "reference", authorship: "other" },
];

test("longitudinal story cases protect identity, time, exact words, and abstention", async (context) => {
  const space = await mkdtemp(path.join(os.tmpdir(), "way-here-story-"));
  const store = await MemoryStore.open(space);
  try {
    for (const fixture of fixtures) {
      store.importDocument({
        kind: "text",
        origin: `fixture:${fixture.id}`,
        title: fixture.id,
        content: `# ${fixture.id}\n\n${fixture.text}`,
        purpose: fixture.purpose ?? "memory",
        authorship: fixture.authorship ?? "user",
        occurredAt: fixture.date,
      });
    }

    const cases: Array<{ name: string; run: () => void }> = [
      { name: "moment finds a specific earlier hesitation", run: () => assert.equal(store.recall(["认真想换工作", "立刻离开"], { mode: "moment" }).hits[0]?.title, "career-jan") },
      { name: "moment finds a later decision", run: () => assert.equal(store.recall(["决定先留下", "发布做完"], { mode: "moment" }).hits[0]?.title, "career-apr") },
      { name: "change spans two dated records", run: () => {
        const result = store.recall(["换工作", "立刻离开", "决定先留下"], { mode: "change" });
        assert.equal(result.sufficient, true);
        assert.deepEqual(result.distinctPeriods, ["2024-01-12", "2024-04-09"]);
      } },
      { name: "change is chronological", run: () => {
        const result = store.recall(["换工作", "立刻离开", "决定先留下"], { mode: "change" });
        assert.deepEqual(result.hits.map((hit) => hit.occurredAt), ["2024-01-12", "2024-04-09"]);
      } },
      { name: "one dated record cannot prove change", run: () => assert.equal(store.recall(["发布结束 平静复盘"], { mode: "change" }).sufficient, false) },
      { name: "three dates can support a pattern", run: () => assert.equal(store.recall(["半夜醒来", "睡前 工作"], { mode: "pattern" }).sufficient, true) },
      { name: "same-month repetitions remain distinct", run: () => assert.equal(store.recall(["半夜醒来", "睡前 工作"], { mode: "pattern" }).distinctPeriods.length, 3) },
      { name: "two dates cannot prove a pattern", run: () => assert.equal(store.recall(["换工作", "立刻离开", "决定先留下"], { mode: "pattern" }).sufficient, false) },
      { name: "relationship keeps the named person", run: () => assert.equal(store.recall(["林然 借钱"], { mode: "relationship" }).hits[0]?.title, "linran") },
      { name: "another relationship does not substitute", run: () => assert.ok(store.recall(["美美 散步"], { mode: "relationship" }).hits.every((hit) => hit.title !== "linran")) },
      { name: "relationship evidence preserves mixed authorship", run: () => assert.equal(store.recall(["林然 借钱"], { mode: "relationship" }).hits[0]?.authorship, "mixed") },
      { name: "exact quote is returned", run: () => assert.equal(store.recall(["我想把速度放慢一点，但不想停止前进"], { mode: "quote" }).hits[0]?.title, "slow") },
      { name: "a paraphrase is not presented as a quote", run: () => assert.equal(store.recall(["我希望慢下来继续走"], { mode: "quote" }).hits.length, 0) },
      { name: "references do not leak into personal recall", run: () => assert.ok(store.recall(["换工作"], { mode: "moment" }).hits.every((hit) => hit.title !== "book-note")) },
      { name: "references can be included explicitly", run: () => assert.ok(store.recall(["换工作 六个月现金"], { mode: "moment", includeReferences: true }).hits.some((hit) => hit.title === "book-note")) },
      { name: "unknown history abstains", run: () => assert.equal(store.recall(["海边学潜水"], { mode: "moment" }).hits.length, 0) },
      { name: "an undated memory can support a moment", run: () => assert.equal(store.recall(["楼梯间 三遍开场"], { mode: "moment" }).hits[0]?.title, "undated") },
      { name: "an undated memory cannot prove change", run: () => assert.equal(store.recall(["楼梯间 三遍开场"], { mode: "change" }).sufficient, false) },
      { name: "a third party statement remains mixed", run: () => assert.equal(store.recall(["阿周 每天 焦虑"], { mode: "relationship" }).hits[0]?.authorship, "mixed") },
      { name: "a captured present becomes future past", run: () => {
        store.remember({ title: "今天没有立刻答应", content: "今天面对新机会，我没有立刻答应，决定先问清楚节奏。", occurredAt: "2026-09-15" });
        assert.equal(store.recall(["新机会 没有立刻答应"], { mode: "moment" }).hits[0]?.title, "今天没有立刻答应");
      } },
      { name: "capturing the same present is idempotent", run: () => {
        const again = store.remember({ title: "今天没有立刻答应", content: "今天面对新机会，我没有立刻答应，决定先问清楚节奏。", occurredAt: "2026-09-15" });
        assert.equal(again.sourceCreated, false);
      } },
      { name: "overview shows the whole dated road", run: () => {
        const overview = store.overview();
        assert.equal(overview.earliestMemory, "2024-01-12");
        assert.equal(overview.latestMemory, "2026-09-15");
        assert.equal(overview.references, 1);
      } },
      { name: "marking a reference makes it recallable as memory", run: () => {
        const source = store.listSources().find((item) => item.title === "book-note")!;
        store.markSource(source.id, "memory", "other");
        assert.ok(store.recall(["换工作 六个月现金"], { mode: "moment" }).hits.some((hit) => hit.title === "book-note"));
      } },
      { name: "an unqualified reimport preserves a manual classification", run: () => {
        const existing = store.listSources().find((item) => item.title === "book-note")!;
        const imported = store.importDocument({ kind: "text", origin: "fixture:book-note", title: "book-note", content: "# book-note\n\n文章作者建议：换工作之前应该先准备六个月现金。" });
        assert.equal(imported.source.id, existing.id);
        assert.equal(imported.source.purpose, "memory");
      } },
    ];

    for (const item of cases) item.run();
    context.diagnostic(`story cases=${cases.length}; all passed`);
    assert.ok(cases.length >= 20);
  } finally {
    store.close();
  }
});
