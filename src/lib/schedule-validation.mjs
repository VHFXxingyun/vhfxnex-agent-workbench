function parseTimeRange(value) {
  if (typeof value !== "string") return null;
  const match = value
    .trim()
    .match(/^([01]?\d|2[0-3]):([0-5]\d)\s*[-–—~～至]\s*([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  const start = Number(match[1]) * 60 + Number(match[2]);
  const end = Number(match[3]) * 60 + Number(match[4]);
  if (end <= start) return null;
  const format = (hours, minutes) => `${hours.padStart(2, "0")}:${minutes}`;
  return {
    start,
    end,
    normalized: `${format(match[1], match[2])}–${format(match[3], match[4])}`,
  };
}

export function normalizeTimeRange(value) {
  return parseTimeRange(value)?.normalized || null;
}

export function timeRangesOverlap(first, second) {
  const firstRange = parseTimeRange(first);
  const secondRange = parseTimeRange(second);
  if (!firstRange || !secondRange) return false;
  return firstRange.start < secondRange.end && secondRange.start < firstRange.end;
}

export function normalizeScheduleDay(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLocaleLowerCase().replace(/\s+/g, "");
  const absolute = normalized.match(/\d{4}-\d{2}-\d{2}/);
  if (absolute) return absolute[0];
  const relative = normalized.match(/第?(\d+)天|day(\d+)/i);
  if (relative) return `day:${Number(relative[1] || relative[2])}`;
  if (normalized.includes("活动当天")) return "event-day";
  return normalized;
}

export function findScheduleConflict(existing, proposed) {
  const accepted = [];
  for (const candidate of proposed) {
    const conflict = [...existing, ...accepted].find(
      (previous) =>
        normalizeScheduleDay(previous.day) === normalizeScheduleDay(candidate.day) &&
        timeRangesOverlap(previous.time, candidate.time),
    );
    if (conflict) return candidate;
    accepted.push(candidate);
  }
  return null;
}
