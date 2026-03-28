import type { TimeEntryType, UserRole } from "../types/models";
import { diffCalendarDays } from "./time";

export type TimeEntryPolicyMode = "create" | "edit";
export type TimeEntryPolicyReason =
  | "insert_limit"
  | "edit_limit"
  | "future_restricted"
  | "holiday_work_blocked"
  | "weekend_work_blocked";

interface TimeEntryPolicySettings {
  editDaysLimit: number;
  insertDaysLimit: number;
  allowRecordsOnHolidays: boolean;
  allowRecordsOnWeekends: boolean;
  allowFutureRecords: boolean;
}

interface EvaluateTimeEntryPolicyInput {
  mode: TimeEntryPolicyMode;
  role?: UserRole | string;
  settings: TimeEntryPolicySettings;
  entryType: TimeEntryType;
  startDate: string;
  endDate?: string | null;
  todayDay: string;
  hasHolidayInRange: boolean;
  hasWeekendInRange: boolean;
}

export interface TimeEntryPolicyResult {
  allowed: boolean;
  reason: TimeEntryPolicyReason | null;
  daysInPast: number;
  daysInFuture: number;
}

function canBypassDayLimits(role?: UserRole | string) {
  return role === "admin" || role === "manager";
}

export function getRangeEndDay(startDate: string, endDate?: string | null) {
  return endDate && endDate >= startDate ? endDate : startDate;
}

export function getPastDayDistance(day: string, todayDay: string) {
  return Math.max(0, diffCalendarDays(todayDay, day));
}

export function getFutureDayDistance(day: string, todayDay: string) {
  return Math.max(0, diffCalendarDays(day, todayDay));
}

export function evaluateTimeEntryPolicy(input: EvaluateTimeEntryPolicyInput): TimeEntryPolicyResult {
  const rangeEndDay = getRangeEndDay(input.startDate, input.endDate);
  const daysInPast = getPastDayDistance(input.startDate, input.todayDay);
  const daysInFuture = getFutureDayDistance(rangeEndDay, input.todayDay);

  if (!canBypassDayLimits(input.role)) {
    const limit = input.mode === "create" ? input.settings.insertDaysLimit : input.settings.editDaysLimit;
    if (daysInPast > limit) {
      return {
        allowed: false,
        reason: input.mode === "create" ? "insert_limit" : "edit_limit",
        daysInPast,
        daysInFuture,
      };
    }
  }

  if (daysInFuture > 0 && input.entryType !== "vacation" && input.entryType !== "time_off_in_lieu" && !input.settings.allowFutureRecords) {
    return {
      allowed: false,
      reason: "future_restricted",
      daysInPast,
      daysInFuture,
    };
  }

  if (input.entryType === "work" && input.hasHolidayInRange && !input.settings.allowRecordsOnHolidays) {
    return {
      allowed: false,
      reason: "holiday_work_blocked",
      daysInPast,
      daysInFuture,
    };
  }

  if (input.entryType === "work" && input.hasWeekendInRange && !input.settings.allowRecordsOnWeekends) {
    return {
      allowed: false,
      reason: "weekend_work_blocked",
      daysInPast,
      daysInFuture,
    };
  }

  return {
    allowed: true,
    reason: null,
    daysInPast,
    daysInFuture,
  };
}

export function getAllowedEntryTypesForDay(input: {
  role?: UserRole | string;
  settings: TimeEntryPolicySettings;
  day: string;
  todayDay: string;
  isHoliday: boolean;
  isWeekend: boolean;
}) {
  const work = evaluateTimeEntryPolicy({
    mode: "create",
    role: input.role,
    settings: input.settings,
    entryType: "work",
    startDate: input.day,
    endDate: input.day,
    todayDay: input.todayDay,
    hasHolidayInRange: input.isHoliday,
    hasWeekendInRange: input.isWeekend,
  });
  const vacation = evaluateTimeEntryPolicy({
    mode: "create",
    role: input.role,
    settings: input.settings,
    entryType: "vacation",
    startDate: input.day,
    endDate: input.day,
    todayDay: input.todayDay,
    hasHolidayInRange: input.isHoliday,
    hasWeekendInRange: input.isWeekend,
  });
  const sickLeave = evaluateTimeEntryPolicy({
    mode: "create",
    role: input.role,
    settings: input.settings,
    entryType: "sick_leave",
    startDate: input.day,
    endDate: input.day,
    todayDay: input.todayDay,
    hasHolidayInRange: input.isHoliday,
    hasWeekendInRange: input.isWeekend,
  });
  const timeOffInLieu = evaluateTimeEntryPolicy({
    mode: "create",
    role: input.role,
    settings: input.settings,
    entryType: "time_off_in_lieu",
    startDate: input.day,
    endDate: input.day,
    todayDay: input.todayDay,
    hasHolidayInRange: input.isHoliday,
    hasWeekendInRange: input.isWeekend,
  });

  return {
    work,
    vacation,
    sickLeave,
    timeOffInLieu,
    anyAllowed: work.allowed || vacation.allowed || sickLeave.allowed || timeOffInLieu.allowed,
    onlyPlannedLeaveAllowed: (vacation.allowed || timeOffInLieu.allowed) && !work.allowed && !sickLeave.allowed,
  };
}
