const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The moment the current day began in Vietnam, which has no daylight saving. */
export function startOfVietnamDay(now: Date) {
  const local = now.getTime() + VIETNAM_OFFSET_MS;
  return new Date(local - (local % DAY_MS) - VIETNAM_OFFSET_MS);
}

export function nextVietnamMidnight(now: Date) {
  return new Date(startOfVietnamDay(now).getTime() + DAY_MS);
}

export const WORK_START_HOUR = 9;
export const WORK_END_HOUR = 17;

/** Hours apply every day of the week, and only limit sending, not taking a task. */
export function isWorkingHours(now: Date) {
  const hour = new Date(now.getTime() + VIETNAM_OFFSET_MS).getUTCHours();
  return hour >= WORK_START_HOUR && hour < WORK_END_HOUR;
}

/** The Vietnam calendar date, such as 2026-11-06. */
export function vietnamDayKey(now: Date) {
  return new Date(now.getTime() + VIETNAM_OFFSET_MS).toISOString().slice(0, 10);
}
