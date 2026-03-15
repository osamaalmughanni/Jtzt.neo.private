import { HTTPException } from "hono/http-exception";
import type { UpdateSettingsInput } from "../../shared/types/api";
import { getCompanyDb } from "../db/company-db";
import { mapCompanySettings } from "../db/mappers";

const HOLIDAY_CACHE_MAX_AGE_DAYS = 30;
const CURRENT_YEAR_CACHE_MAX_AGE_DAYS = 7;

function getDefaultSettingsRow() {
  return {
    id: 1,
    currency: "EUR",
    locale: "en-GB",
    date_time_format: "g",
    first_day_of_week: 1,
    edit_days_limit: 30,
    insert_days_limit: 30,
    country: "AT",
    auto_break_after_minutes: 300,
    auto_break_duration_minutes: 30,
    custom_fields_json: "[]"
  };
}

function ensureSettingsRow(db: ReturnType<typeof getCompanyDb>) {
  db.prepare(
    `INSERT INTO company_settings (
      id,
      currency,
      locale,
      date_time_format,
      first_day_of_week,
      edit_days_limit,
      insert_days_limit,
      country,
      custom_fields_json
    ) VALUES (
      @id,
      @currency,
      @locale,
      @date_time_format,
      @first_day_of_week,
      @edit_days_limit,
      @insert_days_limit,
      @country,
      @custom_fields_json
    ) ON CONFLICT(id) DO NOTHING`
  ).run(getDefaultSettingsRow());
}

function isFresh(isoDate: string) {
  const fetchedAt = new Date(isoDate).getTime();
  const ageMs = Date.now() - fetchedAt;
  return ageMs < HOLIDAY_CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
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
  getSettings(databasePath: string) {
    const db = getCompanyDb(databasePath);
    ensureSettingsRow(db);
    const row = db.prepare("SELECT * FROM company_settings WHERE id = 1").get();
    return mapCompanySettings(row);
  },

  updateSettings(databasePath: string, input: UpdateSettingsInput) {
    const db = getCompanyDb(databasePath);
    ensureSettingsRow(db);

    db.prepare(
      `UPDATE company_settings
      SET
        currency = @currency,
        locale = @locale,
        date_time_format = @dateTimeFormat,
        first_day_of_week = @firstDayOfWeek,
        edit_days_limit = @editDaysLimit,
        insert_days_limit = @insertDaysLimit,
        country = @country,
        auto_break_after_minutes = @autoBreakAfterMinutes,
        auto_break_duration_minutes = @autoBreakDurationMinutes,
        custom_fields_json = @customFieldsJson
      WHERE id = 1`
    ).run({
      ...input,
      customFieldsJson: JSON.stringify(input.customFields)
    });

    return this.getSettings(databasePath);
  },

  async getPublicHolidays(databasePath: string, countryCode: string, year: number) {
    const db = getCompanyDb(databasePath);
    const normalizedCountry = countryCode.trim().toUpperCase();
    const cached = db
      .prepare("SELECT payload_json, fetched_at FROM public_holiday_cache WHERE country_code = ? AND year = ?")
      .get(normalizedCountry, year) as { payload_json: string; fetched_at: string } | undefined;

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
        `INSERT INTO public_holiday_cache (country_code, year, payload_json, fetched_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(country_code, year)
        DO UPDATE SET payload_json = excluded.payload_json, fetched_at = excluded.fetched_at`
      ).run(normalizedCountry, year, JSON.stringify(holidays), new Date().toISOString());

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

  async isPublicHoliday(databasePath: string, date: string) {
    const settings = this.getSettings(databasePath);
    const year = Number(date.slice(0, 4));
    const { holidays } = await this.getPublicHolidays(databasePath, settings.country, year);
    return holidays.some((holiday: { date: string }) => holiday.date === date);
  },

  async findPublicHolidayInRange(databasePath: string, startDate: string, endDate: string) {
    const settings = this.getSettings(databasePath);
    const years = enumerateYears(startDate, endDate);

    for (const year of years) {
      const { holidays } = await this.getPublicHolidays(databasePath, settings.country, year);
      const match = holidays.find((holiday: { date: string }) => holiday.date >= startDate && holiday.date <= endDate);
      if (match) {
        return match;
      }
    }

    return null;
  }
};
