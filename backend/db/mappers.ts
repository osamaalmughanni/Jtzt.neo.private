import type {
  CompanyCustomField,
  CompanyOvertimeSettings,
  CompanySettings,
  CompanyRecord,
  CompanyUser,
  CompanyUserDetail,
  CompanyUserListItem,
  CompanyUserProfile,
  PublicHolidayRecord,
  ProjectRecord,
  TaskRecord,
  TimeEntryRecord,
  TimeEntryView,
  UserContractScheduleDay
} from "../../shared/types/models";
import { diffCalendarDays, diffMinutes } from "../../shared/utils/time";
import { normalizeOvertimeSettings } from "../../shared/utils/overtime";
import { buildUserContract } from "../services/user-contract-schedule";

function normalizeEntryType(value: unknown) {
  if (value === "work" || value === "vacation" || value === "sick_leave") {
    return value;
  }

  return "vacation";
}

function parseJsonValue<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeCustomFields(value: unknown): CompanyCustomField[] {
  const parsed = parseJsonValue<CompanyCustomField[]>(value, []);
  return parsed.map((field) => ({
    ...field,
    label: typeof field.label === "string" ? field.label.trim() : "",
    options: Array.isArray(field.options) ? field.options : [],
  }));
}

export function mapCompanyRecord(row: any): CompanyRecord {
  return {
    id: row.id,
    name: row.name,
    encryptionEnabled: Boolean(row.encryption_enabled),
    tabletCodeUpdatedAt: row.tablet_code_updated_at ?? null,
    createdAt: row.created_at
  };
}

export function mapCompanyUser(row: any): CompanyUser {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    passwordHash: row.password_hash,
    isActive: Boolean(row.is_active),
    pinCode: row.pin_code ?? "0000",
    email: row.email ?? null,
    role: row.role,
    createdAt: row.created_at
  };
}

export function mapCompanyUserProfile(row: any): CompanyUserProfile {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    role: row.role
  };
}

export function mapCompanyUserListItem(row: any): CompanyUserListItem {
  return {
    id: row.id,
    fullName: row.full_name,
    isActive: Boolean(row.is_active)
  };
}

export function mapUserContractScheduleDay(row: any): UserContractScheduleDay {
  return {
    weekday: row.weekday,
    isWorkingDay: Boolean(row.is_working_day),
    startTime: row.start_time ?? null,
    endTime: row.end_time ?? null,
    minutes: Number(row.minutes ?? 0)
  };
}

export function mapUserContract(row: any, schedule: UserContractScheduleDay[] = []) {
  if (schedule.length > 0) {
    return buildUserContract(row, schedule);
  }

  return {
    id: row.id,
    userId: row.user_id,
    hoursPerWeek: row.hours_per_week,
    startDate: row.start_date,
    endDate: row.end_date,
    paymentPerHour: row.payment_per_hour,
    schedule: [],
    createdAt: row.created_at
  };
}

export function mapCompanyUserDetail(row: any, contracts: ReturnType<typeof mapUserContract>[]): CompanyUserDetail {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    isActive: Boolean(row.is_active),
    role: row.role,
    pinCode: row.pin_code ?? "0000",
    email: row.email ?? null,
    contracts,
    createdAt: row.created_at
  };
}

export function mapProject(row: any): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at
  };
}

export function mapTimeEntry(row: any): TimeEntryRecord {
  const entryType = normalizeEntryType(row.entry_type);
  return {
    id: row.id,
    userId: row.user_id,
    entryType,
    entryDate: row.entry_date,
    endDate: row.end_date ?? null,
    startTime: entryType === "work" ? row.start_time : null,
    endTime: row.end_time,
    notes: row.notes,
    customFieldValues: parseJsonValue(row.custom_field_values_json, {}),
    createdAt: row.created_at
  };
}

export function mapTimeEntryView(row: any): TimeEntryView {
  const entryType = normalizeEntryType(row.entry_type);
  const entryDate = row.entry_date;
  const endDate = row.end_date ?? null;
  const totalDayCount = endDate ? Math.max(1, diffCalendarDays(endDate, entryDate) + 1) : 1;
  return {
    id: row.id,
    userId: row.user_id,
    entryType,
    entryDate,
    endDate,
    startTime: entryType === "work" ? row.start_time : null,
    endTime: entryType === "work" ? row.end_time : null,
    notes: row.notes ?? "",
    durationMinutes: entryType === "work" ? diffMinutes(row.start_time, row.end_time) : 0,
    totalDayCount,
    effectiveDayCount: totalDayCount,
    excludedHolidayCount: 0,
    excludedWeekendCount: 0,
    customFieldValues: parseJsonValue(row.custom_field_values_json, {}),
    createdAt: row.created_at
  };
}

export function mapTask(row: any): TaskRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at
  };
}

export function mapCompanySettings(row: any): CompanySettings {
  return {
    currency: row.currency,
    locale: row.locale,
    timeZone: row.time_zone ?? "Europe/Vienna",
    dateTimeFormat: row.date_time_format ?? "g",
    firstDayOfWeek: row.first_day_of_week,
    editDaysLimit: row.edit_days_limit,
    insertDaysLimit: row.insert_days_limit,
    allowOneRecordPerDay: Boolean(row.allow_one_record_per_day ?? 0),
    allowIntersectingRecords: Boolean(row.allow_intersecting_records ?? 0),
    allowRecordsOnHolidays: Boolean(row.allow_records_on_holidays ?? 1),
    allowFutureRecords: Boolean(row.allow_future_records ?? 0),
    country: row.country ?? row.holiday_country,
    tabletIdleTimeoutSeconds: row.tablet_idle_timeout_seconds ?? 10,
    autoBreakAfterMinutes: row.auto_break_after_minutes ?? 300,
    autoBreakDurationMinutes: row.auto_break_duration_minutes ?? 30,
    customFields: normalizeCustomFields(row.custom_fields_json),
    overtime: normalizeOvertimeSettings(parseJsonValue<CompanyOvertimeSettings | null>(row.overtime_settings_json, null))
  };
}

export function mapPublicHolidayRecord(row: any): PublicHolidayRecord {
  return {
    date: row.date,
    localName: row.localName,
    name: row.name,
    countryCode: row.countryCode
  };
}
