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

/** How much of the time between two moments falls within working hours. */
export function workingMsBetween(start: Date, end: Date) {
  let total = 0;
  for (let day = startOfVietnamDay(start).getTime(); day < end.getTime(); day += DAY_MS) {
    const open = day + WORK_START_HOUR * 60 * 60 * 1000;
    const close = day + WORK_END_HOUR * 60 * 60 * 1000;
    total += Math.max(0, Math.min(close, end.getTime()) - Math.max(open, start.getTime()));
  }
  return total;
}

/** The Vietnam calendar date, such as 2026-11-06. */
export function vietnamDayKey(now: Date) {
  return new Date(now.getTime() + VIETNAM_OFFSET_MS).toISOString().slice(0, 10);
}
