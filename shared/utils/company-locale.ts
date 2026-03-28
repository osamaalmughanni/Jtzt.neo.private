export const DEFAULT_COMPANY_LOCALE = "de-AT";
export const DEFAULT_COMPANY_TIME_ZONE = "Europe/Vienna";
export const DEFAULT_COMPANY_DATE_TIME_FORMAT = "dd.MM.yyyy HH:mm";
export const DEFAULT_COMPANY_WEEKEND_DAYS = [6, 7] as const;

const supportedDateTimePattern = /(yyyy|yy|MMMM|MMM|MM|M|dd|d|HH|H|hh|h|mm|m|ss|s|tt)/;

export function normalizeCompanyLocale(locale: string | null | undefined) {
  if (typeof locale !== "string") {
    return DEFAULT_COMPANY_LOCALE;
  }

  const trimmed = locale.trim();
  if (!trimmed) {
    return DEFAULT_COMPANY_LOCALE;
  }

  try {
    const canonical = new Intl.Locale(trimmed).toString();
    return Intl.DateTimeFormat.supportedLocalesOf([canonical]).length > 0 ? canonical : DEFAULT_COMPANY_LOCALE;
  } catch {
    return DEFAULT_COMPANY_LOCALE;
  }
}

export function normalizeCompanyDateTimeFormat(format: string | null | undefined) {
  const normalized = typeof format === "string" ? format.trim() : "";
  if (!normalized) {
    return DEFAULT_COMPANY_DATE_TIME_FORMAT;
  }

  if (["g", "G", "f", "F", "d", "D", "t", "T", "m", "M", "y", "Y", "o", "O", "s", "u"].includes(normalized)) {
    return DEFAULT_COMPANY_DATE_TIME_FORMAT;
  }

  if (!supportedDateTimePattern.test(normalized)) {
    return DEFAULT_COMPANY_DATE_TIME_FORMAT;
  }

  return normalized;
}

export function normalizeWeekendDays(value: Array<number> | null | undefined) {
  const normalized = Array.isArray(value)
    ? [...new Set(value.map((day) => Math.trunc(Number(day))).filter((day) => day >= 1 && day <= 7))].sort((left, right) => left - right)
    : [];
  return normalized.length > 0 ? normalized : [...DEFAULT_COMPANY_WEEKEND_DAYS];
}
