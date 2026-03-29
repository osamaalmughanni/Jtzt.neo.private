import { HTTPException } from "hono/http-exception";
import { and, eq } from "drizzle-orm";
import type { UpdateOvertimeSettingsInput, UpdateSettingsInput } from "../../shared/types/api";
import type { PublicHolidayRecord, TimeEntryType } from "../../shared/types/models";
import {
  DEFAULT_COMPANY_DATE_TIME_FORMAT,
  DEFAULT_COMPANY_LOCALE,
  DEFAULT_COMPANY_TIME_ZONE,
  DEFAULT_COMPANY_WEEKEND_DAYS,
  normalizeCompanyDateTimeFormat,
  normalizeCompanyLocale,
  normalizeWeekendDays,
} from "../../shared/utils/company-locale";
import { getLocalNowSnapshot, normalizeTimeZone } from "../../shared/utils/time";
import { createDefaultOvertimeSettings, normalizeOvertimeSettings } from "../../shared/utils/overtime";
import { normalizeCustomFields, sanitizeCustomFieldValuesForTarget } from "../../shared/utils/custom-fields";
import { companySettings, projects, publicHolidayCache, tasks, timeEntries, users } from "../db/schema";
import { mapCompanySettings } from "../db/mappers";
import type { AppDatabase } from "../runtime/types";

const HOLIDAY_CACHE_MAX_AGE_DAYS = 30;
const CURRENT_YEAR_CACHE_MAX_AGE_DAYS = 7;
const HOLIDAY_FETCH_TIMEOUT_MS = 10_000;
const HOLIDAY_SOURCE_COOLDOWN_MS = 10 * 60 * 1000;
const OPEN_HOLIDAYS_SUPPORTED_COUNTRIES = new Set([
  "AL",
  "AD",
  "AT",
  "BY",
  "BE",
  "BR",
  "BG",
  "HR",
  "CZ",
  "EE",
  "FR",
  "DE",
  "HU",
  "IE",
  "IT",
  "LV",
  "LI",
  "LT",
  "LU",
  "MT",
  "MX",
  "MD",
  "MC",
  "NL",
  "PL",
  "PT",
  "RO",
  "SM",
  "RS",
  "SK",
  "SI",
  "ZA",
  "ES",
  "SE",
  "CH",
  "VA",
]);
type HolidaySourceId = "nager" | "openholidays";
type CustomFieldValue = string | number | boolean;
type CustomFieldValues = Record<string, CustomFieldValue>;
const holidaySourceCooldowns = new Map<HolidaySourceId, number>();

function parseCustomFieldValuesJson(value: string | null | undefined): CustomFieldValues {
  if (typeof value !== "string" || value.length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const next: CustomFieldValues = {};
    for (const [key, rawValue] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof rawValue === "string" || typeof rawValue === "number" || typeof rawValue === "boolean") {
        next[key] = rawValue;
      }
    }

    return next;
  } catch {
    return {};
  }
}

function stringifyCustomFieldValues(values: CustomFieldValues) {
  return JSON.stringify(values);
}

async function cleanupCustomFieldValuesForTable(
  db: AppDatabase,
  table: "users" | "projects" | "tasks" | "time_entries",
  customFields: UpdateSettingsInput["customFields"],
  target: { scope: "user" | "project" | "task" | "time_entry"; entryType?: TimeEntryType },
) {
  if (table === "time_entries") {
    const rows = await db.orm.select({
      id: timeEntries.id,
      entry_type: timeEntries.entryType,
      custom_field_values_json: timeEntries.customFieldValuesJson,
    }).from(timeEntries) as Array<{ id: number; entry_type: TimeEntryType; custom_field_values_json: string }>;

    for (const row of rows) {
      const parsedValues = parseCustomFieldValuesJson(row.custom_field_values_json);
      const resolvedValues = sanitizeCustomFieldValuesForTarget(
        customFields,
        { scope: "time_entry", entryType: row.entry_type },
        parsedValues
      );

      if (JSON.stringify(resolvedValues) === JSON.stringify(parsedValues)) {
        continue;
      }

      await db.orm.update(timeEntries).set({
        customFieldValuesJson: stringifyCustomFieldValues(resolvedValues),
      }).where(eq(timeEntries.id, row.id)).run();
    }

    return;
  }

  const tableConfig = table === "users"
    ? { source: users, id: users.id, customFieldValuesJson: users.customFieldValuesJson }
    : table === "projects"
      ? { source: projects, id: projects.id, customFieldValuesJson: projects.customFieldValuesJson }
      : { source: tasks, id: tasks.id, customFieldValuesJson: tasks.customFieldValuesJson };
  const rows = await db.orm.select({
    id: tableConfig.id,
    custom_field_values_json: tableConfig.customFieldValuesJson,
  }).from(tableConfig.source);

  for (const row of rows) {
    const parsedValues = parseCustomFieldValuesJson(row.custom_field_values_json);
    const resolvedValues = sanitizeCustomFieldValuesForTarget(customFields, { scope: target.scope }, parsedValues);

    if (JSON.stringify(resolvedValues) === JSON.stringify(parsedValues)) {
      continue;
    }

    await db.orm.update(tableConfig.source).set({
      customFieldValuesJson: stringifyCustomFieldValues(resolvedValues),
    }).where(eq(tableConfig.id, row.id)).run();
  }
}

async function ensureSettingsRow(db: AppDatabase, companyId: string) {
  const existing = await db.orm.select({ currency: companySettings.currency }).from(companySettings).limit(1).get();
  if (existing) {
    return;
  }

  await db.orm.insert(companySettings).values({
    currency: "EUR",
    locale: DEFAULT_COMPANY_LOCALE,
    timeZone: DEFAULT_COMPANY_TIME_ZONE,
    dateTimeFormat: DEFAULT_COMPANY_DATE_TIME_FORMAT,
    firstDayOfWeek: 1,
    weekendDaysJson: JSON.stringify(DEFAULT_COMPANY_WEEKEND_DAYS),
    editDaysLimit: 30,
    insertDaysLimit: 30,
    allowOneRecordPerDay: 0,
    allowIntersectingRecords: 0,
    allowRecordsOnHolidays: 1,
    allowRecordsOnWeekends: 1,
    allowFutureRecords: 0,
    country: "AT",
    tabletIdleTimeoutSeconds: 10,
    autoBreakAfterMinutes: 300,
    autoBreakDurationMinutes: 30,
    projectsEnabled: 0,
    tasksEnabled: 0,
    overtimeSettingsJson: JSON.stringify(createDefaultOvertimeSettings()),
    customFieldsJson: "[]",
  }).run();
}

function normalizeSettingsTimeZone(value: string) {
  const normalized = normalizeTimeZone(value);
  if (!normalized) {
    throw new HTTPException(400, { message: "Invalid time zone" });
  }

  return normalized;
}

function isFreshForYear(isoDate: string, year: number) {
  const fetchedAt = new Date(isoDate).getTime();
  const ageMs = Date.now() - fetchedAt;
  const maxAgeDays = year === new Date().getFullYear() ? CURRENT_YEAR_CACHE_MAX_AGE_DAYS : HOLIDAY_CACHE_MAX_AGE_DAYS;
  return ageMs < maxAgeDays * 24 * 60 * 60 * 1000;
}

function enumerateYears(startDate: string, endDate: string) {
  const years = new Set<number>();
  let year = Number(startDate.slice(0, 4));
  const finalYear = Number(endDate.slice(0, 4));
  while (year <= finalYear) {
    years.add(year);
    year += 1;
  }
  return Array.from(years);
}

function isHolidaySourceOnCooldown(source: HolidaySourceId) {
  const cooldownUntil = holidaySourceCooldowns.get(source);
  return typeof cooldownUntil === "number" && cooldownUntil > Date.now();
}

function markHolidaySourceFailed(source: HolidaySourceId) {
  holidaySourceCooldowns.set(source, Date.now() + HOLIDAY_SOURCE_COOLDOWN_MS);
}

function markHolidaySourceHealthy(source: HolidaySourceId) {
  holidaySourceCooldowns.delete(source);
}

function pickString(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const rawValue = value[key];
    if (typeof rawValue === "string" && rawValue.trim().length > 0) {
      return rawValue.trim();
    }
  }
  return null;
}

function normalizeHolidayDate(value: string | null) {
  if (!value) {
    return null;
  }

  const dateMatch = /^\d{4}-\d{2}-\d{2}/.exec(value);
  return dateMatch ? dateMatch[0] : null;
}

function normalizeHolidayPayload(payload: unknown, fallbackCountryCode: string): PublicHolidayRecord[] {
  const rows: unknown[] = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
      ? (() => {
          const objectValue = payload as Record<string, unknown>;
          for (const key of ["holidays", "items", "value", "results"]) {
            const candidate = objectValue[key];
            if (Array.isArray(candidate)) {
              return candidate;
            }
          }
          return [];
        })()
      : [];

  const holidays: PublicHolidayRecord[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const value = row as Record<string, unknown>;
    const date = normalizeHolidayDate(pickString(value, ["date", "startDate", "validFrom", "from", "day"]));
    if (!date) {
      continue;
    }

    const localName = pickString(value, ["localName", "local_name", "nameLocal", "displayName", "title", "name"])
      ?? pickString(value, ["name", "label"])
      ?? date;
    const name = pickString(value, ["name", "englishName", "title", "label"])
      ?? localName;
    const countryCode = pickString(value, ["countryCode", "countryIsoCode", "country_code", "country"]) ?? fallbackCountryCode;

    holidays.push({
      date,
      localName,
      name,
      countryCode,
    });
  }

  return holidays;
}

async function fetchJsonWithTimeout(url: string, timeoutMs = HOLIDAY_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json, text/json;q=0.9, */*;q=0.1",
      },
    });
    return response;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function fetchHolidaySource(
  source: HolidaySourceId,
  countryCode: string,
  year: number,
): Promise<PublicHolidayRecord[]> {
  const normalizedCountry = countryCode.trim().toUpperCase();

  if (source === "nager") {
    const response = await fetchJsonWithTimeout(`https://date.nager.at/api/v3/PublicHolidays/${year}/${normalizedCountry}`);
    if (!response.ok) {
      throw new Error(`Nager.Date failed with ${response.status}`);
    }

    const payload = await response.json();
    return normalizeHolidayPayload(payload, normalizedCountry);
  }

  if (!OPEN_HOLIDAYS_SUPPORTED_COUNTRIES.has(normalizedCountry) || year < 2020) {
    throw new Error(`OpenHolidays API does not support ${normalizedCountry} for ${year}`);
  }

  const validFrom = `${year}-01-01`;
  const validTo = `${year}-12-31`;
  const response = await fetchJsonWithTimeout(
    `https://openholidaysapi.org/PublicHolidays?countryIsoCode=${encodeURIComponent(normalizedCountry)}&validFrom=${validFrom}&validTo=${validTo}`,
  );
  if (!response.ok) {
    throw new Error(`OpenHolidays API failed with ${response.status}`);
  }

  const payload = await response.json();
  return normalizeHolidayPayload(payload, normalizedCountry);
}

export const settingsService = {
  async getSettings(db: AppDatabase, companyId: string) {
    await ensureSettingsRow(db, companyId);
    const row = await db.orm.select({
      currency: companySettings.currency,
      locale: companySettings.locale,
      time_zone: companySettings.timeZone,
      date_time_format: companySettings.dateTimeFormat,
      first_day_of_week: companySettings.firstDayOfWeek,
      weekend_days_json: companySettings.weekendDaysJson,
      edit_days_limit: companySettings.editDaysLimit,
      insert_days_limit: companySettings.insertDaysLimit,
      allow_one_record_per_day: companySettings.allowOneRecordPerDay,
      allow_intersecting_records: companySettings.allowIntersectingRecords,
      allow_records_on_holidays: companySettings.allowRecordsOnHolidays,
      allow_records_on_weekends: companySettings.allowRecordsOnWeekends,
      allow_future_records: companySettings.allowFutureRecords,
      country: companySettings.country,
      tablet_idle_timeout_seconds: companySettings.tabletIdleTimeoutSeconds,
      auto_break_after_minutes: companySettings.autoBreakAfterMinutes,
      auto_break_duration_minutes: companySettings.autoBreakDurationMinutes,
      projects_enabled: companySettings.projectsEnabled,
      tasks_enabled: companySettings.tasksEnabled,
      custom_fields_json: companySettings.customFieldsJson,
      overtime_settings_json: companySettings.overtimeSettingsJson,
    }).from(companySettings).limit(1).get();
    return mapCompanySettings(row);
  },

  async updateSettings(db: AppDatabase, companyId: string, input: UpdateSettingsInput) {
    await ensureSettingsRow(db, companyId);
    const previousRow = await db.orm.select({
      custom_fields_json: companySettings.customFieldsJson,
    }).from(companySettings).limit(1).get() as { custom_fields_json: string } | undefined;
    const previousCustomFields = normalizeCustomFields(
      previousRow ? JSON.parse(previousRow.custom_fields_json || "[]") : []
    );
    const nextCustomFields = normalizeCustomFields(input.customFields);
    const nextLocale = normalizeCompanyLocale(input.locale);
    const nextDateTimeFormat = normalizeCompanyDateTimeFormat(input.dateTimeFormat);
    const nextTimeZone = normalizeSettingsTimeZone(input.timeZone);
    const nextWeekendDays = normalizeWeekendDays(input.weekendDays);
    const nextOvertimeJson = JSON.stringify(normalizeOvertimeSettings(input.overtime));
    const nextProjectsEnabled = Boolean(input.projectsEnabled);
    const nextTasksEnabled = Boolean(input.tasksEnabled);
    if (nextTasksEnabled && !nextProjectsEnabled) {
      throw new HTTPException(400, { message: "Tasks require projects to be enabled" });
    }

    await db.orm.transaction(async (tx: any) => {
      await tx.update(companySettings).set({
        currency: input.currency,
        locale: nextLocale,
        timeZone: nextTimeZone,
        dateTimeFormat: nextDateTimeFormat,
        firstDayOfWeek: input.firstDayOfWeek,
        weekendDaysJson: JSON.stringify(nextWeekendDays),
        editDaysLimit: input.editDaysLimit,
        insertDaysLimit: input.insertDaysLimit,
        allowOneRecordPerDay: input.allowOneRecordPerDay ? 1 : 0,
        allowIntersectingRecords: input.allowIntersectingRecords ? 1 : 0,
        allowRecordsOnHolidays: input.allowRecordsOnHolidays ? 1 : 0,
        allowRecordsOnWeekends: input.allowRecordsOnWeekends ? 1 : 0,
        allowFutureRecords: input.allowFutureRecords ? 1 : 0,
        country: input.country,
        tabletIdleTimeoutSeconds: input.tabletIdleTimeoutSeconds,
        autoBreakAfterMinutes: input.autoBreakAfterMinutes,
        autoBreakDurationMinutes: input.autoBreakDurationMinutes,
        projectsEnabled: nextProjectsEnabled ? 1 : 0,
        tasksEnabled: nextTasksEnabled ? 1 : 0,
        overtimeSettingsJson: nextOvertimeJson,
        customFieldsJson: JSON.stringify(nextCustomFields),
      }).run();
      if (JSON.stringify(previousCustomFields) !== JSON.stringify(nextCustomFields)) {
        await cleanupCustomFieldValuesForTable(db, "users", nextCustomFields, { scope: "user" });
        await cleanupCustomFieldValuesForTable(db, "projects", nextCustomFields, { scope: "project" });
        await cleanupCustomFieldValuesForTable(db, "tasks", nextCustomFields, { scope: "task" });
        await cleanupCustomFieldValuesForTable(db, "time_entries", nextCustomFields, { scope: "time_entry" });
      }
    });

    return this.getSettings(db, companyId);
  },

  async getPublicHolidays(db: AppDatabase, companyId: string, countryCode: string, year: number) {
    const normalizedCountry = countryCode.trim().toUpperCase();
    const cached = await db.orm.select({
      payload_json: publicHolidayCache.payloadJson,
      fetched_at: publicHolidayCache.fetchedAt,
    }).from(publicHolidayCache)
      .where(and(eq(publicHolidayCache.countryCode, normalizedCountry), eq(publicHolidayCache.year, year)))
      .get() as { payload_json: string; fetched_at: string } | undefined;

    if (cached && isFreshForYear(cached.fetched_at, year)) {
      return {
        holidays: JSON.parse(cached.payload_json),
        cached: true,
        source: "nager" as const
      };
    }

    const sources: HolidaySourceId[] = ["nager", "openholidays"];
    const errors: string[] = [];

    for (const source of sources) {
      if (isHolidaySourceOnCooldown(source)) {
        continue;
      }

      try {
        const holidays = await fetchHolidaySource(source, normalizedCountry, year);
        markHolidaySourceHealthy(source);

        const fetchedAt = new Date().toISOString();
        await db.orm.insert(publicHolidayCache).values({
          countryCode: normalizedCountry,
          year,
          payloadJson: JSON.stringify(holidays),
          fetchedAt,
        }).onConflictDoUpdate({
          target: [publicHolidayCache.countryCode, publicHolidayCache.year],
          set: {
            payloadJson: JSON.stringify(holidays),
            fetchedAt,
          },
        }).run();

        return {
          holidays,
          cached: false,
          source
        };
      } catch (error) {
        markHolidaySourceFailed(source);
        errors.push(`${source}: ${error instanceof Error ? error.message : "request failed"}`);
      }
    }

    if (cached) {
      return {
        holidays: JSON.parse(cached.payload_json),
        cached: true,
        source: "nager" as const
      };
    }

    throw new HTTPException(502, {
      message: errors.length > 0 ? errors.join(" | ") : "Could not fetch public holidays"
    });
  },

  async isPublicHoliday(db: AppDatabase, companyId: string, date: string) {
    const settings = await this.getSettings(db, companyId);
    const year = Number(date.slice(0, 4));
    const { holidays } = await this.getPublicHolidays(db, companyId, settings.country, year);
    return holidays.find((holiday: { date: string }) => holiday.date === date) ?? null;
  },

  async findPublicHolidayInRange(db: AppDatabase, companyId: string, startDate: string, endDate: string) {
    const settings = await this.getSettings(db, companyId);
    const years = enumerateYears(startDate, endDate);
    for (const year of years) {
      const { holidays } = await this.getPublicHolidays(db, companyId, settings.country, year);
      const match = holidays.find((holiday: { date: string }) => holiday.date >= startDate && holiday.date <= endDate);
      if (match) {
        return match;
      }
    }

    return null;
  },

  async getBusinessNowSnapshot(db: AppDatabase, companyId: string, now = new Date()) {
    const settings = await this.getSettings(db, companyId);
    return getLocalNowSnapshot(now, settings.timeZone);
  },

  async getOvertimeSettings(db: AppDatabase, companyId: string) {
    const settings = await this.getSettings(db, companyId);
    return settings.overtime;
  },

  async updateOvertimeSettings(db: AppDatabase, companyId: string, input: UpdateOvertimeSettingsInput) {
    await ensureSettingsRow(db, companyId);
    await db.orm.update(companySettings).set({
      overtimeSettingsJson: JSON.stringify(normalizeOvertimeSettings(input.overtime)),
    }).run();

    return this.getOvertimeSettings(db, companyId);
  }
};
