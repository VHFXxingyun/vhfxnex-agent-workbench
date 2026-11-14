import { normalizeScheduleDay, normalizeTimeRange } from "./schedule-validation.mjs";

function toMinutes(value) {
  const normalized = normalizeTimeRange(value);
  if (!normalized) return null;
  const [start, end] = normalized.split("–");
  const parse = (time) => {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
  };
  return { start: parse(start), end: parse(end) };
}

function normalizeName(value) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase().replace(/\s+/g, "") : "";
}

/**
 * Check schedule constraints that can be verified from explicitly supplied facts.
 * This does not infer missing staffing, venue, attendance, or inventory data.
 * @param {{ blocks: Array<Record<string, unknown>> }} input
 */
export function validateExecutionFeasibility(input) {
  const blocks = Array.isArray(input?.blocks) ? input.blocks : [];
  const issues = [];
  const pendingByBlock = [];
  const parsedBlocks = blocks.map((block, index) => {
    const time = toMinutes(block?.time);
    const date = typeof block?.date === "string" ? block.date.trim() : "";
    const activity = typeof block?.activity === "string" ? block.activity.trim() : "";
    if (!date || !activity || !time) {
      issues.push({
        type: "invalid_block",
        blocks: [index + 1],
        message: `第 ${index + 1} 项缺少有效日期、时段或活动名称。`,
      });
    }
    return {
      index,
      day: normalizeScheduleDay(date),
      start: time?.start ?? 0,
      end: time?.end ?? 0,
      valid: Boolean(date && activity && time),
      block,
    };
  });

  for (const current of parsedBlocks) {
    if (!current.valid) {
      const activity =
        typeof current.block?.activity === "string" && current.block.activity.trim()
          ? current.block.activity.trim()
          : `第 ${current.index + 1} 项活动`;
      pendingByBlock.push({
        block: current.index + 1,
        activity,
        checks: ["有效日期、时段或活动名称"],
      });
      continue;
    }
    const block = current.block;
    const missing = [];
    if (!normalizeName(block.venue)) missing.push("场地名称");
    if (typeof block.attendeeCount !== "number") missing.push("参与者人数");
    if (typeof block.unlistedOnsiteCount !== "number") missing.push("其他现场人员人数");
    if (typeof block.venueCapacity !== "number") missing.push("场地容量");
    if (!Array.isArray(block.staff)) missing.push("岗位名单");
    if (!Array.isArray(block.resources)) missing.push("物料清单");
    if (missing.length) {
      pendingByBlock.push({
        block: current.index + 1,
        activity: block.activity,
        checks: missing,
      });
    }
    const attendance = block.attendeeCount;
    const assignedStaffCount = new Set(
      (Array.isArray(block.staff) ? block.staff : [])
        .map((assignment) => normalizeName(assignment?.name))
        .filter(Boolean),
    ).size;
    const unlistedOnsiteCount =
      typeof block.unlistedOnsiteCount === "number" ? block.unlistedOnsiteCount : 0;
    const capacity = block.venueCapacity;
    const totalOccupancy =
      typeof attendance === "number" ? attendance + assignedStaffCount + unlistedOnsiteCount : null;
    if (totalOccupancy !== null && typeof capacity === "number" && totalOccupancy > capacity) {
      const onsiteSupport = assignedStaffCount + unlistedOnsiteCount;
      issues.push({
        type: "venue_capacity",
        blocks: [current.index + 1],
        message: `「${block.activity}」预计参与者 ${attendance} 人、现场支持人员 ${onsiteSupport} 人，共 ${totalOccupancy} 人，超过场地容量 ${capacity} 人。`,
      });
    }

    const assigned = new Map();
    for (const assignment of Array.isArray(block.staff) ? block.staff : []) {
      const key = normalizeName(assignment?.name);
      if (!key) continue;
      if (assigned.has(key)) {
        issues.push({
          type: "duplicate_role",
          blocks: [current.index + 1],
          message: `${assignment.name} 在「${block.activity}」被安排了多个岗位。`,
        });
      } else {
        assigned.set(key, assignment.role);
      }
    }
  }

  for (let firstIndex = 0; firstIndex < parsedBlocks.length; firstIndex += 1) {
    const first = parsedBlocks[firstIndex];
    if (!first.valid) continue;
    for (let secondIndex = firstIndex + 1; secondIndex < parsedBlocks.length; secondIndex += 1) {
      const second = parsedBlocks[secondIndex];
      if (
        !second.valid ||
        first.day !== second.day ||
        first.start >= second.end ||
        second.start >= first.end
      ) {
        continue;
      }

      const firstStaff = new Map(
        (Array.isArray(first.block.staff) ? first.block.staff : []).map((item) => [
          normalizeName(item?.name),
          item?.name,
        ]),
      );
      for (const assignment of Array.isArray(second.block.staff) ? second.block.staff : []) {
        const key = normalizeName(assignment?.name);
        if (key && firstStaff.has(key)) {
          issues.push({
            type: "staff_overlap",
            blocks: [first.index + 1, second.index + 1],
            message: `${firstStaff.get(key)} 同时被安排到「${first.block.activity}」和「${second.block.activity}」。`,
          });
        }
      }

      const firstVenue = normalizeName(first.block.venue);
      const secondVenue = normalizeName(second.block.venue);
      if (firstVenue && firstVenue === secondVenue) {
        issues.push({
          type: "venue_overlap",
          blocks: [first.index + 1, second.index + 1],
          message: `「${first.block.activity}」与「${second.block.activity}」同时占用场地「${first.block.venue}」。`,
        });
      }
    }
  }

  const inventory = new Map();
  for (const item of parsedBlocks) {
    if (!item.valid) continue;
    for (const resource of Array.isArray(item.block.resources) ? item.block.resources : []) {
      const name = typeof resource?.name === "string" ? resource.name.trim() : "";
      if (!name) continue;
      const key = `${item.day}\u0000${normalizeName(name)}`;
      if (!inventory.has(key)) inventory.set(key, []);
      inventory.get(key).push({
        index: item.index,
        activity: item.block.activity,
        start: item.start,
        end: item.end,
        required: resource.required,
        available: resource.available,
        name,
      });
    }
  }

  for (const entries of inventory.values()) {
    const boundaries = [...new Set(entries.flatMap((entry) => [entry.start, entry.end]))].sort(
      (a, b) => a - b,
    );
    for (let boundaryIndex = 0; boundaryIndex < boundaries.length - 1; boundaryIndex += 1) {
      const start = boundaries[boundaryIndex];
      const concurrent = entries.filter((entry) => entry.start <= start && entry.end > start);
      if (concurrent.length < 1) continue;
      const required = concurrent.reduce((total, entry) => total + entry.required, 0);
      const available = Math.min(...concurrent.map((entry) => entry.available));
      if (required > available) {
        issues.push({
          type: "resource_capacity",
          blocks: concurrent.map((entry) => entry.index + 1),
          message: `并行安排的「${concurrent[0].name}」需要 ${required} 件，可用量只有 ${available} 件。`,
        });
      }
    }
  }

  const uniqueIssues = [
    ...new Map(
      issues.map((issue) => [`${issue.type}|${issue.blocks.join(",")}|${issue.message}`, issue]),
    ).values(),
  ];
  const checked = {
    timeSlots: parsedBlocks.filter((block) => block.valid).length,
    staffAssignments: parsedBlocks.reduce(
      (total, item) =>
        total + (item.valid && Array.isArray(item.block?.staff) ? item.block.staff.length : 0),
      0,
    ),
    venueCapacityChecks: parsedBlocks.filter(
      ({ block, valid }) =>
        valid &&
        typeof block?.attendeeCount === "number" &&
        typeof block?.unlistedOnsiteCount === "number" &&
        typeof block?.venueCapacity === "number" &&
        Array.isArray(block?.staff),
    ).length,
    resourceEntries: parsedBlocks.reduce(
      (total, item) =>
        total +
        (item.valid && Array.isArray(item.block?.resources) ? item.block.resources.length : 0),
      0,
    ),
  };
  const coverageComplete = pendingByBlock.length === 0;
  const pendingCheckCount = pendingByBlock.reduce((total, item) => total + item.checks.length, 0);
  const summary = uniqueIssues.length
    ? `检查了 ${checked.timeSlots}/${blocks.length} 个有效时段，发现 ${uniqueIssues.length} 项需要处理的冲突；${coverageComplete ? "所需数据完整" : `另有 ${pendingCheckCount} 项数据待确认，尚未完成完整核验`}。`
    : coverageComplete
      ? `完整检查了 ${checked.timeSlots} 个时段，未发现人员、场地容量和物资数据中的冲突。`
      : `检查了 ${checked.timeSlots} 个时段，已提供数据未发现冲突；另有 ${pendingCheckCount} 项数据待确认，尚未完成完整核验。`;

  return {
    valid: uniqueIssues.length === 0,
    summary,
    checked,
    coverage: { complete: coverageComplete, pending: pendingByBlock },
    issues: uniqueIssues,
  };
}
