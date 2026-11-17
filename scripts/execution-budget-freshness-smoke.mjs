import assert from "node:assert/strict";
import {
  explicitlyClearsBudgetLimit,
  extractBudgetLimit,
  normalizeLegacyBudgetLimit,
} from "../src/lib/budget-limit.mjs";
import { normalizeBudgetItems } from "../src/lib/budget-validation.mjs";
import { hasFreshExecutionEvent } from "../src/lib/execution-deliverable-freshness.mjs";
import { validateExecutionFeasibility } from "../src/lib/feasibility-validation.mjs";
import { toolSchemas } from "../src/lib/agent-tools.mjs";

assert.equal(extractBudgetLimit("活动预算上限 5000 元；电子签到单项成本 0 元"), 5000);
assert.equal(extractBudgetLimit("电子签到与纪念卡成本 0 元，实体奖品数量为 0"), null);
assert.equal(extractBudgetLimit("成本上限为 0 元"), 0);
assert.equal(extractBudgetLimit("预算总额控制在 8 千元以内"), 8000);
assert.equal(explicitlyClearsBudgetLimit("本次预算没有总额上限"), true);
assert.equal(explicitlyClearsBudgetLimit("不设预算上限，预算按估算明细列出"), true);
assert.equal(explicitlyClearsBudgetLimit("预算上限为 700 元"), false);

assert.equal(normalizeLegacyBudgetLimit(0, "unknown"), null);
assert.equal(normalizeLegacyBudgetLimit(0, "over"), 0);
assert.equal(normalizeLegacyBudgetLimit(0, "within"), 0);
assert.equal(normalizeLegacyBudgetLimit(null, "unknown"), null);

const detailedBudget = normalizeBudgetItems(
  Array.from({ length: 16 }, (_, index) => ({ name: `项目 ${index + 1}`, amount: 0 })),
);
assert.equal("error" in detailedBudget, false);
assert.equal(detailedBudget.items?.length, 16);
assert.equal(
  "error" in
    normalizeBudgetItems(
      Array.from({ length: 101 }, (_, index) => ({ name: `项目 ${index + 1}`, amount: 0 })),
    ),
  true,
);

const priorEvents = [{ id: "old", name: "draft_document", status: "done" }];
const previousIds = new Set(priorEvents.map((event) => event.id));
assert.equal(hasFreshExecutionEvent(priorEvents, "draft_document", previousIds), false);
assert.equal(
  hasFreshExecutionEvent(
    [...priorEvents, { id: "new", name: "draft_document", status: "done" }],
    "draft_document",
    previousIds,
  ),
  true,
);
assert.equal(
  hasFreshExecutionEvent(
    [{ id: "replacement", name: "calculate_budget", status: "done" }],
    "calculate_budget",
    new Set(["old-budget-event"]),
  ),
  true,
);
assert.equal(
  hasFreshExecutionEvent(
    [...priorEvents, { id: "failed", name: "calculate_budget", status: "error" }],
    "calculate_budget",
    previousIds,
  ),
  false,
);

const feasibilityBlock = {
  date: "2026-12-19",
  time: "14:45-15:45",
  activity: "六个并行数字互动站",
  venue: "校园广场",
  attendeeCount: 60,
  unlistedOnsiteCount: 0,
  venueCapacity: 100,
  staff: [],
  resources: [
    {
      name: "投影设备",
      required: 6,
      available: 0,
      reusable: true,
    },
  ],
};
assert.equal(validateExecutionFeasibility({ blocks: [feasibilityBlock] }).valid, false);

const fallbackResource = {
  ...feasibilityBlock,
  resources: [
    {
      ...feasibilityBlock.resources[0],
      fallback: "参与者使用自带手机扫码；无网络时由志愿者口头读题并手动计分",
    },
  ],
};
const fallbackResult = validateExecutionFeasibility({ blocks: [fallbackResource] });
assert.equal(fallbackResult.valid, true);
assert.equal(fallbackResult.coverage.complete, false);
assert.match(fallbackResult.coverage.pending[0].checks[0], /自带手机扫码/);
assert.equal(
  toolSchemas.validate_feasibility.parse({ blocks: [fallbackResource] }).blocks[0].resources[0]
    .fallback,
  fallbackResource.resources[0].fallback,
);

const reusableShortage = validateExecutionFeasibility({
  blocks: [
    { ...fallbackResource, time: "14:45-15:45" },
    {
      ...fallbackResource,
      time: "15:00-16:00",
      venue: "另一活动区",
      resources: [{ ...fallbackResource.resources[0], required: 3, available: 5 }],
    },
  ],
});
assert.equal(reusableShortage.valid, true);
assert.equal(reusableShortage.coverage.complete, false);
assert.equal(reusableShortage.issues.length, 0);

console.log("Execution budget and fresh-deliverable checks passed.");
