import { parseLocalDay } from "@shared/utils/time";

function normalizeLocale(locale: string) {
  return locale.trim() || "en-GB";
}

export function formatCompanyDate(
  day: string,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
) {
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

export function formatCompanyDateRange(
  startDay: string,
  endDay: string | null,
  locale: string,
) {
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
