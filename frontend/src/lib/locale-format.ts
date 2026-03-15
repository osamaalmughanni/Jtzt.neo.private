import { getZonedDateTimeParts, normalizeTimeZone, parseLocalDay } from "@shared/utils/time";

function normalizeLocale(locale: string) {
  return locale.trim() || "en-GB";
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
  const key = formatString.trim() || "g";
  const zonedOptions = normalizeTimeZone(timeZone) ? { timeZone: normalizeTimeZone(timeZone)! } : {};

  if (key === "d") return date.toLocaleDateString(locale, zonedOptions);
  if (key === "D") return date.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric", ...zonedOptions });
  if (key === "t") return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", ...zonedOptions });
  if (key === "T") return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", ...zonedOptions });
  if (key === "g") return date.toLocaleString(locale, { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", ...zonedOptions });
  if (key === "G") return date.toLocaleString(locale, { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", ...zonedOptions });
  if (key === "f") return date.toLocaleString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", ...zonedOptions });
  if (key === "F") return date.toLocaleString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", ...zonedOptions });
  if (key === "M" || key === "m") return date.toLocaleDateString(locale, { day: "numeric", month: "long", ...zonedOptions });
  if (key === "Y" || key === "y") return date.toLocaleDateString(locale, { month: "long", year: "numeric", ...zonedOptions });
  if (key === "O" || key === "o" || key === "s" || key === "u") return date.toLocaleString(locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", ...zonedOptions });

  return formatWithPattern(date, key, locale, timeZone);
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

  return `${formatCompanyDate(startDay, locale)} to ${formatCompanyDate(endDay, locale)}`;
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
