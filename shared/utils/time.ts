import { Temporal } from "@js-temporal/polyfill";

const LOCAL_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_TIME_PATTERN = /^\d{2}:\d{2}$/;

function resolveSystemTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function resolveTimeZoneId(timeZone?: string | null) {
  return normalizeTimeZone(timeZone) ?? resolveSystemTimeZone();
}

function parsePlainDate(value: string) {
  if (!value) return null;

  if (LOCAL_DAY_PATTERN.test(value)) {
    try {
      return Temporal.PlainDate.from(value);
    } catch {
      return null;
    }
  }

  const instant = parseInstant(value);
  if (!instant) {
    return null;
  }

  try {
    const zoned = instant.toZonedDateTimeISO(resolveSystemTimeZone());
    return zoned.toPlainDate();
  } catch {
    return null;
  }
}

function parseInstant(value: string) {
  try {
    return Temporal.Instant.from(value);
  } catch {
    return null;
  }
}

export function diffMinutes(startIso: string, endIso: string | null): number {
  const startInstant = parseInstant(startIso);
  const endInstant = endIso ? parseInstant(endIso) : Temporal.Now.instant();
  if (!startInstant || !endInstant) {
    return 0;
  }

  const diff = endInstant.epochMilliseconds - startInstant.epochMilliseconds;
  if (diff <= 0) {
    return 0;
  }

  return Math.ceil(diff / 60000);
}

export function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

export function formatLocalDay(date: Date): string {
  return Temporal.PlainDate.from({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  }).toString();
}

export function isValidLocalDay(value: string): boolean {
  return LOCAL_DAY_PATTERN.test(value) && parseLocalDay(value) !== null;
}

export function isValidClockTime(value: string): boolean {
  if (!CLOCK_TIME_PATTERN.test(value)) {
    return false;
  }

  const [hours, minutes] = value.split(":").map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

export function diffClockTimeMinutes(startTime: string, endTime: string): number | null {
  if (!isValidClockTime(startTime) || !isValidClockTime(endTime)) {
    return null;
  }

  const [startHours, startMinutes] = startTime.split(":").map(Number);
  const [endHours, endMinutes] = endTime.split(":").map(Number);
  const startTotal = startHours * 60 + startMinutes;
  const endTotal = endHours * 60 + endMinutes;
  if (endTotal <= startTotal) {
    return null;
  }

  return endTotal - startTotal;
}

export function normalizeTimeZone(value?: string | null) {
  const candidate = value?.trim();
  if (!candidate) {
    return null;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return null;
  }
}

export function formatDayInTimeZone(date: Date, timeZone?: string | null) {
  const instant = Temporal.Instant.from(date.toISOString());
  return instant.toZonedDateTimeISO(resolveTimeZoneId(timeZone)).toPlainDate().toString();
}

export function getZonedDateTimeParts(date: Date, timeZone?: string | null) {
  const parts = Temporal.Instant.from(date.toISOString()).toZonedDateTimeISO(resolveTimeZoneId(timeZone));
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hours: parts.hour,
    minutes: parts.minute,
    seconds: parts.second,
  };
}

export function getLocalNowSnapshot(date = new Date(), timeZone?: string | null) {
  const normalizedTimeZone = normalizeTimeZone(timeZone);
  const zoneId = resolveTimeZoneId(normalizedTimeZone);
  const zonedNow = Temporal.Instant.from(date.toISOString()).toZonedDateTimeISO(zoneId);
  return {
    instantIso: zonedNow.toInstant().toString(),
    localDay: zonedNow.toPlainDate().toString(),
    timeZone: normalizedTimeZone,
  };
}

export function parseLocalDay(value: string): Date | null {
  const parsed = parsePlainDate(value);
  return parsed ? new Date(parsed.year, parsed.month - 1, parsed.day) : null;
}

export function combineLocalDayAndTimeToIsoInTimeZone(day: string, timeValue: string, timeZone?: string | null): string | null {
  if (!isValidLocalDay(day) || !isValidClockTime(timeValue)) {
    return null;
  }

  const parsedDay = parsePlainDate(day);
  if (!parsedDay) {
    return null;
  }

  const [hours, minutes] = timeValue.split(":").map(Number);
  const zoneId = resolveTimeZoneId(timeZone);
  try {
    const zonedDateTime = Temporal.ZonedDateTime.from(
      {
        timeZone: zoneId,
        year: parsedDay.year,
        month: parsedDay.month,
        day: parsedDay.day,
        hour: hours,
        minute: minutes,
        second: 0,
        millisecond: 0,
      },
      { disambiguation: "reject" },
    );
    return zonedDateTime.toInstant().toString();
  } catch {
    return null;
  }
}

export function toClockTimeValue(isoValue: string | null, timeZone?: string | null): string {
  if (!isoValue) {
    return "";
  }

  const instant = parseInstant(isoValue);
  if (!instant) {
    return "";
  }

  const parts = instant.toZonedDateTimeISO(resolveTimeZoneId(timeZone));
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function diffCalendarDays(leftDay: string, rightDay: string): number {
  const left = parsePlainDate(leftDay);
  const right = parsePlainDate(rightDay);
  if (!left || !right) {
    return 0;
  }

  return left.since(right, { largestUnit: "day" }).days;
}

export function enumerateLocalDays(startDay: string, endDay: string): string[] {
  const start = parsePlainDate(startDay);
  const end = parsePlainDate(endDay);
  if (!start || !end || Temporal.PlainDate.compare(end, start) < 0) {
    return [];
  }

  const days: string[] = [];
  let cursor = start;
  while (Temporal.PlainDate.compare(cursor, end) <= 0) {
    days.push(cursor.toString());
    cursor = cursor.add({ days: 1 });
  }

  return days;
}

export function isWeekendDay(day: string): boolean {
  const parsed = parsePlainDate(day);
  if (!parsed) return false;
  return parsed.dayOfWeek === 6 || parsed.dayOfWeek === 7;
}

export function getIsoDayOfWeek(day: string): number | null {
  const parsed = parsePlainDate(day);
  return parsed ? parsed.dayOfWeek : null;
}

export function countEffectiveLeaveDays(startDay: string, endDay: string, holidayDays: Set<string>): {
  totalDayCount: number;
  effectiveDayCount: number;
  excludedHolidayCount: number;
  excludedWeekendCount: number;
} {
  const days = enumerateLocalDays(startDay, endDay);
  let effectiveDayCount = 0;
  let excludedHolidayCount = 0;
  let excludedWeekendCount = 0;

  for (const day of days) {
    const weekend = isWeekendDay(day);
    const holiday = holidayDays.has(day);

    if (holiday) {
      excludedHolidayCount += 1;
    } else if (weekend) {
      excludedWeekendCount += 1;
    }

    if (!weekend && !holiday) {
      effectiveDayCount += 1;
    }
  }

  return {
    totalDayCount: days.length,
    effectiveDayCount,
    excludedHolidayCount,
    excludedWeekendCount,
  };
}
