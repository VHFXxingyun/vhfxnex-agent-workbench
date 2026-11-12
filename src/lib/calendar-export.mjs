import { normalizeTimeRange } from "./schedule-validation.mjs";

const DAY_MS = 86_400_000;
const CHINA_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const TIME_RANGE_PATTERN = /\d{1,2}:\d{2}\s*[-–—~～至]\s*\d{1,2}:\d{2}/;
const chineseDigits = new Map([
  ["一", 1],
  ["二", 2],
  ["三", 3],
  ["四", 4],
  ["五", 5],
  ["六", 6],
  ["七", 7],
  ["八", 8],
  ["九", 9],
]);

function chineseInteger(value) {
  if (value === "十") return 10;
  if (value.startsWith("十")) return 10 + (chineseDigits.get(value.slice(1)) || 0);
  const tenIndex = value.indexOf("十");
  if (tenIndex > 0) {
    return (
      (chineseDigits.get(value.slice(0, tenIndex)) || 0) * 10 +
      (chineseDigits.get(value.slice(tenIndex + 1)) || 0)
    );
  }
  return chineseDigits.get(value) || null;
}

function isValidDate(value) {
  const match = typeof value === "string" && value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function parseDateLabel(value) {
  const label = value.trim();
  const iso = label.match(/^(\d{4}-\d{2}-\d{2})(?:\b|$)/);
  if (iso) return isValidDate(iso[1]) ? { date: iso[1] } : { issue: "invalid-date" };

  const chineseDate = label.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (chineseDate) {
    const date =
      chineseDate[1] +
      "-" +
      chineseDate[2].padStart(2, "0") +
      "-" +
      chineseDate[3].padStart(2, "0");
    return isValidDate(date) ? { date } : { issue: "invalid-date" };
  }

  const ordinal = label.match(/^第\s*(\d+|[一二三四五六七八九十]+)\s*[天日]/);
  if (ordinal) {
    const day = /^\d+$/.test(ordinal[1]) ? Number(ordinal[1]) : chineseInteger(ordinal[1]);
    return day >= 1 && day <= 366 ? { dayOffset: day - 1 } : { issue: "invalid-date" };
  }

  const englishOrdinal = label.match(/^day\s*(\d+)/i);
  if (englishOrdinal) {
    const day = Number(englishOrdinal[1]);
    return day >= 1 && day <= 366 ? { dayOffset: day - 1 } : { issue: "invalid-date" };
  }

  if (/^(?:活动当天|活动当日|活动日|当天|当日|今天|今日)/.test(label)) return { dayOffset: 0 };
  if (/^明天/.test(label)) return { dayOffset: 1 };
  if (/^后天/.test(label)) return { dayOffset: 2 };
  return { issue: "unsupported-date" };
}

function parseMilestone(milestone) {
  const value = typeof milestone?.date === "string" ? milestone.date : "";
  const match = TIME_RANGE_PATTERN.exec(value);
  if (!match) return null;
  const dateLabel = value
    .slice(0, match.index)
    .replace(/[\s·T]+$/u, "")
    .trim();
  const timeRange = normalizeTimeRange(match[0]);
  if (!timeRange) return { issue: "invalid-time", dateLabel };
  const date = parseDateLabel(dateLabel);
  if (date.issue) return { issue: date.issue, dateLabel };
  return {
    date: date.date,
    dayOffset: date.dayOffset,
    dateLabel,
    timeRange,
    milestone,
  };
}

function formatDateTimeUtc(date, time) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day, hour, minute) - CHINA_UTC_OFFSET_MS);
  return utc
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.000Z$/, "Z");
}

function escapeText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function foldLine(line) {
  const encoder = new TextEncoder();
  const chunks = [];
  let current = "";
  let octets = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (octets + size > 75 && current) {
      chunks.push(current);
      current = character;
      octets = 1 + size;
    } else {
      current += character;
      octets += size;
    }
  }
  chunks.push(current);
  return chunks.join("\r\n ");
}

export function inspectCalendarSchedule(milestones) {
  const parsed = (Array.isArray(milestones) ? milestones : []).map(parseMilestone).filter(Boolean);
  const issues = parsed.filter((item) => item.issue);
  return {
    eventCount: parsed.length,
    requiresAnchor: parsed.some((item) => item.dayOffset !== undefined),
    issues: issues.map(({ issue, dateLabel }) => ({ issue, dateLabel })),
  };
}

export function createCalendarExport(milestones, anchorDate = "", now = new Date()) {
  const info = inspectCalendarSchedule(milestones);
  if (info.eventCount === 0) {
    return { ok: false, code: "no-events", message: "时间线上没有可导出的具体时段。" };
  }
  if (info.issues.length) {
    const issue = info.issues[0];
    if (issue.issue === "invalid-time") {
      return {
        ok: false,
        code: "invalid-time",
        message: "“" + issue.dateLabel + "”包含无效的 24 小时时段，请先修正时间范围。",
      };
    }
    if (issue.issue === "invalid-date") {
      return {
        ok: false,
        code: "invalid-date",
        message: "“" + issue.dateLabel + "”不是有效日期，请先修正日程日期。",
      };
    }
    return {
      ok: false,
      code: "unsupported-date",
      message: "无法确定“" + issue.dateLabel + "”对应的日期；请使用具体日期或“第 1 天”等格式。",
    };
  }
  if (info.requiresAnchor && !isValidDate(anchorDate)) {
    return {
      ok: false,
      code: "anchor-required",
      message: "这些时段使用相对日期，请先选择活动或行程的开始日期。",
    };
  }

  const events = [];
  for (const [index, item] of milestones.map(parseMilestone).entries()) {
    if (!item) continue;
    let date = item.date;
    if (item.dayOffset !== undefined) {
      const [year, month, day] = anchorDate.split("-").map(Number);
      const anchored = new Date(Date.UTC(year, month - 1, day) + item.dayOffset * DAY_MS);
      date =
        String(anchored.getUTCFullYear()).padStart(4, "0") +
        "-" +
        String(anchored.getUTCMonth() + 1).padStart(2, "0") +
        "-" +
        String(anchored.getUTCDate()).padStart(2, "0");
      if (!isValidDate(date)) {
        return {
          ok: false,
          code: "invalid-date",
          message: "相对日期超出可处理范围，请选择更早的开始日期。",
        };
      }
    }
    const [startTime, endTime] = item.timeRange.split("–");
    const note = typeof item.milestone.note === "string" ? item.milestone.note.trim() : "";
    const location = note.match(/(?:^|[；;\n])\s*(?:地点|位置)[:：]\s*([^；;\n]+)/)?.[1]?.trim();
    events.push({
      uid: globalThis.crypto.randomUUID() + "@vhfxnex.local",
      summary: escapeText(item.milestone.label || "日程 " + (index + 1)),
      description: escapeText(note),
      location: location ? escapeText(location) : "",
      start: formatDateTimeUtc(date, startTime),
      end: formatDateTimeUtc(date, endTime),
    });
  }

  const timestamp = (now instanceof Date ? now : new Date(now))
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//VHFXNEX//Goalflow Calendar Export//ZH-CN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...events.flatMap((event) => [
      "BEGIN:VEVENT",
      "UID:" + event.uid,
      "DTSTAMP:" + timestamp,
      "DTSTART:" + event.start,
      "DTEND:" + event.end,
      "SUMMARY:" + event.summary,
      ...(event.description ? ["DESCRIPTION:" + event.description] : []),
      ...(event.location ? ["LOCATION:" + event.location] : []),
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ];
  return {
    ok: true,
    content: lines.map(foldLine).join("\r\n") + "\r\n",
    eventCount: events.length,
  };
}
