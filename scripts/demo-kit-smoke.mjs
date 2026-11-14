import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { requiresExecutionFeasibilityCheck } from "../src/lib/feasibility-intent.mjs";

const root = process.cwd();
const demoDirectory = path.join(root, "deliverables", "demo-inputs");
const [constraintsText, brief, gameReference, acceptance, videoOutline] = await Promise.all([
  readFile(path.join(demoDirectory, "主场景约束.json"), "utf8"),
  readFile(path.join(demoDirectory, "冬日活动需求简报.md"), "utf8"),
  readFile(path.join(demoDirectory, "纸笔游戏设计参考.md"), "utf8"),
  readFile(path.join(demoDirectory, "主演示验收表.md"), "utf8"),
  readFile(path.join(root, "docs", "DEMO_VIDEO_OUTLINE.md"), "utf8"),
]);
const constraints = JSON.parse(constraintsText);
const chineseDigits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
const chineseStationCount = chineseDigits[constraints.stations];
assert.ok(chineseStationCount, "当前演示资料的站点数需在 0 到 10 之间");

assert.equal(constraints.participants, constraints.groups * constraints.participantsPerGroup);
assert.equal(constraints.stations, constraints.groups);
assert.ok(constraints.volunteers >= constraints.stations + 1);
assert.equal(constraints.cashBudgetCny, 0);
assert.ok(constraints.durationMinutes > 0);
assert.ok(constraints.unconfirmedFacts.length >= 4);

const expectedCounts = [
  [`${constraints.participants} 名活动参与者`, brief],
  [`不含** ${constraints.volunteers} 名志愿者`, brief],
  [`${constraints.durationMinutes} 分钟`, brief],
  [`${constraints.stations} 个简单站点`, brief],
  [`${constraints.cashBudgetCny} 元`, brief],
  [`${constraints.groups} 组`, gameReference],
  [`每组 ${constraints.participantsPerGroup} 人`, gameReference],
  [`${chineseStationCount}个站点同时开放`, gameReference],
  [`${constraints.stations} 人守站、1 人负责现场统筹`, gameReference],
  [`第 ${constraints.optionalVolunteers + constraints.volunteers} 人`, gameReference],
  [`${constraints.participants} 名参与者`, acceptance],
  [`${constraints.volunteers} 名志愿者`, acceptance],
  [`总到场人数按 ${constraints.participants + constraints.volunteers} 人核算`, acceptance],
  [`现金采购为 ${constraints.cashBudgetCny}`, acceptance],
  [`${constraints.durationMinutes} 分钟`, acceptance],
  [`${constraints.participants} 名参与者`, videoOutline],
  [`${constraints.durationMinutes} 分钟`, videoOutline],
];

for (const [expected, source] of expectedCounts) {
  assert.ok(source.includes(expected), `演示资料缺少与约束清单一致的文字：${expected}`);
}

const stationSection = gameReference.split("## 四个站点")[1]?.split("## 设计要求")[0] || "";
const stationEntries = stationSection.match(/^\d+\.\s+/gm) || [];
assert.equal(stationEntries.length, constraints.stations, "游戏参考必须逐项描述四个站点");

const unconfirmedSection = brief.split("## 尚未确认，不能编造")[1]?.split("## ")[0] || "";
for (const fact of constraints.unconfirmedFacts) {
  assert.ok(unconfirmedSection.includes(fact), `未确认事项必须保留在资料中：${fact}`);
}

const docs = [brief, gameReference, acceptance, videoOutline];
assert.equal(
  requiresExecutionFeasibilityCheck(docs.join("\n")),
  true,
  "the main event demo kit must trigger the execution feasibility gate",
);
assert.ok(
  docs.every((document) => !/^\s*[-*]\s*\[[xX]\]/m.test(document)),
  "演示输入和验收资料不得把规划任务写成已完成清单",
);
assert.match(brief, /不表示活动已获批准、已举办、场地已预订或联办单位已确认/);
assert.match(acceptance, /不捏造/);
assert.match(acceptance, /三条有实质区别的执行路线/);
assert.match(acceptance, /普通细节按合理默认值连续完成/);

console.log(
  `✓ Demo kit is internally consistent: ${constraints.participants} participants, ${constraints.volunteers}+${constraints.optionalVolunteers} volunteers, ${constraints.stations} stations, ${constraints.durationMinutes} minutes, and unconfirmed facts remain explicit.`,
);
