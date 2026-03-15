import { parseLocalDay } from "@shared/utils/time";

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

function formatWithPattern(date: Date, pattern: string, locale: string) {
  const normalized = pattern.trim();
  const tokenMap: Record<string, string> = {
    yyyy: String(date.getFullYear()).padStart(4, "0"),
    yy: String(date.getFullYear() % 100).padStart(2, "0"),
    MMMM: new Intl.DateTimeFormat(locale, { month: "long" }).format(date),
    MMM: new Intl.DateTimeFormat(locale, { month: "short" }).format(date),
    MM: String(date.getMonth() + 1).padStart(2, "0"),
    M: String(date.getMonth() + 1),
    dd: String(date.getDate()).padStart(2, "0"),
    d: String(date.getDate()),
    HH: String(date.getHours()).padStart(2, "0"),
    H: String(date.getHours()),
    hh: String(((date.getHours() % 12) || 12)).padStart(2, "0"),
    h: String((date.getHours() % 12) || 12),
    mm: String(date.getMinutes()).padStart(2, "0"),
    m: String(date.getMinutes()),
    ss: String(date.getSeconds()).padStart(2, "0"),
    s: String(date.getSeconds()),
    tt: date.getHours() >= 12 ? "PM" : "AM",
  };

  const tokens = Object.keys(tokenMap).sort((a, b) => b.length - a.length);
  let output = normalized;
  for (const token of tokens) {
    output = output.replaceAll(token, tokenMap[token]);
  }
  return output;
}

function formatStandard(date: Date, locale: string, formatString: string) {
  const key = formatString.trim() || "g";

  if (key === "d") return date.toLocaleDateString(locale);
  if (key === "D") return date.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  if (key === "t") return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (key === "T") return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  if (key === "g") return date.toLocaleString(locale, { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
  if (key === "G") return date.toLocaleString(locale, { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  if (key === "f") return date.toLocaleString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  if (key === "F") return date.toLocaleString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  if (key === "M" || key === "m") return date.toLocaleDateString(locale, { day: "numeric", month: "long" });
  if (key === "Y" || key === "y") return date.toLocaleDateString(locale, { month: "long", year: "numeric" });
  if (key === "O" || key === "o" || key === "s" || key === "u") return date.toLocaleString(locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return formatWithPattern(date, key, locale);
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

export function formatCompanyDateTime(value: string, locale: string, formatString: string) {
  const parsed = parseDateTimeValue(value);
  if (!parsed) {
    return value;
  }

  try {
    return formatStandard(parsed, normalizeLocale(locale), formatString);
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
