export function normalizeTimeRange(value: unknown): string | null;
export function timeRangesOverlap(first: unknown, second: unknown): boolean;
export function normalizeScheduleDay(value: unknown): string;
export function findScheduleConflict<T extends { day: string; time: string }>(
  existing: Array<{ day: string; time: string }>,
  proposed: T[],
): T | null;
