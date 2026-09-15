import { periodBucket } from "./time.js";
import type { RecallMode, RecallResult, SearchHit } from "./types.js";

export function buildRecallResult(mode: RecallMode, candidates: SearchHit[], limit: number): RecallResult {
  const boundedLimit = Math.max(1, Math.min(limit, 30));
  const personalCandidates = candidates.filter((hit) => hit.contentScope !== "fictional" && hit.contentScope !== "sourced");
  const eligible = mode === "quote" ? personalCandidates.filter((hit) => hit.exact) : personalCandidates;
  const hits = mode === "change" || mode === "pattern"
    ? timeDiverse(eligible, boundedLimit)
    : eligible.slice(0, boundedLimit);
  const distinctPeriods = [...new Set(hits.map((hit) => periodBucket(hit.occurredAt)).filter((value): value is string => value !== null))].sort();
  const claimable = hits.filter((hit) => hit.contentScope === "personal" && hit.subject === "user");
  const claimablePeriods = [...new Set(claimable.map((hit) => periodBucket(hit.occurredAt)).filter((value): value is string => value !== null))];
  const requiredPeriods = mode === "change" ? 2 : mode === "pattern" ? 3 : 0;
  const sufficient = requiredPeriods > 0 ? claimablePeriods.length >= requiredPeriods : claimable.length > 0;
  const reason = hits.length === 0
    ? "没有找到足够相关的个人记录。"
    : claimable.length === 0
      ? "找到了相关资料，但内容主体或个人范围尚未确认，不能据此断言这是用户的经历。"
      : requiredPeriods > 0 && !sufficient
      ? `只找到 ${claimablePeriods.length} 个可确认的个人时期；${mode === "change" ? "比较变化至少需要 2 个时期" : "判断反复模式至少需要 3 个时期"}。`
      : "找到了足够的可核对记录。";
  return { mode, hits, distinctPeriods, sufficient, reason };
}

function timeDiverse(candidates: SearchHit[], limit: number): SearchHit[] {
  const selected: SearchHit[] = [];
  const seenPeriods = new Set<string>();
  for (const hit of candidates) {
    const period = periodBucket(hit.occurredAt);
    if (!period || seenPeriods.has(period)) continue;
    seenPeriods.add(period);
    selected.push(hit);
    if (selected.length >= limit) break;
  }
  for (const hit of candidates) {
    if (selected.some((item) => item.sourceId === hit.sourceId && item.chunkId === hit.chunkId)) continue;
    selected.push(hit);
    if (selected.length >= limit) break;
  }
  return selected.sort((left, right) => {
    if (left.occurredAt && right.occurredAt) return left.occurredAt.localeCompare(right.occurredAt);
    if (left.occurredAt) return -1;
    if (right.occurredAt) return 1;
    return right.score - left.score;
  });
}
