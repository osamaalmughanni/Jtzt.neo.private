import { HTTPException } from "hono/http-exception";
import type { UpdateOvertimeSettingsInput, UpdateSettingsInput } from "../../shared/types/api";
import type { TimeEntryType } from "../../shared/types/models";
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
import { mapCompanySettings } from "../db/mappers";
import type { AppDatabase } from "../runtime/types";

const HOLIDAY_CACHE_MAX_AGE_DAYS = 30;
const CURRENT_YEAR_CACHE_MAX_AGE_DAYS = 7;
type CustomFieldValue = string | number | boolean;
type CustomFieldValues = Record<string, CustomFieldValue>;

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
    const rows = await db.all<{ id: number; entry_type: TimeEntryType; custom_field_values_json: string }>(
      "SELECT id, entry_type, custom_field_values_json FROM time_entries"
    );

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

      await db.run(
        "UPDATE time_entries SET custom_field_values_json = ? WHERE id = ?",
        [stringifyCustomFieldValues(resolvedValues), row.id]
      );
    }

    return;
  }

  const rows = await db.all<{ id: number; custom_field_values_json: string }>(
    `SELECT id, custom_field_values_json FROM ${table}`
  );

  for (const row of rows) {
    const parsedValues = parseCustomFieldValuesJson(row.custom_field_values_json);
    const resolvedValues = sanitizeCustomFieldValuesForTarget(customFields, { scope: target.scope }, parsedValues);

    if (JSON.stringify(resolvedValues) === JSON.stringify(parsedValues)) {
      continue;
    }

    await db.run(
      `UPDATE ${table} SET custom_field_values_json = ? WHERE id = ?`,
      [stringifyCustomFieldValues(resolvedValues), row.id]
    );
  }
}

async function ensureSettingsRow(db: AppDatabase, companyId: string) {
  const existing = await db.first("SELECT rowid FROM company_settings LIMIT 1");
  if (existing) {
    return;
  }

  await db.run(
    `INSERT INTO company_settings (
        currency,
        locale,
        time_zone,
        date_time_format,
        first_day_of_week,
        weekend_days_json,
        edit_days_limit,
        insert_days_limit,
        allow_one_record_per_day,
        allow_intersecting_records,
        allow_records_on_holidays,
        allow_records_on_weekends,
        allow_future_records,
        country,
        tablet_idle_timeout_seconds,
        auto_break_after_minutes,
        auto_break_duration_minutes,
        projects_enabled,
        tasks_enabled,
        overtime_settings_json,
        custom_fields_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "EUR",
      DEFAULT_COMPANY_LOCALE,
      DEFAULT_COMPANY_TIME_ZONE,
      DEFAULT_COMPANY_DATE_TIME_FORMAT,
      1,
      JSON.stringify(DEFAULT_COMPANY_WEEKEND_DAYS),
      30,
      30,
      0,
      0,
      1,
      1,
      0,
      "AT",
      10,
      300,
      30,
      0,
      0,
      JSON.stringify(createDefaultOvertimeSettings()),
      "[]",
    ]
  );
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

export const settingsService = {
  async getSettings(db: AppDatabase, companyId: string) {
    await ensureSettingsRow(db, companyId);
    const row = await db.first("SELECT * FROM company_settings LIMIT 1");
    return mapCompanySettings(row);
  },

  async updateSettings(db: AppDatabase, companyId: string, input: UpdateSettingsInput) {
    await ensureSettingsRow(db, companyId);
    const previousRow = await db.first<{ custom_fields_json: string }>("SELECT custom_fields_json FROM company_settings LIMIT 1");
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

    await db.exec("BEGIN IMMEDIATE TRANSACTION");
    try {
      await db.run(
          `UPDATE company_settings
             SET
               currency = ?,
               locale = ?,
               time_zone = ?,
             date_time_format = ?,
             first_day_of_week = ?,
             weekend_days_json = ?,
             edit_days_limit = ?,
             insert_days_limit = ?,
             allow_one_record_per_day = ?,
             allow_intersecting_records = ?,
             allow_records_on_holidays = ?,
             allow_records_on_weekends = ?,
             allow_future_records = ?,
             country = ?,
             tablet_idle_timeout_seconds = ?,
             auto_break_after_minutes = ?,
             auto_break_duration_minutes = ?,
             projects_enabled = ?,
             tasks_enabled = ?,
             overtime_settings_json = ?,
             custom_fields_json = ?`,
        [
          input.currency,
          nextLocale,
          nextTimeZone,
          nextDateTimeFormat,
          input.firstDayOfWeek,
          JSON.stringify(nextWeekendDays),
          input.editDaysLimit,
          input.insertDaysLimit,
          input.allowOneRecordPerDay ? 1 : 0,
          input.allowIntersectingRecords ? 1 : 0,
          input.allowRecordsOnHolidays ? 1 : 0,
          input.allowRecordsOnWeekends ? 1 : 0,
          input.allowFutureRecords ? 1 : 0,
          input.country,
          input.tabletIdleTimeoutSeconds,
          input.autoBreakAfterMinutes,
          input.autoBreakDurationMinutes,
          nextProjectsEnabled ? 1 : 0,
          nextTasksEnabled ? 1 : 0,
          nextOvertimeJson,
          JSON.stringify(nextCustomFields),
        ]
      );

      if (JSON.stringify(previousCustomFields) !== JSON.stringify(nextCustomFields)) {
        await cleanupCustomFieldValuesForTable(db, "users", nextCustomFields, { scope: "user" });
        await cleanupCustomFieldValuesForTable(db, "projects", nextCustomFields, { scope: "project" });
        await cleanupCustomFieldValuesForTable(db, "tasks", nextCustomFields, { scope: "task" });
        await cleanupCustomFieldValuesForTable(db, "time_entries", nextCustomFields, { scope: "time_entry" });
      }

      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }

    return this.getSettings(db, companyId);
  },

  async getPublicHolidays(db: AppDatabase, companyId: string, countryCode: string, year: number) {
    const normalizedCountry = countryCode.trim().toUpperCase();
    const cached = await db.first(
      "SELECT payload_json, fetched_at FROM public_holiday_cache WHERE country_code = ? AND year = ?",
      [normalizedCountry, year]
    ) as { payload_json: string; fetched_at: string } | null;

    if (cached && isFreshForYear(cached.fetched_at, year)) {
      return {
        holidays: JSON.parse(cached.payload_json),
        cached: true
      };
    }

    try {
      const response = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${normalizedCountry}`);
      if (!response.ok) {
        throw new Error(`Holiday API failed with ${response.status}`);
      }

      const holidays = (await response.json()) as Array<{
        date: string;
        localName: string;
        name: string;
        countryCode: string;
      }>;

      await db.run(
        `INSERT INTO public_holiday_cache (country_code, year, payload_json, fetched_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(country_code, year)
         DO UPDATE SET payload_json = excluded.payload_json, fetched_at = excluded.fetched_at`
      , [normalizedCountry, year, JSON.stringify(holidays), new Date().toISOString()]);

      return {
        holidays,
        cached: false
      };
    } catch (error) {
      if (cached) {
        return {
          holidays: JSON.parse(cached.payload_json),
          cached: true
        };
      }

      throw new HTTPException(502, {
        message: error instanceof Error ? error.message : "Could not fetch public holidays"
      });
    }
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
    await db.run(
      `UPDATE company_settings
         SET overtime_settings_json = ?
       WHERE rowid = (SELECT rowid FROM company_settings LIMIT 1)`,
      [JSON.stringify(normalizeOvertimeSettings(input.overtime))]
    );

    return this.getOvertimeSettings(db, companyId);
  }
};
