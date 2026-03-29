import type { CompanySettings, TimeEntryType, UserRole } from "@shared/types/models";
import { evaluateTimeEntryPolicy, type TimeEntryPolicyReason } from "@shared/utils/time-entry-policy";

export type TimeEntryAccessScope = "dashboard" | "recordEditor" | "timerSetup";

export type TimeEntryAccessBlockKind =
  | "insert_limit"
  | "edit_limit"
  | "future_restricted"
  | "holiday_work_blocked"
  | "weekend_work_blocked"
  | "single_record_per_day"
  | "project_required"
  | "task_required"
  | "custom_field_required"
  | "work_day_conflict"
  | "leave_day_conflict"
  | "leave_type_conflict";

export interface TimeEntryAccessBlock {
  kind: TimeEntryAccessBlockKind;
  fieldId?: string;
  label: string;
}

export interface TimeEntryAccessInput {
  scope: TimeEntryAccessScope;
  mode: "create" | "edit";
  includePolicy?: boolean;
  role?: UserRole | string;
  settings: Pick<
    CompanySettings,
    | "editDaysLimit"
    | "insertDaysLimit"
    | "allowOneRecordPerDay"
    | "allowIntersectingRecords"
    | "allowRecordsOnHolidays"
    | "allowRecordsOnWeekends"
    | "allowFutureRecords"
    | "projectsEnabled"
    | "tasksEnabled"
  >;
  entryType: TimeEntryType;
  startDate: string;
  endDate?: string | null;
  todayDay: string;
  hasHolidayInRange: boolean;
  hasWeekendInRange: boolean;
  hasExistingEntry?: boolean;
  hasWorkConflict?: boolean;
  hasLeaveConflict?: boolean;
  projectMissing?: boolean;
  taskMissing?: boolean;
  missingCustomFieldLabels?: Array<{ fieldId: string; label: string }>;
}

export interface TimeEntryAccessResult {
  allowed: boolean;
  blocks: TimeEntryAccessBlock[];
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

function mapPolicyReason(reason: TimeEntryPolicyReason | null): TimeEntryAccessBlockKind | null {
  switch (reason) {
    case "insert_limit":
      return "insert_limit";
    case "edit_limit":
      return "edit_limit";
    case "future_restricted":
      return "future_restricted";
    case "holiday_work_blocked":
      return "holiday_work_blocked";
    case "weekend_work_blocked":
      return "weekend_work_blocked";
    default:
      return null;
  }
}

function getPolicyMessageKey(scope: TimeEntryAccessScope, kind: TimeEntryAccessBlockKind) {
  switch (kind) {
    case "insert_limit":
      return scope === "recordEditor" ? "recordEditor.insertLimitDetailed" : "dashboard.insertLimitDetailed";
    case "edit_limit":
      return "recordEditor.editLimitDetailed";
    case "future_restricted":
      return scope === "recordEditor" ? "recordEditor.futureVacationOnly" : "dashboard.futureVacationOnly";
    case "holiday_work_blocked":
      return scope === "recordEditor" ? "recordEditor.holidayWorkBlocked" : "dashboard.holidayWorkBlocked";
    case "weekend_work_blocked":
      return scope === "recordEditor" ? "recordEditor.weekendWorkBlocked" : "dashboard.weekendWorkBlocked";
    default:
      return null;
  }
}

export function evaluateTimeEntryAccess(input: TimeEntryAccessInput): TimeEntryAccessResult {
  const blocks: TimeEntryAccessBlock[] = [];
  const policy = evaluateTimeEntryPolicy({
    mode: input.mode,
    role: input.role,
    settings: {
      editDaysLimit: input.settings.editDaysLimit,
      insertDaysLimit: input.settings.insertDaysLimit,
      allowRecordsOnHolidays: input.settings.allowRecordsOnHolidays,
      allowRecordsOnWeekends: input.settings.allowRecordsOnWeekends,
      allowFutureRecords: input.settings.allowFutureRecords,
    },
    entryType: input.entryType,
    startDate: input.startDate,
    endDate: input.endDate,
    todayDay: input.todayDay,
    hasHolidayInRange: input.hasHolidayInRange,
    hasWeekendInRange: input.hasWeekendInRange,
  });

  if (input.includePolicy ?? true) {
    const policyKind = mapPolicyReason(policy.reason);
    if (policyKind) {
      blocks.push({
        kind: policyKind,
        label: policyKind,
      });
    }
  }

  if (input.settings.allowOneRecordPerDay && input.hasExistingEntry) {
    blocks.push({
      kind: "single_record_per_day",
      label: "single_record_per_day",
    });
  }

  if (input.scope !== "dashboard" && input.entryType === "work") {
    if (input.projectMissing && input.settings.projectsEnabled) {
      blocks.push({
        kind: "project_required",
        label: "project_required",
      });
    }

    if (input.taskMissing && input.settings.tasksEnabled) {
      blocks.push({
        kind: "task_required",
        label: "task_required",
      });
    }

    for (const field of input.missingCustomFieldLabels ?? []) {
      blocks.push({
        kind: "custom_field_required",
        fieldId: field.fieldId,
        label: field.label,
      });
    }
  }

  if (input.scope === "recordEditor" && !input.settings.allowIntersectingRecords) {
    if (input.hasWorkConflict && input.entryType !== "work") {
      blocks.push({
        kind: "work_day_conflict",
        label: "work_day_conflict",
      });
    }

    if (input.hasLeaveConflict && input.entryType === "work") {
      blocks.push({
        kind: "leave_day_conflict",
        label: "leave_day_conflict",
      });
    }

    if (input.hasLeaveConflict && input.entryType !== "work") {
      blocks.push({
        kind: "leave_type_conflict",
        label: "leave_type_conflict",
      });
    }
  }

  return {
    allowed: blocks.length === 0,
    blocks,
  };
}

function joinList(items: string[]) {
  const trimmed = items.map((item) => item.trim()).filter((item) => item.length > 0);
  if (trimmed.length <= 1) {
    return trimmed[0] ?? "";
  }
  return trimmed.join(", ");
}

function getAccessBlockLabel(block: TimeEntryAccessBlock, scope: TimeEntryAccessScope, t: Translate) {
  switch (block.kind) {
    case "insert_limit":
      return t(getPolicyMessageKey(scope, block.kind) ?? "dashboard.insertLimitDetailed");
    case "edit_limit":
      return t(getPolicyMessageKey(scope, block.kind) ?? "recordEditor.editLimitDetailed");
    case "future_restricted":
      return t(getPolicyMessageKey(scope, block.kind) ?? "dashboard.futureVacationOnly");
    case "holiday_work_blocked":
      return t(getPolicyMessageKey(scope, block.kind) ?? "dashboard.holidayWorkBlocked");
    case "weekend_work_blocked":
      return t(getPolicyMessageKey(scope, block.kind) ?? "dashboard.weekendWorkBlocked");
    case "single_record_per_day":
      return t(scope === "recordEditor" ? "recordEditor.oneRecordPerDay" : "dashboard.oneRecordPerDay");
    case "project_required":
      return t("recordEditor.projectRequired");
    case "task_required":
      return t("recordEditor.taskRequired");
    case "custom_field_required":
      return block.label;
    case "work_day_conflict":
      return t("recordEditor.workDayAlreadyBooked");
    case "leave_day_conflict":
      return t("recordEditor.leaveDayAlreadyBooked");
    case "leave_type_conflict":
      return t("recordEditor.leaveTypeAlreadyBooked");
    default:
      return block.label;
  }
}

export function formatTimeEntryAccessMessage(
  result: TimeEntryAccessResult,
  scope: TimeEntryAccessScope,
  t: Translate,
) {
  if (result.blocks.length === 0) {
    return null;
  }

  const labels = result.blocks.map((block) => getAccessBlockLabel(block, scope, t));
  return t(scope === "recordEditor" ? "recordEditor.missingRequirements" : "dashboard.startWorkMissingRequirements", {
    items: joinList(labels),
  });
}

export function formatStartTimerRequirementsMessage(requirements: Array<{ kind: string; label: string; fieldId?: string }>, t: Translate) {
  if (requirements.length === 0) {
    return null;
  }

  const labels = requirements.map((requirement) => requirement.label.trim()).filter((label) => label.length > 0);
  if (labels.length === 0) {
    return null;
  }

  return t("dashboard.startWorkMissingRequirements", {
    items: joinList(labels),
  });
}
