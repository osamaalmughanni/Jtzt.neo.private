import type { ReportOvertimeMeta, ReportOvertimeSegment } from "../../shared/types/api";
import type { CompanyOvertimeRule, CompanySettings, TimeEntryType, UserContract } from "../../shared/types/models";
import { diffMinutes, formatLocalDay, parseLocalDay } from "../../shared/utils/time";
import { calculateWorkDurationMinutes } from "./time-entry-metrics-service";
import { getContractScheduledMinutesForDay } from "./user-contract-schedule";

type WorkReportEntry = {
  id: number;
  user_id: number;
  entry_type: TimeEntryType;
  entry_date: string;
  start_time: string | null;
  end_time: string | null;
};

function resolveContractForDay(contracts: UserContract[], day: string) {
  let match: UserContract | null = null;
  for (const contract of contracts) {
    if (contract.startDate <= day && (contract.endDate === null || contract.endDate >= day)) {
      if (!match || contract.startDate >= match.startDate) {
        match = contract;
      }
    }
  }
  return match;
}

function getWeekStart(day: string, firstDayOfWeek: number) {
  const parsed = parseLocalDay(day) ?? new Date();
  const currentWeekday = parsed.getDay();
  const deltaToStart = (currentWeekday - firstDayOfWeek + 7) % 7;
  const start = new Date(parsed);
  start.setDate(parsed.getDate() - deltaToStart);
  return formatLocalDay(start);
}

function getStandardRule(settings: Pick<CompanySettings, "overtime">) {
  return settings.overtime.rules.find((rule) => rule.category === "standard_overtime")
    ?? {
      id: "standard-overtime",
      category: "standard_overtime",
      triggerKind: "daily_overtime",
      afterHours: settings.overtime.dailyOvertimeThresholdHours,
      windowStart: null,
      windowEnd: null,
      multiplierPercent: 50,
      compensationType: "cash_or_time_off"
    } satisfies CompanyOvertimeRule;
}

export function getTimeOffInLieuCreditMinutes(meta: Pick<ReportOvertimeMeta, "overtimeMinutes" | "premiumCreditMinutes">, settings: Pick<CompanySettings, "overtime">) {
  const standardRule = getStandardRule(settings);
  if (standardRule.compensationType === "cash") {
    return 0;
  }

  return meta.overtimeMinutes + meta.premiumCreditMinutes;
}

function createSegments(baseMinutes: number, overtimeMinutes: number, breakMinutes: number): ReportOvertimeSegment[] {
  const segments: ReportOvertimeSegment[] = [
    { kind: "base", minutes: baseMinutes, label: "Base" },
    { kind: "standard_overtime", minutes: overtimeMinutes, label: "Premium eligible" },
    { kind: "break", minutes: breakMinutes, label: "Break" }
  ];
  return segments.filter((segment) => segment.minutes > 0);
}

function buildSummary(targetMinutes: number, actualMinutes: number, premiumPercent: number, overtimeMinutes: number) {
  if (actualMinutes <= 0) {
    return "No paid work";
  }

  if (overtimeMinutes <= 0) {
    return `Target ${Math.round(targetMinutes / 6) / 10}h / Actual ${Math.round(actualMinutes / 6) / 10}h`;
  }

  return `Target ${Math.round(targetMinutes / 6) / 10}h / Actual ${Math.round(actualMinutes / 6) / 10}h / Premium +${premiumPercent}%`;
}

function buildMeta(
  settings: CompanySettings,
  paidMinutes: number,
  rawMinutes: number,
  cumulativeWeekBefore: number,
  dailyThresholdMinutes: number,
  weeklyThresholdMinutes: number
): ReportOvertimeMeta {
  const standardRule = getStandardRule(settings);
  const choiceThresholdMinutes = settings.overtime.employeeChoiceAfterDailyHours === null
    ? Number.POSITIVE_INFINITY
    : Math.max(dailyThresholdMinutes, Math.round(settings.overtime.employeeChoiceAfterDailyHours * 60));
  const breakMinutes = Math.max(0, rawMinutes - paidMinutes);
  const standardDailyMinutes = Math.max(0, Math.min(paidMinutes, choiceThresholdMinutes) - dailyThresholdMinutes);
  const employeeChoiceMinutes = Number.isFinite(choiceThresholdMinutes)
    ? Math.max(0, paidMinutes - choiceThresholdMinutes)
    : 0;
  const baseMinutes = Math.max(0, paidMinutes - standardDailyMinutes - employeeChoiceMinutes);
  const cumulativeWeekAfter = cumulativeWeekBefore + paidMinutes;
  const weeklyOvertimeMinutes = Math.max(0, cumulativeWeekAfter - weeklyThresholdMinutes) - Math.max(0, cumulativeWeekBefore - weeklyThresholdMinutes);
  const weeklyOnlyOvertimeMinutes = Math.max(0, weeklyOvertimeMinutes - standardDailyMinutes - employeeChoiceMinutes);
  const multiplierPercent = standardRule.multiplierPercent;
  const overtimeMinutes = standardDailyMinutes + weeklyOnlyOvertimeMinutes + employeeChoiceMinutes;
  const premiumCreditMinutes = Math.round(overtimeMinutes * (multiplierPercent / 100));
  const timeOffInLieuCreditMinutes = getTimeOffInLieuCreditMinutes(
    {
      overtimeMinutes,
      premiumCreditMinutes,
    },
    settings,
  );
  const equivalentValueMinutes = baseMinutes + Math.round((standardDailyMinutes + employeeChoiceMinutes) * (1 + multiplierPercent / 100));
  const reviewState: ReportOvertimeMeta["reviewState"] = employeeChoiceMinutes > 0
    || (settings.overtime.payoutDecisionMode === "conditional"
      && settings.overtime.employeeChoiceAfterWeeklyHours !== null
      && cumulativeWeekAfter > Math.round(settings.overtime.employeeChoiceAfterWeeklyHours * 60))
    ? "needs_review"
    : standardDailyMinutes > 0 || weeklyOvertimeMinutes > 0
      ? "overtime_only"
      : "none";
  const state: ReportOvertimeMeta["state"] = reviewState === "needs_review"
    ? "needs_review"
    : employeeChoiceMinutes > 0
      ? "employee_choice"
      : weeklyOnlyOvertimeMinutes > 0
        ? "weekly_overtime"
        : standardDailyMinutes > 0
          ? "daily_overtime"
          : "base_only";

  return {
    state,
    stateLabel: state === "needs_review"
      ? "Needs review"
      : state === "employee_choice"
        ? "Employee choice"
        : state === "weekly_overtime"
          ? "Weekly overtime"
          : state === "daily_overtime"
            ? "Daily overtime"
            : "Normal",
    reviewState,
    targetMinutes: dailyThresholdMinutes,
    workedMinutes: rawMinutes,
    paidMinutes,
    breakMinutes,
    baseMinutes,
    standardOvertimeMinutes: standardDailyMinutes,
    employeeChoiceMinutes,
    weeklyOvertimeMinutes,
    weeklyOnlyOvertimeMinutes,
    overtimeMinutes,
    premiumPercent: multiplierPercent,
    premiumCreditMinutes,
    timeOffInLieuCreditMinutes,
    equivalentValueMinutes,
    segments: createSegments(baseMinutes, overtimeMinutes, breakMinutes),
    summary: buildSummary(dailyThresholdMinutes, paidMinutes, multiplierPercent, overtimeMinutes)
  };
}

export function buildOvertimeReportMeta(entries: WorkReportEntry[], settings: CompanySettings, contractsByUser: Map<number, UserContract[]>) {
  const byEntryId = new Map<number, ReportOvertimeMeta>();
  const workEntries = entries
    .filter((entry) => entry.entry_type === "work")
    .sort((left, right) => `${left.user_id}-${left.entry_date}-${left.start_time ?? ""}-${left.id}`.localeCompare(`${right.user_id}-${right.entry_date}-${right.start_time ?? ""}-${right.id}`));
  let currentUserId: number | null = null;
  let currentWeekKey = "";
  let cumulativeWeekMinutes = 0;

  for (const entry of workEntries) {
    const weekKey = `${entry.user_id}-${getWeekStart(entry.entry_date, settings.firstDayOfWeek)}`;
    if (currentUserId !== entry.user_id || currentWeekKey !== weekKey) {
      currentUserId = entry.user_id;
      currentWeekKey = weekKey;
      cumulativeWeekMinutes = 0;
    }

    const rawMinutes = diffMinutes(entry.start_time ?? "", entry.end_time);
    const paidMinutes = calculateWorkDurationMinutes(entry.start_time, entry.end_time, settings);
    const contracts = contractsByUser.get(entry.user_id) ?? [];
    const contract = resolveContractForDay(contracts, entry.entry_date);
    const contractDailyThresholdMinutes = contract ? Math.max(0, getContractScheduledMinutesForDay(contract, entry.entry_date)) : 0;
    const contractWeeklyThresholdMinutes = contract ? Math.max(0, Math.round(contract.hoursPerWeek * 60)) : 0;
    const dailyThresholdMinutes = contractDailyThresholdMinutes > 0
      ? contractDailyThresholdMinutes
      : Math.max(0, Math.round(settings.overtime.dailyOvertimeThresholdHours * 60));
    const weeklyThresholdMinutes = contractWeeklyThresholdMinutes > 0
      ? contractWeeklyThresholdMinutes
      : Math.max(0, Math.round(settings.overtime.weeklyOvertimeThresholdHours * 60));
    const meta = buildMeta(settings, paidMinutes, rawMinutes, cumulativeWeekMinutes, dailyThresholdMinutes, weeklyThresholdMinutes);
    byEntryId.set(entry.id, meta);
    cumulativeWeekMinutes += paidMinutes;
  }

  return byEntryId;
}

export function aggregateOvertimeMeta(items: ReportOvertimeMeta[]): ReportOvertimeMeta | null {
  if (items.length === 0) {
    return null;
  }

  const workedMinutes = items.reduce((sum, item) => sum + item.workedMinutes, 0);
  const paidMinutes = items.reduce((sum, item) => sum + item.paidMinutes, 0);
  const targetMinutes = items.reduce((sum, item) => sum + item.targetMinutes, 0);
  const breakMinutes = items.reduce((sum, item) => sum + item.breakMinutes, 0);
  const baseMinutes = items.reduce((sum, item) => sum + item.baseMinutes, 0);
  const standardOvertimeMinutes = items.reduce((sum, item) => sum + item.standardOvertimeMinutes, 0);
  const employeeChoiceMinutes = items.reduce((sum, item) => sum + item.employeeChoiceMinutes, 0);
  const weeklyOvertimeMinutes = items.reduce((sum, item) => sum + item.weeklyOvertimeMinutes, 0);
  const weeklyOnlyOvertimeMinutes = items.reduce((sum, item) => sum + item.weeklyOnlyOvertimeMinutes, 0);
  const overtimeMinutes = items.reduce((sum, item) => sum + item.overtimeMinutes, 0);
  const premiumCreditMinutes = items.reduce((sum, item) => sum + item.premiumCreditMinutes, 0);
  const timeOffInLieuCreditMinutes = items.reduce((sum, item) => sum + item.timeOffInLieuCreditMinutes, 0);
  const premiumPercent = items.reduce((sum, item) => sum + item.premiumPercent * item.overtimeMinutes, 0) / Math.max(1, overtimeMinutes);
  const equivalentValueMinutes = items.reduce((sum, item) => sum + item.equivalentValueMinutes, 0);
  const reviewState: ReportOvertimeMeta["reviewState"] = items.some((item) => item.reviewState === "needs_review")
    ? "needs_review"
    : items.some((item) => item.reviewState === "overtime_only")
      ? "overtime_only"
      : "none";
  const state: ReportOvertimeMeta["state"] = reviewState === "needs_review"
    ? "needs_review"
    : employeeChoiceMinutes > 0
      ? "employee_choice"
      : weeklyOnlyOvertimeMinutes > 0
        ? "weekly_overtime"
        : standardOvertimeMinutes > 0
          ? "daily_overtime"
          : "base_only";

  return {
    state,
    stateLabel: state === "needs_review"
      ? "Needs review"
      : state === "employee_choice"
        ? "Employee choice"
        : state === "weekly_overtime"
          ? "Weekly overtime"
          : state === "daily_overtime"
            ? "Daily overtime"
            : "Normal",
    reviewState,
    targetMinutes,
    workedMinutes,
    paidMinutes,
    breakMinutes,
    baseMinutes,
    standardOvertimeMinutes,
    employeeChoiceMinutes,
    weeklyOvertimeMinutes,
    weeklyOnlyOvertimeMinutes,
    overtimeMinutes,
    premiumPercent: Math.round(premiumPercent * 100) / 100,
    premiumCreditMinutes,
    timeOffInLieuCreditMinutes,
    equivalentValueMinutes,
    segments: createSegments(baseMinutes, overtimeMinutes, breakMinutes),
    summary: buildSummary(targetMinutes, paidMinutes, Math.round(premiumPercent * 100) / 100, overtimeMinutes)
  };
}
