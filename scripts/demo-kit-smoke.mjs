import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { validateExecutionFeasibility } from "../src/lib/feasibility-validation.mjs";
import { requiresExecutionFeasibilityCheck } from "../src/lib/feasibility-intent.mjs";

const root = process.cwd();
const demoDirectory = path.join(root, "deliverables", "demo-inputs");
const [constraintsText, brief, gameReference, gameCards, healthCards, acceptance, videoOutline] =
  await Promise.all([
    readFile(path.join(demoDirectory, "主场景约束.json"), "utf8"),
    readFile(path.join(demoDirectory, "冬日活动需求简报.md"), "utf8"),
    readFile(path.join(demoDirectory, "纸笔游戏设计参考.md"), "utf8"),
    readFile(path.join(demoDirectory, "纸笔游戏四站卡包.md"), "utf8"),
    readFile(path.join(demoDirectory, "健康知识判断卡-主持人版.md"), "utf8"),
    readFile(path.join(demoDirectory, "主演示验收表.md"), "utf8"),
    readFile(path.join(root, "docs", "DEMO_VIDEO_OUTLINE.md"), "utf8"),
  ]);

const printReadyDirectory = path.join(demoDirectory, "print-ready");
const printFiles = {
  participantDocx: path.join(printReadyDirectory, "冬日健康守护参与者卡片.docx"),
  participantPdf: path.join(printReadyDirectory, "冬日健康守护参与者卡片.pdf"),
  hostGuideDocx: path.join(printReadyDirectory, "冬日健康守护主持人现场指南.docx"),
  hostGuidePdf: path.join(printReadyDirectory, "冬日健康守护主持人现场指南.pdf"),
};
const [participantDocxBytes, participantPdfBytes, hostGuideDocxBytes, hostGuidePdfBytes] =
  await Promise.all(Object.values(printFiles).map((filePath) => readFile(filePath)));

async function readDocxText(documentBytes, label) {
  const archive = await JSZip.loadAsync(documentBytes);
  const documentXml = archive.file("word/document.xml");
  assert.ok(documentXml, `${label} must include Word document XML`);
  const xml = await documentXml.async("string");
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((match) =>
      match[1]
        .replaceAll("&amp;", "&")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&apos;", "'"),
    )
    .join("");
}

async function assertPdfPageCount(pdfBytes, expectedPages, label) {
  assert.equal(pdfBytes.toString("ascii", 0, 5), "%PDF-", `${label} must be a PDF`);
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfBytes),
    useSystemFonts: true,
  });
  try {
    const pdf = await loadingTask.promise;
    assert.equal(pdf.numPages, expectedPages, `${label} page count changed`);
  } finally {
    await loadingTask.destroy();
  }
}

const participantDocxText = await readDocxText(participantDocxBytes, "参与者卡片 DOCX");
const cardIds = new Set(participantDocxText.match(/\b(?:I|M|O|A|H|S|R|X|W)\d{2}\b/g) || []);
assert.equal(cardIds.size, 40, "the participant deck must preserve all 40 numbered cards");
assert.equal(
  (participantDocxText.match(/备用空白卡/g) || []).length,
  4,
  "the participant deck must include four write-in reserve cards",
);
assert.match(participantDocxText, /冬日健康守护/);
assert.match(await readDocxText(hostGuideDocxBytes, "主持人指南 DOCX"), /主持人现场指南/);
await Promise.all([
  assertPdfPageCount(participantPdfBytes, 11, "参与者卡片 PDF"),
  assertPdfPageCount(hostGuidePdfBytes, 5, "主持人指南 PDF"),
]);

const constraints = JSON.parse(constraintsText);
const chineseDigits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
const chineseStationCount = chineseDigits[constraints.stations];
assert.ok(chineseStationCount, "当前演示资料的站点数需在 0 到 10 之间");

assert.equal(constraints.participants, constraints.groups * constraints.participantsPerGroup);
assert.equal(constraints.stations, constraints.groups);
assert.equal(constraints.stationNames.length, constraints.stations);
assert.equal(constraints.stationRotation.length, constraints.groups);
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
  [`每轮 ${constraints.timeBudget.stationRoundMinutes} 分钟`, gameReference],
  [`轮间留 ${constraints.timeBudget.transitionMinutes} 分钟换场`, gameReference],
  [`总计 ${constraints.durationMinutes} 分钟`, gameReference],
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
const stationEntries = [...stationSection.matchAll(/^\d+\.\s+\*\*(.+?)\*\*/gm)].map(
  (match) => match[1],
);
assert.deepEqual(stationEntries, constraints.stationNames, "游戏参考站点名必须与结构化约束一致");
const referenceTableRows = gameReference
  .split(/\r?\n/)
  .filter((line) => line.startsWith("|"))
  .map((line) =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim()),
  );

const stationOrder = Array.from({ length: constraints.stations }, (_, index) => index + 1);
for (const [groupIndex, route] of constraints.stationRotation.entries()) {
  assert.equal(route.length, constraints.stations, `第 ${groupIndex + 1} 组必须轮转全部站点`);
  assert.deepEqual(
    [...route].sort((a, b) => a - b),
    stationOrder,
  );
  const row = referenceTableRows.find((cells) => cells[0] === `第 ${groupIndex + 1} 组`);
  assert.deepEqual(
    row?.slice(1),
    route.map((stationNumber) => constraints.stationNames[stationNumber - 1]),
    `资料中的第 ${groupIndex + 1} 组轮转顺序与约束不一致`,
  );
}
for (let round = 0; round < constraints.stations; round += 1) {
  const occupiedStations = constraints.stationRotation.map((route) => route[round]);
  assert.equal(
    new Set(occupiedStations).size,
    constraints.stations,
    `第 ${round + 1} 轮必须让每个站点恰有一组参与`,
  );
}

const formatRelativeTime = (minute) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const scheduleSegments = [];
let scheduleCursor = 0;
const addScheduleSegment = (label, duration) => {
  const start = scheduleCursor;
  scheduleCursor += duration;
  scheduleSegments.push({ label, start, end: scheduleCursor, duration });
};
const timeBudget = constraints.timeBudget;
addScheduleSegment("签到、分组与任务卡", timeBudget.checkInMinutes);
addScheduleSegment("暖场与规则说明", timeBudget.briefingMinutes);
for (let round = 0; round < constraints.stations; round += 1) {
  addScheduleSegment(`第 ${round + 1} 轮站点任务`, timeBudget.stationRoundMinutes);
  if (round < constraints.stations - 1)
    addScheduleSegment(`第 ${round + 1} 次换场`, timeBudget.transitionMinutes);
}
addScheduleSegment("休息、饮水与机动缓冲", timeBudget.breakMinutes);
addScheduleSegment("收尾、反馈与清点", timeBudget.closingMinutes);
assert.equal(scheduleCursor, constraints.durationMinutes, "分段时间必须恰好合计活动总时长");
for (const segment of scheduleSegments) {
  const row = referenceTableRows.find((cells) => cells[0] === segment.label);
  assert.deepEqual(
    row?.slice(1),
    [
      `${formatRelativeTime(segment.start)}–${formatRelativeTime(segment.end)}`,
      `${segment.duration} 分钟`,
    ],
    `75 分钟表缺少或写错时间段：${segment.label}`,
  );
}

const unconfirmedSection = brief.split("## 尚未确认，不能编造")[1]?.split("## ")[0] || "";
for (const fact of constraints.unconfirmedFacts) {
  assert.ok(unconfirmedSection.includes(fact), `未确认事项必须保留在资料中：${fact}`);
}

const participantCardSection =
  healthCards.split("## 参与者卡片")[1]?.split("## 主持人答案")[0] || "";
const participantCardIds = [...participantCardSection.matchAll(/^### (H\d{2})$/gm)].map(
  (match) => match[1],
);
const hostAnswerSection =
  healthCards.split("## 主持人答案")[1]?.split("## 来源与复核记录")[0] || "";
const hostAnswerIds = [...hostAnswerSection.matchAll(/^\| (H\d{2})\s+\|/gm)].map(
  (match) => match[1],
);
assert.deepEqual(participantCardIds, ["H01", "H02", "H03", "H04", "H05", "H06"]);
assert.deepEqual(hostAnswerIds, participantCardIds, "每张参与者卡都必须有主持人答案");
assert.equal((hostAnswerSection.match(/\| 有来源支持\s+\|/g) || []).length, 3);
assert.equal((hostAnswerSection.match(/\| 说法需要修订\s+\|/g) || []).length, 3);
assert.match(healthCards, /https:\/\/www\.nhc\.gov\.cn\/xcs\/c100123\/202404\//);
assert.match(healthCards, /不用于诊断、治疗或替代专业意见/);
assert.match(healthCards, /活动现场使用前由主持人复核/);
assert.match(brief, /健康知识判断卡最终采用版本、主持人复核和复核日期仍待确认/);

const getSection = (source, start, end) => source.split(start)[1]?.split(end)[0] || "";
for (const stationName of constraints.stationNames) {
  const stationMaterial = stationName === "健康说法核验卡" ? healthCards : gameCards;
  assert.ok(stationMaterial.includes(stationName), `卡包缺少站点：${stationName}`);
}
const clothingCards = getSection(gameCards, "### 参与者卡片｜剪开使用", "### 主持人分类参考");
const clothingIds = [...clothingCards.matchAll(/^#### ((?:I|M|O|A)\d{2})｜/gm)].map(
  (match) => match[1],
);
const clothingAnswers = getSection(gameCards, "### 主持人分类参考", "## 站点 3");
const clothingAnswerIds = [...clothingAnswers.matchAll(/^\| ((?:I|M|O|A)\d{2})\s+\|/gm)].map(
  (match) => match[1],
);
assert.deepEqual(clothingIds, ["I01", "I02", "M01", "M02", "O01", "O02", "A01", "A02"]);
assert.deepEqual(clothingAnswerIds, clothingIds, "每张穿搭卡必须有主持人参考分类");

const scenarioCards = getSection(gameCards, "### 参与者情境卡｜剪开使用", "### 主持人答案");
const scenarioIds = [...scenarioCards.matchAll(/^#### (S\d{2})｜/gm)].map((match) => match[1]);
const actionIds = [...scenarioCards.matchAll(/^#### ((?:R|X)\d{2})｜/gm)].map((match) => match[1]);
assert.deepEqual(scenarioIds, ["S01", "S02", "S03", "S04", "S05", "S06"]);
assert.deepEqual(actionIds, ["R01", "R02", "R03", "R04", "R05", "R06", "X01", "X02"]);
const scenarioAnswers = getSection(gameCards, "### 主持人答案", "## 站点 4");
const scenarioMappings = [...scenarioAnswers.matchAll(/^\| (S\d{2})\s+\| (R\d{2})\s+\|/gm)].map(
  (match) => [match[1], match[2]],
);
assert.deepEqual(scenarioMappings, [
  ["S01", "R01"],
  ["S02", "R02"],
  ["S03", "R03"],
  ["S04", "R04"],
  ["S05", "R05"],
  ["S06", "R06"],
]);
assert.match(scenarioAnswers, /X01、X02/);

const wordCards = getSection(gameCards, "### 参与者主题卡｜剪开使用", "### 主持人提示");
const wordCardIds = [...wordCards.matchAll(/^#### (W\d{2})｜/gm)].map((match) => match[1]);
assert.deepEqual(
  wordCardIds,
  Array.from({ length: 12 }, (_, index) => `W${String(index + 1).padStart(2, "0")}`),
);
assert.match(gameCards, /说、写或指认/);
assert.match(gameCards, /不记录个人信息/);

const docs = [brief, gameReference, gameCards, healthCards, acceptance, videoOutline];
assert.equal(
  requiresExecutionFeasibilityCheck(docs.join("\n")),
  true,
  "the main event demo kit must trigger the execution feasibility gate",
);
assert.ok(
  docs.every((document) => !/^\s*[-*]\s*\[[xX]\]/m.test(document)),
  "演示输入和验收资料不得把规划任务写成已完成清单",
);

const demoStaff = Array.from({ length: constraints.volunteers }, (_, index) => ({
  name: `志愿者${index + 1}`,
  role:
    index < constraints.stations
      ? `第 ${index + 1} 站主持`
      : index === constraints.stations
        ? "现场统筹"
        : "机动支持",
}));
const buildDemoBlock = (venueCapacity) => ({
  date: "第 1 天",
  time: "10:00-11:15",
  activity: constraints.scenario,
  venue: "校内公共活动室（暂定）",
  attendeeCount: constraints.participants,
  unlistedOnsiteCount: 0,
  ...(venueCapacity === undefined ? {} : { venueCapacity }),
  staff: demoStaff,
  // Actual inventory is unconfirmed, so intentionally leave resources absent.
});

const unknownCapacity = validateExecutionFeasibility({ blocks: [buildDemoBlock(undefined)] });
assert.equal(unknownCapacity.valid, true, "known demo facts must have no invented conflict");
assert.equal(unknownCapacity.coverage.complete, false);
assert.deepEqual(unknownCapacity.coverage.pending[0].checks, ["场地容量", "物料清单"]);
assert.equal(unknownCapacity.checked.staffAssignments, constraints.volunteers);
assert.equal(unknownCapacity.checked.venueCapacityChecks, 0);

const exactCapacity = validateExecutionFeasibility({
  blocks: [buildDemoBlock(constraints.participants + constraints.volunteers)],
});
assert.equal(exactCapacity.valid, true, "capacity equal to attendees plus staff must pass");
assert.equal(exactCapacity.checked.venueCapacityChecks, 1);
assert.equal(exactCapacity.coverage.complete, false, "unknown inventory must remain pending");

const undersizedCapacity = validateExecutionFeasibility({
  blocks: [buildDemoBlock(constraints.participants + constraints.volunteers - 1)],
});
assert.equal(undersizedCapacity.valid, false, "volunteers must be included in venue occupancy");
assert.match(
  undersizedCapacity.issues[0]?.message || "",
  /参与者 20 人、现场支持人员 5 人，共 25 人/,
);
assert.match(brief, /不表示活动已获批准、已举办、场地已预订或联办单位已确认/);
assert.match(acceptance, /不捏造/);
assert.match(acceptance, /三条有实质区别的执行路线/);
assert.match(acceptance, /普通细节按合理默认值连续完成/);
assert.match(acceptance, /四站可直接打印的参与者卡和主持人说明/);
assert.match(videoOutline, /仓库中的预制卡包仅作人工复核样张/);

console.log(
  `✓ Demo kit is internally consistent; fixture includes ${constraints.participants} participants + ${constraints.volunteers} volunteers, ${constraints.stations} stations, and ${constraints.durationMinutes} minutes. Rotation is conflict-free; four station packs have matching card IDs and host guidance; health cards H01–H06 have cited NHC answers; print DOCX/PDF artifacts preserve 40 numbered cards, four reserve cards, and 11/5 pages; capacity boundary: ${constraints.participants + constraints.volunteers} passes, one fewer fails; unknown actual capacity/inventory and final host review remain pending.`,
);
