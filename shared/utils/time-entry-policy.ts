import type { TimeEntryType, UserRole } from "../types/models";
import { diffCalendarDays } from "./time";

export type TimeEntryPolicyMode = "create" | "edit";
export type TimeEntryPolicyReason =
  | "insert_limit"
  | "edit_limit"
  | "future_restricted"
  | "holiday_work_blocked";

interface TimeEntryPolicySettings {
  editDaysLimit: number;
  insertDaysLimit: number;
  allowRecordsOnHolidays: boolean;
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

  if (daysInFuture > 0 && input.entryType !== "vacation" && !input.settings.allowFutureRecords) {
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
  });

  return {
    work,
    vacation,
    sickLeave,
    anyAllowed: work.allowed || vacation.allowed || sickLeave.allowed,
    onlyVacationAllowed: vacation.allowed && !work.allowed && !sickLeave.allowed,
  };
}
