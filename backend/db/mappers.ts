import type {
  CompanyCustomField,
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
  TimeEntryView
} from "../../shared/types/models";
import { diffCalendarDays, diffMinutes } from "../../shared/utils/time";

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

function humanizeCustomFieldId(value: string) {
  return value
    .replace(/^field[-_:]*/i, "")
    .replace(/^custom:/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeCustomFields(value: unknown): CompanyCustomField[] {
  const parsed = parseJsonValue<CompanyCustomField[]>(value, []);
  return parsed.map((field) => ({
    ...field,
    label:
      typeof field.label === "string" &&
      field.label.trim().length > 0 &&
      field.label.trim() !== field.id &&
      !/^field[-_:]/i.test(field.label.trim()) &&
      !/^custom:/i.test(field.label.trim())
        ? field.label.trim()
        : humanizeCustomFieldId(field.id),
    options: Array.isArray(field.options) ? field.options : [],
  }));
}

export function mapCompanyRecord(row: any): CompanyRecord {
  return {
    id: row.id,
    name: row.name,
    encryptionEnabled: Boolean(row.encryption_enabled),
    databasePath: row.database_path,
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

export function mapUserContract(row: any) {
  return {
    id: row.id,
    userId: row.user_id,
    hoursPerWeek: row.hours_per_week,
    startDate: row.start_date,
    endDate: row.end_date,
    paymentPerHour: row.payment_per_hour,
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
    isActive: row.is_active,
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
    sickLeaveAttachment:
      entryType === "sick_leave" && row.sick_leave_attachment_data_url
        ? {
            fileName: row.sick_leave_attachment_name,
            mimeType: row.sick_leave_attachment_mime_type,
            dataUrl: row.sick_leave_attachment_data_url
          }
        : null,
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
    sickLeaveAttachment:
      entryType === "sick_leave" && row.sick_leave_attachment_data_url
        ? {
            fileName: row.sick_leave_attachment_name,
            mimeType: row.sick_leave_attachment_mime_type,
            dataUrl: row.sick_leave_attachment_data_url
          }
        : null,
    customFieldValues: parseJsonValue(row.custom_field_values_json, {}),
    createdAt: row.created_at
  };
}

export function mapTask(row: any): TaskRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    isActive: row.is_active,
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
    country: row.country ?? row.holiday_country,
    tabletIdleTimeoutSeconds: row.tablet_idle_timeout_seconds ?? 10,
    autoBreakAfterMinutes: row.auto_break_after_minutes ?? 300,
    autoBreakDurationMinutes: row.auto_break_duration_minutes ?? 30,
    customFields: normalizeCustomFields(row.custom_fields_json)
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
