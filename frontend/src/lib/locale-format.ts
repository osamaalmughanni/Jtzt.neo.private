import { getZonedDateTimeParts, normalizeTimeZone, parseLocalDay } from "@shared/utils/time";
import {
  DEFAULT_COMPANY_DATE_TIME_FORMAT,
  DEFAULT_COMPANY_LOCALE,
  normalizeCompanyDateTimeFormat,
  normalizeCompanyLocale,
} from "@shared/utils/company-locale";

function normalizeLocale(locale: string) {
  return normalizeCompanyLocale(locale);
}

function parseDateTimeValue(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return parseLocalDay(value);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function formatWithPattern(date: Date, pattern: string, locale: string, timeZone?: string | null) {
  const normalized = pattern.trim();
  const parts = getZonedDateTimeParts(date, timeZone);
  const tokenMap: Record<string, string> = {
    yyyy: String(parts.year).padStart(4, "0"),
    yy: String(parts.year % 100).padStart(2, "0"),
    MMMM: new Intl.DateTimeFormat(locale, { month: "long", ...(normalizeTimeZone(timeZone) ? { timeZone: normalizeTimeZone(timeZone)! } : {}) }).format(date),
    MMM: new Intl.DateTimeFormat(locale, { month: "short", ...(normalizeTimeZone(timeZone) ? { timeZone: normalizeTimeZone(timeZone)! } : {}) }).format(date),
    MM: String(parts.month).padStart(2, "0"),
    M: String(parts.month),
    dd: String(parts.day).padStart(2, "0"),
    d: String(parts.day),
    HH: String(parts.hours).padStart(2, "0"),
    H: String(parts.hours),
    hh: String(((parts.hours % 12) || 12)).padStart(2, "0"),
    h: String((parts.hours % 12) || 12),
    mm: String(parts.minutes).padStart(2, "0"),
    m: String(parts.minutes),
    ss: String(parts.seconds).padStart(2, "0"),
    s: String(parts.seconds),
    tt: parts.hours >= 12 ? "PM" : "AM",
  };

  const tokens = Object.keys(tokenMap).sort((a, b) => b.length - a.length);
  let output = normalized;
  for (const token of tokens) {
    output = output.replaceAll(token, tokenMap[token]);
  }
  return output;
}

function formatStandard(date: Date, locale: string, formatString: string, timeZone?: string | null) {
  const pattern = normalizeCompanyDateTimeFormat(formatString) || DEFAULT_COMPANY_DATE_TIME_FORMAT;
  try {
    return formatWithPattern(date, pattern, locale, timeZone);
  } catch {
    return formatWithPattern(date, DEFAULT_COMPANY_DATE_TIME_FORMAT, DEFAULT_COMPANY_LOCALE, timeZone);
  }
}

export function formatCompanyDate(day: string, locale: string, options?: Intl.DateTimeFormatOptions) {
  const parsed = parseLocalDay(day);
  if (!parsed) {
    return day;
  }

  try {
    return parsed.toLocaleDateString(
      normalizeLocale(locale),
      options ?? {
        day: "numeric",
        month: "short",
        year: "numeric",
      },
    );
  } catch {
    return day;
  }
}

export function formatCompanyDateParts(day: string, locale: string) {
  const parsed = parseLocalDay(day);
  if (!parsed) {
    return {
      dateLabel: day,
      weekdayLabel: "",
    };
  }

  try {
    const normalizedLocale = normalizeLocale(locale);
    return {
      dateLabel: parsed.toLocaleDateString(normalizedLocale, {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
      weekdayLabel: parsed.toLocaleDateString(normalizedLocale, {
        weekday: "long",
      }),
    };
  } catch {
    return {
      dateLabel: day,
      weekdayLabel: "",
    };
  }
}

export function formatCompanyDateTime(value: string, locale: string, formatString: string, timeZone?: string | null) {
  const parsed = parseDateTimeValue(value);
  if (!parsed) {
    return value;
  }

  try {
    return formatStandard(parsed, normalizeLocale(locale), formatString, timeZone);
  } catch {
    return value;
  }
}

export function formatCompanyDateRange(startDay: string, endDay: string | null, locale: string) {
  if (!endDay || startDay === endDay) {
    return formatCompanyDate(startDay, locale);
  }

  const start = parseLocalDay(startDay);
  const end = parseLocalDay(endDay);
  if (!start || !end) {
    return `${formatCompanyDate(startDay, locale)} – ${formatCompanyDate(endDay, locale)}`;
  }

  try {
    return new Intl.DateTimeFormat(normalizeLocale(locale), {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).formatRange(start, end);
  } catch {
    return `${formatCompanyDate(startDay, locale)} – ${formatCompanyDate(endDay, locale)}`;
  }
}

export function formatCompanyMonthYear(date: Date, locale: string) {
  try {
    return date.toLocaleDateString(normalizeLocale(locale), {
      month: "long",
      year: "numeric",
    });
  } catch {
    return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
}
