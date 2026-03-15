import type {
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
import { diffMinutes } from "../../shared/utils/time";

function normalizeEntryType(value: unknown) {
  if (value === "work" || value === "vacation" || value === "sick_leave") {
    return value;
  }

  // Legacy unsupported entries are treated as vacation to keep them readable.
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

export function mapCompanyRecord(row: any): CompanyRecord {
  return {
    id: row.id,
    name: row.name,
    encryptionEnabled: Boolean(row.encryption_enabled),
    databasePath: row.database_path,
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
    entryDate: row.entry_date ?? row.start_time?.slice(0, 10),
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
  return {
    id: row.id,
    userId: row.user_id,
    entryType,
    entryDate: row.entry_date ?? row.start_time?.slice(0, 10),
    endDate: row.end_date ?? null,
    startTime: entryType === "work" ? row.start_time : null,
    endTime: entryType === "work" ? row.end_time : null,
    notes: row.notes ?? "",
    durationMinutes: entryType === "work" ? diffMinutes(row.start_time, row.end_time) : 0,
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
    dateTimeFormat: row.date_time_format ?? "g",
    firstDayOfWeek: row.first_day_of_week,
    editDaysLimit: row.edit_days_limit,
    insertDaysLimit: row.insert_days_limit,
    country: row.country ?? row.holiday_country,
    customFields: parseJsonValue(row.custom_fields_json, [])
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
