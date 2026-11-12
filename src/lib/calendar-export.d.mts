export type CalendarExportInspection = {
  eventCount: number;
  requiresAnchor: boolean;
  issues: { issue: string; dateLabel: string }[];
};

export type CalendarExportResult =
  | { ok: true; content: string; eventCount: number }
  | {
      ok: false;
      code: "no-events" | "invalid-time" | "invalid-date" | "unsupported-date" | "anchor-required";
      message: string;
    };

export declare function inspectCalendarSchedule(milestones: unknown): CalendarExportInspection;
export declare function createCalendarExport(
  milestones: unknown,
  anchorDate?: string,
  now?: Date | string | number,
): CalendarExportResult;
