import type {
  CompanyCustomField,
  CompanyOvertimeSettings,
  CompanySettings,
  CompanyRecord,
  CompanyUser,
  CompanyUserDetail,
  CompanyUserListItem,
  CompanyUserProfile,
  CalculationRecord,
  ProjectTaskAssignmentRecord,
  ProjectUserAssignmentRecord,
  PublicHolidayRecord,
  ProjectRecord,
  TaskRecord,
  TimeEntryRecord,
  TimeEntryView
} from "../../shared/types/models";
import {
  DEFAULT_COMPANY_DATE_TIME_FORMAT,
  DEFAULT_COMPANY_LOCALE,
  DEFAULT_COMPANY_TIME_ZONE,
  normalizeCompanyDateTimeFormat,
  normalizeCompanyLocale,
  normalizeWeekendDays,
} from "../../shared/utils/company-locale";
import { diffCalendarDays, diffMinutes } from "../../shared/utils/time";
import { normalizeOvertimeSettings } from "../../shared/utils/overtime";
import { buildUserContract } from "../services/user-contract-schedule";
import { normalizeCustomFields } from "../../shared/utils/custom-fields";

function normalizeEntryType(value: unknown) {
  if (value === "work" || value === "vacation" || value === "sick_leave" || value === "time_off_in_lieu") {
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

function parseCustomFieldValues(value: unknown) {
  return parseJsonValue<Record<string, string | number | boolean>>(value, {});
}

export function mapCompanyRecord(row: any): CompanyRecord {
  return {
    id: row.id,
    name: row.name,
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
    deletedAt: row.deleted_at ?? null,
    pinCode: row.pin_code ?? "0000",
    email: row.email ?? null,
    customFieldValues: parseCustomFieldValues(row.custom_field_values_json),
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
    isActive: Boolean(row.is_active),
    role: row.role
  };
}

export function mapUserContractScheduleBlock(row: any): {
  weekday: number;
  block_order: number;
  start_time: string;
  end_time: string;
  minutes: number;
} {
  return {
    weekday: Number(row.weekday),
    block_order: Number(row.block_order ?? 1),
    start_time: row.start_time ?? "",
    end_time: row.end_time ?? "",
    minutes: Number(row.minutes ?? 0)
  };
}

export function mapUserContract(
  row: any,
  schedule: Array<{
    weekday: number;
    block_order: number;
    start_time: string;
    end_time: string;
    minutes: number;
  }> = []
) {
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
    annualVacationDays: Number(row.annual_vacation_days ?? 25),
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
    customFieldValues: parseCustomFieldValues(row.custom_field_values_json),
    contracts,
    createdAt: row.created_at
  };
}

export function mapProject(row: any): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    budget: Number(row.budget ?? 0),
    isActive: Boolean(row.is_active),
    allowAllUsers: Boolean(row.allow_all_users ?? 1),
    allowAllTasks: Boolean(row.allow_all_tasks ?? 1),
    customFieldValues: parseCustomFieldValues(row.custom_field_values_json),
    createdAt: row.created_at
  };
}

export function mapCalculation(row: any): CalculationRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    sqlText: row.sql_text,
    isBuiltin: Boolean(row.is_builtin ?? 0),
    builtinKey: row.builtin_key ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
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
    projectId: row.project_id ?? null,
    taskId: row.task_id ?? null,
    customFieldValues: parseCustomFieldValues(row.custom_field_values_json),
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
    projectId: row.project_id ?? null,
    taskId: row.task_id ?? null,
    durationMinutes: entryType === "work" ? diffMinutes(row.start_time, row.end_time) : 0,
    totalDayCount,
    effectiveDayCount: totalDayCount,
    excludedHolidayCount: 0,
    excludedWeekendCount: 0,
    customFieldValues: parseCustomFieldValues(row.custom_field_values_json),
    createdAt: row.created_at
  };
}

export function mapTask(row: any): TaskRecord {
  return {
    id: row.id,
    title: row.title,
    isActive: Boolean(row.is_active),
    customFieldValues: parseCustomFieldValues(row.custom_field_values_json),
    createdAt: row.created_at
  };
}

export function mapProjectUserAssignment(row: any): ProjectUserAssignmentRecord {
  return {
    projectId: row.project_id,
    userId: row.user_id,
    createdAt: row.created_at,
  };
}

export function mapProjectTaskAssignment(row: any): ProjectTaskAssignmentRecord {
  return {
    projectId: row.project_id,
    taskId: row.task_id,
    createdAt: row.created_at,
  };
}

export function mapCompanySettings(row: any): CompanySettings {
  return {
    currency: row.currency,
    locale: normalizeCompanyLocale(row.locale ?? DEFAULT_COMPANY_LOCALE),
    timeZone: row.time_zone ?? DEFAULT_COMPANY_TIME_ZONE,
    dateTimeFormat: normalizeCompanyDateTimeFormat(row.date_time_format ?? DEFAULT_COMPANY_DATE_TIME_FORMAT),
    firstDayOfWeek: row.first_day_of_week,
    weekendDays: normalizeWeekendDays(parseJsonValue<number[]>(row.weekend_days_json, [6, 7])),
    editDaysLimit: row.edit_days_limit,
    insertDaysLimit: row.insert_days_limit,
    allowOneRecordPerDay: Boolean(row.allow_one_record_per_day ?? 0),
    allowIntersectingRecords: Boolean(row.allow_intersecting_records ?? 0),
    allowRecordsOnHolidays: Boolean(row.allow_records_on_holidays ?? 1),
    allowRecordsOnWeekends: Boolean(row.allow_records_on_weekends ?? 1),
    allowFutureRecords: Boolean(row.allow_future_records ?? 0),
    country: row.country ?? row.holiday_country,
    tabletIdleTimeoutSeconds: row.tablet_idle_timeout_seconds ?? 10,
    autoBreakAfterMinutes: row.auto_break_after_minutes ?? 300,
    autoBreakDurationMinutes: row.auto_break_duration_minutes ?? 30,
    projectsEnabled: Boolean(row.projects_enabled ?? 0),
    tasksEnabled: Boolean(row.tasks_enabled ?? 0),
    customFields: normalizeCustomFields(parseJsonValue<CompanyCustomField[]>(row.custom_fields_json, [])),
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
