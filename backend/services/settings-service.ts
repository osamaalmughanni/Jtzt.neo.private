import { HTTPException } from "hono/http-exception";
import type { UpdateSettingsInput } from "../../shared/types/api";
import { getLocalNowSnapshot, normalizeTimeZone } from "../../shared/utils/time";
import { getCompanyDb } from "../db/company-db";
import { mapCompanySettings } from "../db/mappers";

const HOLIDAY_CACHE_MAX_AGE_DAYS = 30;
const CURRENT_YEAR_CACHE_MAX_AGE_DAYS = 7;
export const DEFAULT_COMPANY_TIME_ZONE = "Europe/Vienna";

function getDefaultSettingsRow(companyId: string) {
  return {
    company_id: companyId,
    currency: "EUR",
    locale: "en-GB",
    time_zone: DEFAULT_COMPANY_TIME_ZONE,
    date_time_format: "g",
    first_day_of_week: 1,
    edit_days_limit: 30,
    insert_days_limit: 30,
    allow_one_record_per_day: 0,
    allow_intersecting_records: 0,
    country: "AT",
    tablet_idle_timeout_seconds: 10,
    auto_break_after_minutes: 300,
    auto_break_duration_minutes: 30,
    custom_fields_json: "[]"
  };
}

function ensureSettingsRow(companyId: string) {
  getCompanyDb(companyId)
    .prepare(
      `INSERT INTO company_settings (
        company_id,
        currency,
        locale,
        time_zone,
        date_time_format,
        first_day_of_week,
        edit_days_limit,
        insert_days_limit,
        allow_one_record_per_day,
        allow_intersecting_records,
        country,
        tablet_idle_timeout_seconds,
        auto_break_after_minutes,
        auto_break_duration_minutes,
        custom_fields_json
      ) VALUES (
        @company_id,
        @currency,
        @locale,
        @time_zone,
        @date_time_format,
        @first_day_of_week,
        @edit_days_limit,
        @insert_days_limit,
        @allow_one_record_per_day,
        @allow_intersecting_records,
        @country,
        @tablet_idle_timeout_seconds,
        @auto_break_after_minutes,
        @auto_break_duration_minutes,
        @custom_fields_json
      ) ON CONFLICT(company_id) DO NOTHING`
    )
    .run(getDefaultSettingsRow(companyId));
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
  getSettings(companyId: string) {
    ensureSettingsRow(companyId);
    const row = getCompanyDb(companyId).prepare("SELECT * FROM company_settings WHERE company_id = ?").get(companyId);
    return mapCompanySettings(row);
  },

  updateSettings(companyId: string, input: UpdateSettingsInput) {
    ensureSettingsRow(companyId);
    getCompanyDb(companyId)
      .prepare(
        `UPDATE company_settings
         SET
           currency = @currency,
           locale = @locale,
           time_zone = @timeZone,
           date_time_format = @dateTimeFormat,
           first_day_of_week = @firstDayOfWeek,
           edit_days_limit = @editDaysLimit,
           insert_days_limit = @insertDaysLimit,
           allow_one_record_per_day = @allowOneRecordPerDay,
           allow_intersecting_records = @allowIntersectingRecords,
           country = @country,
           tablet_idle_timeout_seconds = @tabletIdleTimeoutSeconds,
           auto_break_after_minutes = @autoBreakAfterMinutes,
           auto_break_duration_minutes = @autoBreakDurationMinutes,
           custom_fields_json = @customFieldsJson
         WHERE company_id = @companyId`
      )
      .run({
        companyId,
        ...input,
        timeZone: normalizeSettingsTimeZone(input.timeZone),
        allowOneRecordPerDay: input.allowOneRecordPerDay ? 1 : 0,
        allowIntersectingRecords: input.allowIntersectingRecords ? 1 : 0,
        customFieldsJson: JSON.stringify(input.customFields)
      });

    return this.getSettings(companyId);
  },

  async getPublicHolidays(companyId: string, countryCode: string, year: number) {
    const db = getCompanyDb(companyId);
    const normalizedCountry = countryCode.trim().toUpperCase();
    const cached = db
      .prepare("SELECT payload_json, fetched_at FROM public_holiday_cache WHERE company_id = ? AND country_code = ? AND year = ?")
      .get(companyId, normalizedCountry, year) as { payload_json: string; fetched_at: string } | undefined;

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

      db.prepare(
        `INSERT INTO public_holiday_cache (company_id, country_code, year, payload_json, fetched_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(company_id, country_code, year)
         DO UPDATE SET payload_json = excluded.payload_json, fetched_at = excluded.fetched_at`
      ).run(companyId, normalizedCountry, year, JSON.stringify(holidays), new Date().toISOString());

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

  async isPublicHoliday(companyId: string, date: string) {
    const settings = this.getSettings(companyId);
    const year = Number(date.slice(0, 4));
    const { holidays } = await this.getPublicHolidays(companyId, settings.country, year);
    return holidays.some((holiday: { date: string }) => holiday.date === date);
  },

  async findPublicHolidayInRange(companyId: string, startDate: string, endDate: string) {
    const settings = this.getSettings(companyId);
    const years = enumerateYears(startDate, endDate);
    for (const year of years) {
      const { holidays } = await this.getPublicHolidays(companyId, settings.country, year);
      const match = holidays.find((holiday: { date: string }) => holiday.date >= startDate && holiday.date <= endDate);
      if (match) {
        return match;
      }
    }

    return null;
  },

  getBusinessNowSnapshot(companyId: string, now = new Date()) {
    const settings = this.getSettings(companyId);
    return getLocalNowSnapshot(now, settings.timeZone);
  }
};
