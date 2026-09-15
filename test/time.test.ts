import assert from "node:assert/strict";
import test from "node:test";
import { inferDate, inferDateRange, normalizeDate } from "../src/time.js";

test("normalizes explicit dates without inventing ambiguous ones", () => {
  assert.deepEqual(normalizeDate("2026-09-15"), { date: "2026-09-15", precision: "day" });
  assert.deepEqual(normalizeDate("2026-09"), { date: "2026-09", precision: "month" });
  assert.deepEqual(normalizeDate("2026"), { date: "2026", precision: "year" });
  assert.equal(normalizeDate("09/15"), null);
  assert.equal(normalizeDate("2026-02-30"), null);
});

test("infers Western and Chinese dates and a multi-entry range", () => {
  assert.equal(inferDate(["日记 2024/3/2"])?.date, "2024-03-02");
  assert.equal(inferDate(["2025年11月的复盘"])?.date, "2025-11");
  assert.deepEqual(inferDateRange(["2024-04-09 决定留下\n2023年12月3日 想离开\n没有日期的正文"]), {
    start: "2023-12-03",
    end: "2024-04-09",
  });
  assert.equal(inferDate(["版本 15，项目 202"]), null);
});
